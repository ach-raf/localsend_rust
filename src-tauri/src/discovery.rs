use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// Global handle to the discovery system
static DISCOVERY_CONTROL: Lazy<Arc<Mutex<Option<Sender<DiscoveryCommand>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

// Global handle to store my own alias for filtering
static MY_ALIAS: Lazy<Arc<Mutex<String>>> = Lazy::new(|| Arc::new(Mutex::new(String::new())));

// Global handle to store my own local IP for filtering. More reliable than alias
// alone, since two devices could share a generated alias.
static MY_IP: Lazy<Arc<Mutex<String>>> = Lazy::new(|| Arc::new(Mutex::new(String::new())));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub ip: String,
    pub port: u16,
    pub alias: String,
    pub hostname: String,
    /// When this peer was last (re-)resolved over mDNS. Internal-only: drives
    /// the staleness sweep so a killed/crashed peer is evicted instead of
    /// lingering as a ghost entry. Never sent to the frontend.
    #[serde(skip, default = "default_last_seen")]
    pub last_seen: Instant,
}

/// Default for the serde-skipped `last_seen`. `Instant` has no `Default` impl,
/// so serde needs an explicit constructor for the skipped field. Only ever used
/// if a `Peer` were deserialized (it isn't in practice — the frontend only
/// receives peers), so the exact value is irrelevant; "now" is a safe choice.
fn default_last_seen() -> Instant {
    Instant::now()
}

enum DiscoveryCommand {
    Refresh,
    UpdateAlias(String),
}

/// Same shape as `DiscoveryCommand`, but for the liveness-probe worker. Kept
/// separate from the mDNS control channel so a slow probe round can never
/// block mDNS event processing (they live on different threads + channels).
enum ProbeCommand {
    /// Re-probe every known peer immediately (manual refresh).
    ProbeNow,
}

/// How often we proactively re-send the mDNS query. mDNS is request/response:
/// a device that started browsing *before* a peer appeared would otherwise
/// never ask again, so a newcomer stays invisible until someone hits Refresh.
/// 15s keeps that latency low. Each query is a single ~100-byte multicast
/// packet, so the cost is negligible — the value also doubles as the heartbeat
/// cadence for `PEER_STALE_TIMEOUT` below.
const REQUERY_INTERVAL: Duration = Duration::from_secs(15);

/// How long a peer can go unseen before we evict it from the list. mDNS itself
/// only forgets a service on a goodbye packet (graceful exit) — and our own
/// `restart_browse` calls `stop_browse`, which silently wipes mdns-sd's cache
/// AND drops the querier, so mdns-sd never even gets to emit `ServiceRemoved`
/// for a vanished peer. We therefore MUST evict ourselves. We use the periodic
/// re-query as a heartbeat: a live peer re-resolves within every
/// `REQUERY_INTERVAL`, refreshing `last_seen`. The timeout must stay ABOVE the
/// re-query interval so a live peer that just answered isn't wrongly evicted
/// (which would cause flicker); 2× gives a comfortable margin while still
/// removing a closed/crashed peer within ~30s.
const PEER_STALE_TIMEOUT: Duration = Duration::from_secs(30);

/// How often the background liveness probe re-checks every known peer. Each
/// probe is a plain TCP connect to the peer's known HTTP port — no HTTP layer,
/// no payload, no TLS. A running peer's listen socket accepts immediately; a
/// quit/crashed/network-dropped peer refuses (instant) or times out. Removals
/// flow through the normal `peers-update` event, so the UI refreshes on its own.
const ACTIVE_PROBE_INTERVAL: Duration = Duration::from_secs(30);

/// Per-peer connect timeout. 1.5s is long enough to ride out a briefly busy
/// peer, yet short enough that a dead peer is reported within the visible
/// ~2.3s refresh window (1.5s probe + 0.8s spinner). Longer would let dead
/// peers survive a manual refresh.
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);

