use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
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

/// Per-peer connect timeout. 1.5s is long enough to ride out a briefly busy
/// peer, yet short enough that a dead peer is reported within the visible
/// ~2.3s refresh window (1.5s probe + 0.8s spinner). Longer would let dead
/// peers survive a manual refresh.
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);

/// Restart mdns-sd's query schedule while preserving its querier and cache.
/// Calling `stop_browse` here used to clear both, creating a race where healthy
/// peers disappeared whenever a response missed the 30-second stale cutoff.
fn refresh_browse(
    daemon: &ServiceDaemon,
    service_type: &str,
) -> Option<mdns_sd::Receiver<ServiceEvent>> {
    match daemon.browse(service_type) {
        Ok(receiver) => Some(receiver),
        Err(e) => {
            eprintln!("Warning: refresh browse failed: {}", e);
            None
        }
    }
}

pub fn start_discovery(app: AppHandle, my_alias: String, daemon: ServiceDaemon) {
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
            eprintln!(
                "Warning: could not determine local IP for self-filter: {}",
                e
            );
        }
    }

    let peers_map: Arc<Mutex<HashMap<String, Peer>>> = Arc::new(Mutex::new(HashMap::new()));
    let peers_map_clone = peers_map.clone();

    // Create control channel for refresh / alias-update commands
    let (cmd_sender, cmd_receiver) = channel::<DiscoveryCommand>();
    *DISCOVERY_CONTROL.lock().unwrap() = Some(cmd_sender);

    thread::spawn(move || {
        eprintln!("mDNS discovery thread started");

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

        // Keep active TCP eviction behind an explicit Refresh. A single
        // background timeout is not proof that a peer disappeared; on Wi-Fi or
        // a sleeping phone it caused healthy peers to flicker out of the UI.
        let (probe_tx, probe_rx) = channel::<ProbeCommand>();
        let probe_trigger: Option<Sender<ProbeCommand>> = Some(probe_tx);
        let probe_app = app.clone();
        let probe_peers = peers_map_clone.clone();
        thread::spawn(move || {
            while let Ok(ProbeCommand::ProbeNow) = probe_rx.recv() {
                eprintln!("Active probe: triggered by refresh");
                run_active_probe(&probe_app, &probe_peers);
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
                    if let Some(receiver) = refresh_browse(&daemon, service_type) {
                        receiver_opt = Some(receiver);
                    }

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

// Function to register the service (broadcast presence)
pub fn register_service(daemon: &ServiceDaemon, alias: &str, port: u16) -> Result<(), String> {
    eprintln!("Registering mDNS service...");

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
    Ok(())
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
/// asking the app to terminate). A killed/crashed process sends no goodbye;
/// mdns-sd's TTL expiry and the manual-refresh TCP probe cover those cases.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_reuses_the_caller_owned_daemon() {
        let _: fn(AppHandle, String, ServiceDaemon) = start_discovery;
    }

    #[test]
    fn registration_uses_an_existing_daemon() {
        let _: fn(&ServiceDaemon, &str, u16) -> Result<(), String> = register_service;
    }
}