/// Re-send the multicast query by stopping the current browse and starting a
/// fresh one. This is exactly what the manual Refresh button does, and what we
/// now also run on a timer. The peer map is intentionally NOT cleared (known
/// peers stay visible) and the daemon is NOT recreated (its registration stays
/// alive), so this is non-destructive and causes no flicker.
fn restart_browse(
    daemon: &ServiceDaemon,
    service_type: &str,
) -> Option<mdns_sd::Receiver<ServiceEvent>> {
    if let Err(e) = daemon.stop_browse(service_type) {
        eprintln!("Warning: stop_browse returned: {}", e);
    }
    match daemon.browse(service_type) {
        Ok(receiver) => Some(receiver),
        Err(e) => {
            eprintln!("Warning: restart browse failed: {}", e);
            None
        }
    }
}

pub fn start_discovery(app: AppHandle, my_alias: String) {
    let service_type = "_myshare_app._tcp.local.";

    eprintln!("Starting discovery - filtering out self: {}", my_alias);

    // Store the initial alias
    *MY_ALIAS.lock().unwrap() = my_alias.clone();

    // Store our own local IP so we can filter self by address (alias alone is fragile).
    match local_ip_address::local_ip() {
        Ok(ip) => {
            let ip_str = ip.to_string();
            eprintln!("Our local IP for self-filter: {}", ip_str);
            *MY_IP.lock().unwrap() = ip_str;
        }
        Err(e) => {
            eprintln!("Warning: could not determine local IP for self-filter: {}", e);
        }
    }

    let peers_map: Arc<Mutex<HashMap<String, Peer>>> = Arc::new(Mutex::new(HashMap::new()));
    let peers_map_clone = peers_map.clone();

    // Create control channel for refresh / alias-update commands
    let (cmd_sender, cmd_receiver) = channel::<DiscoveryCommand>();
    *DISCOVERY_CONTROL.lock().unwrap() = Some(cmd_sender);

    thread::spawn(move || {
        eprintln!("mDNS discovery thread started");

        // ONE daemon, kept alive for the lifetime of the app. mDNS itself handles
        // re-announcement (TTL) and expiration (goodbye packets -> ServiceRemoved).
        // We DO periodically re-browse (see REQUERY_INTERVAL below) so an
        // already-running device sees a newcomer — but we never clear the peer
        // map and never recreate the daemon. Clearing the map / recreating the
        // daemon is what made peers flicker every 30s; the periodic re-browse
        // alone is non-destructive and causes no flicker.
        let daemon = match ServiceDaemon::new() {
            Ok(d) => d,
            Err(e) => {
                eprintln!("✗ Failed to create mDNS daemon: {}. Discovery aborted.", e);
                return;
            }
        };

        // Browse once and keep the receiver open for the lifetime of the thread.
        let mut receiver_opt = match daemon.browse(service_type) {
            Ok(receiver) => {
                eprintln!("✓ mDNS browse started successfully");
                Some(receiver)
            }
            Err(e) => {
                eprintln!("✗ Failed to start browse: {}", e);
                None
            }
        };

        // Track when we last solicited peers. We re-query on a timer so that a
        // device already running when a peer appears will learn about it within
        // REQUERY_INTERVAL, instead of waiting for a manual Refresh.
        let mut last_query = Instant::now();

        // ---- Active liveness probe worker ---------------------------------
        //
        // mDNS discovery cannot, by itself, detect a peer that vanished without
        // sending a goodbye packet (process killed, network dropped, machine
        // crashed). `restart_browse` even wipes mdns-sd's cache, so we never get
        // a `ServiceRemoved` for such peers — they linger as ghosts until the
        // 30s staleness sweep finally evicts them. That makes the manual
        // Refresh button feel broken: you tap it right after a peer dies and the
        // ghost is still there.
        //
        // This worker fixes that by actively TCP-connecting to each known
        // peer's HTTP port on two triggers:
        //   - the 30s background timer (always-on safety net), and
        //   - an immediate `ProbeNow` poked by the Refresh command (so a tap
        //     on the button / pull-to-refresh detects a dead peer within the
        //     spinner window).
        // A running peer's listen socket accepts instantly; a dead one refuses
        // or times out, and we remove it via the normal `peers-update` event.
        let (probe_tx, probe_rx) = channel::<ProbeCommand>();
        let probe_trigger: Option<Sender<ProbeCommand>> = Some(probe_tx);
        let probe_app = app.clone();
        let probe_peers = peers_map_clone.clone();
        thread::spawn(move || {
            // The recv_timeout doubles as the periodic timer: we block until
            // either a manual `ProbeNow` arrives or the interval elapses,
            // whichever comes first. This keeps manual-refresh latency at a
            // minimum (no fixed poll delay) while still firing on schedule.
            let mut last_probe = Instant::now();
            loop {
                let wait = ACTIVE_PROBE_INTERVAL
                    .saturating_sub(last_probe.elapsed());
                match probe_rx.recv_timeout(wait) {
                    Ok(ProbeCommand::ProbeNow) => {
                        eprintln!("Active probe: triggered by refresh");
                        last_probe = Instant::now();
                        run_active_probe(&probe_app, &probe_peers);
                    }
                    Err(_) => {
                        // Timeout — the periodic interval elapsed.
                        last_probe = Instant::now();
                        run_active_probe(&probe_app, &probe_peers);
                    }
                }
            }
        });
        // -------------------------------------------------------------------

        loop {
            // Handle control commands (non-blocking)
            match cmd_receiver.try_recv() {
                Ok(DiscoveryCommand::Refresh) => {
                    // Non-destructive refresh: re-send the mDNS query so peers
                    // re-announce immediately. We do NOT clear the peer map and do
                    // NOT recreate the daemon — known peers stay visible.
                    eprintln!("Refresh: re-querying mDNS (peer list preserved)");
                    receiver_opt = restart_browse(&daemon, service_type);
                    last_query = Instant::now();

                    // Also kick an active liveness probe so a peer that quit
                    // WITHOUT sending a goodbye (crash, network drop, OS kill)
                    // is evicted now instead of lingering up to 30s. mDNS alone
                    // can't tell us a peer is gone — its listen socket can.
                    if let Some(tx) = probe_trigger.as_ref() {
                        let _ = tx.send(ProbeCommand::ProbeNow);
                    }
                }
                Ok(DiscoveryCommand::UpdateAlias(new_alias)) => {
                    eprintln!("Alias update command received: {}", new_alias);
                    *MY_ALIAS.lock().unwrap() = new_alias;
                    // Re-emit so the (re)filter takes effect, without dropping known peers.
                    emit_peers(&app, &peers_map_clone);
                }
                Err(_) => {
                    // No command waiting — fall through to process events.
                }
            }

            // Proactively re-query on a timer. An already-running browser would
            // otherwise never ask again after its initial query, so a newcomer
            // stays invisible until someone hits Refresh. The loop wakes ~every
            // 200ms via recv_timeout, so we just check the elapsed here.
            if last_query.elapsed() >= REQUERY_INTERVAL {
                eprintln!("Periodic re-query: re-soliciting peers");
                receiver_opt = restart_browse(&daemon, service_type);
                last_query = Instant::now();
            }

            // Drain mDNS events with a short timeout so we keep checking commands.
            if let Some(receiver) = receiver_opt.as_ref() {
                match receiver.recv_timeout(Duration::from_millis(200)) {
                    Ok(event) => process_mdns_event(event, &peers_map_clone, &app),
                    Err(_) => {
                        // Timeout - loop back to check for commands.
                    }
                }
            } else {
                // No active receiver (browse failed earlier). Retry shortly.
                thread::sleep(Duration::from_millis(500));
                if let Ok(receiver) = daemon.browse(service_type) {
                    eprintln!("✓ mDNS browse re-started after earlier failure");
                    receiver_opt = Some(receiver);
                }
            }

            // Evict peers that haven't re-announced within PEER_STALE_TIMEOUT.
            // mDNS only forgets a service via a goodbye packet (graceful exit) or
            // its ~75-min TTL; a killed/crashed/disconnected peer sends no
            // goodbye and would otherwise linger as a ghost. The periodic
            // re-query is our heartbeat: live peers re-resolve within ~30s, so
            // anything unseen for 90s is genuinely gone.
            sweep_stale_peers(&app, &peers_map_clone);
        }
    });
}

fn process_mdns_event(
    event: ServiceEvent,
    peers_map: &Arc<Mutex<HashMap<String, Peer>>>,
    app: &AppHandle,
) {
    // Read our own identity once per event. Filter on alias OR address — address
    // is the reliable key since two devices could share a generated alias.
    let my_alias = MY_ALIAS.lock().unwrap().clone();
    let my_ip = MY_IP.lock().unwrap().clone();

    match event {
        ServiceEvent::SearchStarted(service_type) => {
            eprintln!("mDNS search started for {}", service_type);
        }
        ServiceEvent::ServiceFound(service_type, fullname) => {
            eprintln!("Service found: {} (type: {})", fullname, service_type);
        }
        ServiceEvent::ServiceResolved(info) => {
            eprintln!("Service resolved: {}", info.get_fullname());

            // Get alias first to check if this is our own device.
            // get_property_val returns Option<Option<&[u8]>>.
            let alias = match info.get_property_val("alias") {
                Some(Some(bytes)) => String::from_utf8_lossy(bytes).to_string(),
                _ => "Unknown".to_string(),
            };

            // Collect all addresses (used for the self-filter) and the IPv4-only
            // subset (used for selection). The HTTP server binds 0.0.0.0 (IPv4
            // only), so a peer is only reachable over IPv4 — picking an IPv6
            // (e.g. a link-local fe80:: address) would display but never connect.
            // `addresses` is a HashSet, so its iteration order is non-deterministic,
            // which is why the old "first address" pick sometimes returned IPv6 and
            // a manual refresh seemed to "fix" it.
            let addresses: Vec<String> = info
                .get_addresses()
                .iter()
                .map(|ip| ip.to_string())
                .collect();
            let v4_addresses: Vec<String> = info
                .get_addresses_v4()
                .into_iter()
                .map(|ip| ip.to_string())
                .collect();

            eprintln!("  Alias: {}", alias);
            eprintln!("  Addresses (all): {:?}", addresses);
            eprintln!("  Addresses (IPv4): {:?}", v4_addresses);
            eprintln!("  Port: {}", info.get_port());

            // Skip if this is our own device (alias match OR IP match).
            if alias == my_alias || (!my_ip.is_empty() && addresses.iter().any(|a| a == &my_ip)) {
                eprintln!("  Skipping - this is our own device");
                return;
            }

            // Prefer an IPv4 address (the server is IPv4-only). Fall back to any
            // address only if the peer advertises no IPv4 at all.
            let ip = v4_addresses
                .iter()
                .find(|addr| !addr.is_empty())
                .cloned()
                .or_else(|| addresses.iter().find(|addr| !addr.is_empty()).cloned())
                .unwrap_or_default();

            // Skip if no valid IP found
            if !ip.is_empty() {
                let hostname = info.get_fullname().to_string();
                let port = info.get_port();
                let key = info.get_fullname().to_string();

                let peer = Peer {
                    ip: ip.clone(),
                    port,
                    alias: alias.clone(),
                    hostname: hostname.clone(),
                    // Refresh the heartbeat on every (re-)resolve — including the
                    // periodic 30s re-query, which keeps live peers fresh and is
                    // exactly what the staleness sweep keys off.
                    last_seen: Instant::now(),
                };

                let mut peers = peers_map.lock().unwrap();

                // Check if we already have a peer with the same IP but different alias
                // If so, remove the old entry to avoid duplicates
                let existing_key = peers
                    .iter()
                    .find(|(_, p)| p.ip == ip && p.alias != alias)
                    .map(|(k, _)| k.clone());

                if let Some(old_key) = existing_key {
                    eprintln!(
                        "  Removing old peer entry with same IP but different alias: {}",
                        old_key
                    );
                    peers.remove(&old_key);
                }

                eprintln!("  Adding/updating peer: {} ({}:{})", alias, ip, port);
                peers.insert(key, peer);
                drop(peers); // Release lock before emitting
                emit_peers(app, peers_map);
            } else {
                eprintln!("  Skipping - no valid IP found");
            }
        }
        ServiceEvent::ServiceRemoved(_service_type, fullname) => {
            eprintln!("Service removed: {}", fullname);
            let key = fullname;
            peers_map.lock().unwrap().remove(&key);
            emit_peers(app, peers_map);
        }
        _ => {
            eprintln!("Other mDNS event: {:?}", event);
        }
    }
}

fn emit_peers(app: &AppHandle, peers: &Arc<Mutex<HashMap<String, Peer>>>) {
    let list: Vec<Peer> = peers.lock().unwrap().values().cloned().collect();
    let _ = app.emit("peers-update", list);
}

/// Actively verify a peer is still reachable by opening a TCP connection to
/// its known HTTP port. We use a raw `TcpStream` rather than an HTTP GET
/// (`/ping`) because all we need to know is whether something is *listening*:
/// a quit/crashed peer's socket is closed and the kernel refuses the SYN
/// (or, on a dropped network, the connect times out). Avoiding the HTTP layer
/// keeps each probe a single round-trip with no framing overhead. Returns
/// `true` if the peer answered.
fn probe_peer(ip: &str, port: u16) -> bool {
    let addr = format!("{}:{}", ip, port);
    match TcpStream::connect_timeout(
        &match addr.parse() {
            Ok(socket_addr) => socket_addr,
            Err(e) => {
                eprintln!("Probe {}: unparseable address '{}': {}", ip, addr, e);
                return false;
            }
        },
        PROBE_CONNECT_TIMEOUT,
    ) {
        Ok(_) => {
            eprintln!("Probe {}: alive", addr);
            true
        }
        Err(e) => {
            eprintln!("Probe {}: unreachable ({})", addr, e);
            false
        }
    }
}

/// Probe every currently-known peer in parallel and remove the unreachable
/// ones, emitting a single `peers-update` if anything changed. Runs on a
/// dedicated worker thread so a large peer set can't stall the mDNS loop or
/// the UI. We snapshot the peer list under the lock, probe concurrently, then
/// take the lock again only to apply removals — minimizing contention.
fn run_active_probe(app: &AppHandle, peers: &Arc<Mutex<HashMap<String, Peer>>>) {
    // Snapshot (key, ip, port) so we can probe without holding the lock.
    let snapshot: Vec<(String, String, u16)> = {
        let peers = peers.lock().unwrap();
        peers
            .iter()
            .map(|(k, p)| (k.clone(), p.ip.clone(), p.port))
            .collect()
    };

    if snapshot.is_empty() {
        return;
    }

    // Probe each peer on its own thread so the per-peer timeout (1.5s) runs
    // concurrently rather than serially — N peers still resolve in ~1.5s, not N×1.5s.
    // `thread::scope` guarantees every spawned thread is joined before we touch
    // `dead_keys`, so the borrows are safe without manual Arc/Clone plumbing.
    let dead_keys: Vec<String> = thread::scope(|s| {
        let handles: Vec<_> = snapshot
            .into_iter()
            .map(|(key, ip, port)| {
                s.spawn(move || {
                    if probe_peer(&ip, port) {
                        None
                    } else {
                        Some(key)
                    }
                })
            })
            .collect();

        handles
            .into_iter()
            .filter_map(|h| h.join().ok().flatten())
            .collect()
    });

    if dead_keys.is_empty() {
        return;
    }

    let removed_any = {
        let mut peers = peers.lock().unwrap();
        let mut changed = false;
        for key in &dead_keys {
            if peers.remove(key).is_some() {
                eprintln!(
                    "Active probe: evicting dead peer {} (mDNS did not report removal)",
                    key
                );
                changed = true;
            }
        }
        changed
    };

    if removed_any {
        emit_peers(app, peers);
    }
}

/// Drop peers that haven't re-announced within `PEER_STALE_TIMEOUT` and push the
/// trimmed list to the frontend. Cheap: a single pass over (typically <10)
/// entries, so it's safe to run on every loop iteration. Only emits when
/// something actually changed, so it never causes needless UI churn.
///
/// This is the TTL-based *fallback*. The primary liveness signal is the active
/// TCP probe (`run_active_probe`): it catches a vanished peer within ~1.5s on
/// a manual refresh and every `ACTIVE_PROBE_INTERVAL` in the background. The
/// sweep still runs so a peer that slips past the probe (e.g. one whose port
/// is open but whose app is wedged and no longer re-announcing) is eventually
/// evicted by absence of mDNS re-resolves too.
fn sweep_stale_peers(app: &AppHandle, peers: &Arc<Mutex<HashMap<String, Peer>>>) {
    let now = Instant::now();
    let mut removed_any = false;
    let stale_keys: Vec<String> = {
        let peers = peers.lock().unwrap();
        peers
            .iter()
            .filter(|(_, p)| now.duration_since(p.last_seen) >= PEER_STALE_TIMEOUT)
            .map(|(k, p)| {
                eprintln!(
                    "Peer stale (last seen {:?} ago), evicting: {} ({})",
                    now.duration_since(p.last_seen),
                    p.alias,
                    k
                );
                k.clone()
            })
            .collect()
    };

    if stale_keys.is_empty() {
        return;
    }

    {
        let mut peers = peers.lock().unwrap();
        for key in &stale_keys {
            if peers.remove(key).is_some() {
                removed_any = true;
            }
        }
    }

    if removed_any {
        emit_peers(app, peers);
    }
}

// Function to register the service (broadcast presence)
pub fn register_service(alias: &str, port: u16) -> Result<ServiceDaemon, String> {
    eprintln!("Registering mDNS service...");

    let daemon = ServiceDaemon::new().map_err(|e| {
        let err_msg = format!("Failed to create ServiceDaemon: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    let service_type = "_myshare_app._tcp.local.";
    let hostname = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    eprintln!("  Hostname: {}", hostname);

    let ip_addr = local_ip_address::local_ip().map_err(|e| {
        let err_msg = format!("Failed to get local IP: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    eprintln!("  IP Address: {}", ip_addr);
    eprintln!("  Port: {}", port);
    eprintln!("  Alias: {}", alias);

    let properties = [("alias", alias)];

    let my_service = ServiceInfo::new(
        service_type,
        alias,
        &format!("{}.local.", hostname),
        ip_addr.to_string(),
        port,
        &properties[..],
    )
    .map_err(|e| {
        let err_msg = format!("Failed to create ServiceInfo: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    daemon.register(my_service).map_err(|e| {
        let err_msg = format!("Failed to register service: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    eprintln!("  Service registered successfully!");
    Ok(daemon)
}

/// Announce that we are going offline by sending an mDNS goodbye (TTL=0) for
/// our own service. Every other client's mdns-sd receives it and immediately
/// emits `ServiceRemoved`, so we vanish from their peer list the instant we
/// quit — no 30s timeout wait.
///
/// This is the counterpart to `register_service`: it uses `unregister()` on the
/// SAME daemon instance, not `shutdown()` — `shutdown()` tears the daemon down
/// WITHOUT sending a goodbye, which would defeat the whole point.
///
/// IMPORTANT: `daemon.unregister()` only ENQUEUES the goodbye on the mdns-sd
/// daemon thread's command queue; it does NOT block until the packet is sent.
/// If we return immediately, the main thread exits and the OS tears the process
/// (and the daemon thread) down before the goodbye ever goes out — which is
/// exactly the bug where quitting one client never removed it from the other.
/// mdns-sd sends the packet synchronously inside the daemon thread and only
/// THEN replies `UnregisterStatus::OK` on the returned receiver, so we block on
/// that receiver: once it yields, the goodbye has been multicast. A bounded
/// wait means a wedged daemon can never hang app shutdown.
///
/// NOTE: this only covers graceful exits (closing the window, Quit menu, OS
/// asking the app to terminate). A killed/crashed process sends no goodbye, so
/// the `last_seen` staleness sweep in `start_discovery` remains as the safety
/// net for those cases.
pub fn unregister_service(daemon: &ServiceDaemon, alias: &str) {
    let service_type = "_myshare_app._tcp.local.";
    let fullname = format!("{}.{}", alias, service_type);
    eprintln!("Sending mDNS goodbye (unregister) for: {}", fullname);

    match daemon.unregister(&fullname) {
        Ok(receiver) => {
            // Block until the daemon has actually multicast the goodbye packet,
            // or give up after a bounded wait if the daemon is stuck. mdns-sd
            // only reports OK after sending, so a successful recv guarantees the
            // packet is on the wire (in the kernel's send buffer, at minimum).
            match receiver.recv_timeout(Duration::from_millis(500)) {
                Ok(status) => eprintln!("mDNS goodbye sent: {:?}", status),
                Err(e) => eprintln!(
                    "Warning: timed out / error waiting for goodbye to send: {}. \
                     The packet may not have been transmitted before exit.",
                    e
                ),
            }
            // Tiny grace period so the kernel flushes the multicast UDP packet
            // to the NIC before the process tears down. UDP send is normally
            // synchronous into the kernel buffer, so this is mostly insurance.
            thread::sleep(Duration::from_millis(50));
        }
        Err(e) => {
            eprintln!("Warning: failed to enqueue unregister on exit: {}", e);
        }
    }
}

/// Re-register our service under a new alias on an EXISTING daemon, without
/// tearing the daemon down. Announces the new name, then sends a goodbye for
/// the old name. The new name is registered first so that a register failure
/// never leaves the device invisible (the old alias stays alive).
///
/// We avoid `ServiceDaemon::shutdown()` here because it does NOT send an mDNS
/// goodbye — only `unregister()` does.
pub fn reregister_service_alias(
    daemon: &ServiceDaemon,
    old_alias: &str,
    new_alias: &str,
    port: u16,
) -> Result<(), String> {
    let service_type = "_myshare_app._tcp.local.";

    // 1. Announce the new name on the same daemon (same construction as
    //    `register_service`).
    let hostname = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ip_addr = local_ip_address::local_ip().map_err(|e| {
        let err_msg = format!("Failed to get local IP: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    let properties = [("alias", new_alias)];
    let new_service = ServiceInfo::new(
        service_type,
        new_alias,
        &format!("{}.local.", hostname),
        ip_addr.to_string(),
        port,
        &properties[..],
    )
    .map_err(|e| {
        let err_msg = format!("Failed to create ServiceInfo: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    daemon.register(new_service).map_err(|e| {
        let err_msg = format!("Failed to register new service: {}", e);
        eprintln!("{}", err_msg);
        err_msg
    })?;

    // 2. Retire the old name with a real goodbye (TTL=0, retransmitted by
    //    mdns-sd at +120ms). mdns-sd lowercases the fullname internally, so the
    //    alias case does not need to match. The status receiver is unused — the
    //    goodbye is sent by the daemon regardless.
    let old_fullname = format!("{}.{}", old_alias, service_type);
    eprintln!("Unregistering old service (goodbye): {}", old_fullname);
    if let Err(e) = daemon.unregister(&old_fullname) {
        eprintln!("Warning: failed to unregister old service: {}", e);
    }

    eprintln!("Service renamed: {} -> {}", old_alias, new_alias);
    Ok(())
}

// Function to manually refresh discovery
pub fn refresh_discovery() -> Result<(), String> {
    eprintln!("Manual discovery refresh triggered...");

    if let Ok(control_lock) = DISCOVERY_CONTROL.lock() {
        if let Some(sender) = control_lock.as_ref() {
            match sender.send(DiscoveryCommand::Refresh) {
                Ok(_) => {
                    eprintln!("  Refresh command sent successfully");
                    Ok(())
                }
                Err(e) => {
                    let err_msg = format!("Failed to send refresh command: {}", e);
                    eprintln!("  {}", err_msg);
                    Err(err_msg)
                }
            }
        } else {
            let err_msg = "Discovery control not initialized".to_string();
            eprintln!("  {}", err_msg);
            Err(err_msg)
        }
    } else {
        let err_msg = "Failed to lock discovery control".to_string();
        eprintln!("  {}", err_msg);
        Err(err_msg)
    }
}

// Function to update alias in discovery
pub fn update_alias(new_alias: String) -> Result<(), String> {
    eprintln!("Updating alias to: {}", new_alias);

    if let Ok(control_lock) = DISCOVERY_CONTROL.lock() {
        if let Some(sender) = control_lock.as_ref() {
            match sender.send(DiscoveryCommand::UpdateAlias(new_alias)) {
                Ok(_) => {
                    eprintln!("  Alias update command sent successfully");
                    Ok(())
                }
                Err(e) => {
                    let err_msg = format!("Failed to send alias update command: {}", e);
                    eprintln!("  {}", err_msg);
                    Err(err_msg)
                }
            }
        } else {
            let err_msg = "Discovery control not initialized".to_string();
            eprintln!("  {}", err_msg);
            Err(err_msg)
        }
    } else {
        let err_msg = "Failed to lock discovery control".to_string();
        eprintln!("  {}", err_msg);
        Err(err_msg)
    }
}
