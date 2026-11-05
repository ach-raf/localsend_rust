//! Peer discovery — v2.
//!
//! mDNS (multicast) alone is not reliable enough to be the only way devices
//! find each other: Android drops multicast when the screen is off, many access
//! points filter it, Windows firewalls block UDP 5353 on "public" networks, and
//! virtual adapters (VPN/WSL/Hyper-V) make a device announce an address nobody
//! can reach. The old implementation trusted mDNS completely, which produced the
//! "A sees B but B can't see A" and "peer vanished" behaviour.
//!
//! This module therefore treats mDNS as ONE source of *candidates* and makes the
//! HTTP server (which is the thing we actually need to reach) the source of
//! truth:
//!
//! * **Identity** — every install has a persistent `device_id`. It is the mDNS
//!   instance name, the peer key and the self-filter. Aliases are display-only,
//!   so renames and alias collisions can no longer create/hide peers.
//! * **Verify before show** — a peer only appears in the list after we have
//!   completed an HTTP exchange with it (`POST /announce`). Unreachable
//!   addresses (VPN, docker, stale DHCP lease) are never displayed.
//! * **Two-way introduction** — that same exchange tells the other side about us,
//!   so one working direction is enough for both devices to see each other.
//! * **Subnet scan fallback** — independent of multicast, we periodically sweep
//!   the local /24s for our HTTP port and announce ourselves.
//! * **Liveness with hysteresis** — peers are re-probed every few seconds.
//!   "Connection refused" evicts at once; timeouts need several consecutive
//!   misses, so a briefly busy Wi-Fi link never makes a peer flicker. mDNS
//!   goodbyes/expiry are only *hints* that speed the probing up.
//! * **Self-healing** — the mDNS daemon is created lazily and re-created if it
//!   dies or could not start (no network at launch), and interface changes
//!   trigger a re-query + rescan.

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use once_cell::sync::{Lazy, OnceCell};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const SERVICE_TYPE: &str = "_myshare_app._tcp.local.";
/// Marker in `/info` and `/announce` payloads so we never mistake some other
/// HTTP service on the same port for a peer.
const APP_TAG: &str = "local-share";
const DEFAULT_PORT: u16 = 3030;

/// Connect + I/O timeout for steady-state liveness probes.
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
/// Connect timeout while sweeping a subnet. LAN hosts answer (or refuse) in a
/// few ms; anything slower is an empty address.
const SCAN_CONNECT_TIMEOUT: Duration = Duration::from_millis(400);
const SCAN_WORKERS: usize = 64;
const MAX_SCAN_SUBNETS: usize = 4;

const PROBE_INTERVAL: Duration = Duration::from_secs(10);
/// Faster cadence while any peer is suspect (goodbye seen / a probe failed), so
/// real departures disappear quickly without making healthy peers twitchy.
const SUSPECT_PROBE_INTERVAL: Duration = Duration::from_secs(2);
const SCAN_INTERVAL: Duration = Duration::from_secs(30);
const IFACE_CHECK_INTERVAL: Duration = Duration::from_secs(5);
const DAEMON_RETRY_INTERVAL: Duration = Duration::from_secs(5);
/// Consecutive unreachable probes before a peer is dropped. "Refused" evicts
/// immediately instead (nothing is listening any more).
const EVICT_STRIKES: u32 = 4;
/// Minimum gap between focus-triggered refreshes.
const FOCUS_REFRESH_MIN_GAP: Duration = Duration::from_secs(3);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// What a device tells others about itself (mDNS TXT mirror + HTTP payload).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub app: String,
    pub id: String,
    pub alias: String,
    pub port: u16,
}

/// A peer as shown to the UI. `ip` is always an address we have successfully
/// talked to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Peer {
    pub id: String,
    pub ip: String,
    pub port: u16,
    pub alias: String,
    pub hostname: String,
}

struct PeerEntry {
    peer: Peer,
    /// `None` for peers running a pre-v2 build (no device id, no `/info`).
    id: Option<String>,
    /// Every address we have heard of, current `peer.ip` included.
    addrs: Vec<Ipv4Addr>,
    strikes: u32,
    suspect: bool,
}

#[derive(Default)]
struct Registry {
    peers: HashMap<String, PeerEntry>,
    /// Keys currently being verified, to avoid duplicate verification threads.
    inflight: HashSet<String>,
    last_emitted: Option<Vec<Peer>>,
}

enum MdnsCommand {
    /// Re-send queries now (non-destructive: the peer list is kept).
    Refresh,
    /// Alias changed: re-announce our service record.
    Reregister,
}

enum MaintCommand {
    /// Probe + scan right now (manual refresh, app resume, network change).
    Now,
    /// An mDNS goodbye/expiry was seen: probe soon.
    Suspect,
    /// Tell every known peer about our (new) alias.
    AnnounceAll,
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

static APP: OnceCell<AppHandle> = OnceCell::new();
static IDENTITY: Lazy<RwLock<DeviceInfo>> = Lazy::new(|| {
    RwLock::new(DeviceInfo {
        app: APP_TAG.to_string(),
        id: String::new(),
        alias: String::new(),
        port: DEFAULT_PORT,
    })
});
static REGISTRY: Lazy<Mutex<Registry>> = Lazy::new(|| Mutex::new(Registry::default()));
static DAEMON: Lazy<Mutex<Option<ServiceDaemon>>> = Lazy::new(|| Mutex::new(None));
static MDNS_TX: Lazy<Mutex<Option<Sender<MdnsCommand>>>> = Lazy::new(|| Mutex::new(None));
static MAINT_TX: Lazy<Mutex<Option<Sender<MaintCommand>>>> = Lazy::new(|| Mutex::new(None));
static SCANNING: AtomicBool = AtomicBool::new(false);
static LAST_FOCUS_REFRESH: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));

/// A poisoned lock only means another discovery thread panicked; the data is
/// still a valid peer list, and discovery must keep running.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn identity() -> DeviceInfo {
    IDENTITY.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Payload for `GET /info` and the reply to `POST /announce`.
pub fn local_device_info() -> DeviceInfo {
    identity()
}

// ---------------------------------------------------------------------------
// Public API (called from lib.rs / server.rs)
// ---------------------------------------------------------------------------

/// Start discovery. Call once from `setup`. Never fails: every subsystem
/// retries on its own, so a missing network at launch is not fatal.
pub fn start(app: AppHandle, device_id: String, alias: String, port: u16) {
    eprintln!("Discovery v2 starting: id={} alias={} port={}", device_id, alias, port);
    let _ = APP.set(app);
    {
        let mut ident = IDENTITY.write().unwrap_or_else(|e| e.into_inner());
        ident.id = device_id;
        ident.alias = alias;
        ident.port = port;
    }

    let (mdns_tx, mdns_rx) = channel::<MdnsCommand>();
    let (maint_tx, maint_rx) = channel::<MaintCommand>();
    *lock(&MDNS_TX) = Some(mdns_tx);
    *lock(&MAINT_TX) = Some(maint_tx);

    thread::Builder::new()
        .name("discovery-mdns".into())
        .spawn(move || mdns_loop(mdns_rx))
        .ok();
    thread::Builder::new()
        .name("discovery-maint".into())
        .spawn(move || maintenance_loop(maint_rx))
        .ok();
}

/// Current peer list, sorted exactly as `peers-update` publishes it. Lets the
/// UI fetch state on (re)mount instead of waiting for the next change event.
pub fn current_peers() -> Vec<Peer> {
    let reg = lock(&REGISTRY);
    let mut list: Vec<Peer> = reg.peers.values().map(|e| e.peer.clone()).collect();
    sort_peers(&mut list);
    list
}

fn sort_peers(list: &mut [Peer]) {
    // Stable order: HashMap iteration order is random and made the list jump.
    list.sort_by(|a, b| {
        a.alias
            .to_lowercase()
            .cmp(&b.alias.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// Manual refresh: re-query mDNS, then probe and rescan immediately. Also
/// re-emits the current list so a UI that mounted late is brought up to date.
pub fn refresh_discovery() -> Result<(), String> {
    eprintln!("Discovery refresh requested");
    send_mdns(MdnsCommand::Refresh);
    send_maint(MaintCommand::Now);
    emit_peers(true);
    Ok(())
}

/// Refresh when the app regains focus / resumes (Android doze and Windows
/// sleep both silently break multicast). Rate-limited.
pub fn refresh_on_focus() {
    {
        let mut last = lock(&LAST_FOCUS_REFRESH);
        if let Some(t) = *last {
            if t.elapsed() < FOCUS_REFRESH_MIN_GAP {
                return;
            }
        }
        *last = Some(Instant::now());
    }
    send_mdns(MdnsCommand::Refresh);
    send_maint(MaintCommand::Now);
}

/// The user renamed this device.
pub fn set_alias(new_alias: String) {
    eprintln!("Discovery: alias is now '{}'", new_alias);
    IDENTITY
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .alias = new_alias;
    send_mdns(MdnsCommand::Reregister);
    send_maint(MaintCommand::AnnounceAll);
}

/// Send an mDNS goodbye (TTL=0) so peers drop us immediately on a graceful
/// exit. Blocks briefly until the packet is actually sent. Crashes/kills send
/// no goodbye; peers then notice via connection-refused probes within seconds.
pub fn shutdown() {
    let daemon = lock(&DAEMON).clone();
    let Some(daemon) = daemon else { return };
    let fullname = format!("{}.{}", identity().id, SERVICE_TYPE);
    eprintln!("Sending mDNS goodbye for {}", fullname);
    match daemon.unregister(&fullname) {
        Ok(rx) => {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(status) => eprintln!("mDNS goodbye sent: {:?}", status),
                Err(e) => eprintln!("Warning: goodbye not confirmed before exit: {}", e),
            }
            thread::sleep(Duration::from_millis(50));
        }
        Err(e) => eprintln!("Warning: could not enqueue goodbye: {}", e),
    }
}

/// `POST /announce` handler body: another device is introducing itself.
/// Returns our own info as the reply. Verification happens in the background
/// (we connect back), so a spoofed or unreachable announcer is never listed.
pub fn handle_announce(remote: IpAddr, info: DeviceInfo) -> DeviceInfo {
    let me = identity();
    let IpAddr::V4(remote_v4) = remote else { return me };
    if info.app != APP_TAG || info.id.is_empty() || info.id == me.id || info.port == 0 {
        return me;
    }
    if !update_known(&info.id, &info.alias, info.port, &[remote_v4]) {
        spawn_verify(
            info.id.clone(),
            Some(info.id.clone()),
            info.alias.clone(),
            info.port,
            vec![remote_v4],
            String::new(),
        );
    }
    me
}

fn send_mdns(cmd: MdnsCommand) {
    if let Some(tx) = lock(&MDNS_TX).as_ref() {
        let _ = tx.send(cmd);
    }
}

fn send_maint(cmd: MaintCommand) {
    if let Some(tx) = lock(&MAINT_TX).as_ref() {
        let _ = tx.send(cmd);
    }
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

/// Publish the peer list to the UI (only when it changed, unless `force`).
/// Must NOT be called while holding the registry lock.
fn emit_peers(force: bool) {
    let mut reg = lock(&REGISTRY);
    let mut list: Vec<Peer> = reg.peers.values().map(|e| e.peer.clone()).collect();
    sort_peers(&mut list);
    if !force && reg.last_emitted.as_ref() == Some(&list) {
        return;
    }
    reg.last_emitted = Some(list.clone());
    // Emit under the lock so two threads can't publish out of order.
    if let Some(app) = APP.get() {
        let _ = app.emit("peers-update", list);
    }
}

fn merge_addrs(into: &mut Vec<Ipv4Addr>, extra: &[Ipv4Addr]) {
    for a in extra {
        if !into.contains(a) {
            into.push(*a);
        }
    }
}

/// Insert or refresh a peer we have just verified at `ip`.
fn upsert_verified(
    key: String,
    id: Option<String>,
    alias: String,
    port: u16,
    ip: Ipv4Addr,
    addrs: &[Ipv4Addr],
    hostname: String,
) {
    {
        let mut reg = lock(&REGISTRY);
        let entry = reg.peers.entry(key.clone()).or_insert_with(|| PeerEntry {
            peer: Peer {
                id: key.clone(),
                ip: ip.to_string(),
                port,
                alias: alias.clone(),
                hostname: hostname.clone(),
            },
            id: id.clone(),
            addrs: Vec::new(),
            strikes: 0,
            suspect: false,
        });
        entry.peer.ip = ip.to_string();
        entry.peer.port = port;
        entry.peer.alias = alias;
        if !hostname.is_empty() {
            entry.peer.hostname = hostname;
        }
        entry.id = id;
        entry.strikes = 0;
        entry.suspect = false;
        merge_addrs(&mut entry.addrs, &[ip]);
        merge_addrs(&mut entry.addrs, addrs);
    }
    emit_peers(false);
}

/// Refresh metadata of a peer we already list (alias rename, new addresses).
/// Deliberately does NOT change the active `ip`: probing decides that, so the
/// address never flaps just because a record was re-announced.
fn update_known(key: &str, alias: &str, port: u16, addrs: &[Ipv4Addr]) -> bool {
    let known = {
        let mut reg = lock(&REGISTRY);
        match reg.peers.get_mut(key) {
            Some(e) => {
                e.peer.alias = alias.to_string();
                e.peer.port = port;
                merge_addrs(&mut e.addrs, addrs);
                true
            }
            None => false,
        }
    };
    if known {
        emit_peers(false);
    }
    known
}

fn mark_suspect(key_lower: &str, fullname_lower: &str) -> bool {
    let mut reg = lock(&REGISTRY);
    let mut hit = false;
    for (k, e) in reg.peers.iter_mut() {
        let kl = k.to_lowercase();
        if kl == key_lower || kl == fullname_lower {
            e.suspect = true;
            hit = true;
        }
    }
    hit
}

// ---------------------------------------------------------------------------
// Address helpers
// ---------------------------------------------------------------------------

fn usable_v4(ip: &Ipv4Addr) -> bool {
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_broadcast())
}

/// Our own routable IPv4 addresses, sorted for cheap change detection.
fn local_ipv4s() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in list {
            if let IpAddr::V4(v4) = ip {
                if usable_v4(&v4) && !out.contains(&v4) {
                    out.push(v4);
                }
            }
        }
    }
    if out.is_empty() {
        if let Ok(IpAddr::V4(v4)) = local_ip_address::local_ip() {
            if usable_v4(&v4) {
                out.push(v4);
            }
        }
    }
    out.sort();
    out
}

fn same_24(a: &Ipv4Addr, b: &Ipv4Addr) -> bool {
    a.octets()[..3] == b.octets()[..3]
}

/// Try addresses on a network we are actually attached to first, then private
/// ranges, then the rest. A device with a VPN/Docker adapter advertises several
/// addresses and only one of them is usually routable from here.
fn prefer_order(addrs: &mut [Ipv4Addr], locals: &[Ipv4Addr]) {
    addrs.sort_by_key(|a| {
        (
            !locals.iter().any(|l| same_24(l, a)),
            !a.is_private(),
            *a,
        )
    });
}

// ---------------------------------------------------------------------------
// Tiny HTTP client (std only, HTTP/1.0 so replies are never chunked)
// ---------------------------------------------------------------------------

fn build_request(method: &str, path: &str, host: &str, body: Option<&str>) -> String {
    match body {
        Some(b) => format!(
            "{method} {path} HTTP/1.0\r\nHost: {host}\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{b}",
            b.len()
        ),
        None => format!("{method} {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n"),
    }
}

fn parse_response(raw: &[u8]) -> Option<(u16, String)> {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = text.split_once("\r\n\r\n")?;
    let status = head.lines().next()?.split_whitespace().nth(1)?.parse().ok()?;
    Some((status, body.to_string()))
}

fn http_exchange(
    addr: SocketAddr,
    request: &str,
    connect_timeout: Duration,
) -> io::Result<(u16, String)> {
    let mut stream = TcpStream::connect_timeout(&addr, connect_timeout)?;
    stream.set_read_timeout(Some(PROBE_TIMEOUT))?;
    stream.set_write_timeout(Some(PROBE_TIMEOUT))?;
    let _ = stream.set_nodelay(true);
    stream.write_all(request.as_bytes())?;

    let mut buf = Vec::new();
    let read = (&mut stream).take(64 * 1024).read_to_end(&mut buf);
    // A timeout after a complete reply is fine; judge by what we got.
    match parse_response(&buf) {
        Some(parsed) => Ok(parsed),
        None => Err(read.err().unwrap_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "malformed HTTP response")
        })),
    }
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

enum Single {
    Alive(Option<DeviceInfo>),
    /// Something answered but it is not (or no longer) the device we expect, or
    /// nothing is listening at all.
    Gone,
    /// No usable answer (timeout, 5xx, garbled). Inconclusive.
    Unreachable,
}

enum ProbeResult {
    Alive { ip: Ipv4Addr, info: Option<DeviceInfo> },
    Gone,
    Unreachable,
}

/// One HTTP exchange with `ip:port`. With `announce` we `POST /announce` (which
/// also introduces us); otherwise a plain `GET /info`.
fn probe_one(
    ip: Ipv4Addr,
    port: u16,
    expected: Option<&str>,
    announce: bool,
    connect_timeout: Duration,
) -> Single {
    let addr = SocketAddr::new(IpAddr::V4(ip), port);
    let host = format!("{}:{}", ip, port);
    let request = if announce {
        let body = serde_json::to_string(&identity()).unwrap_or_default();
        build_request("POST", "/announce", &host, Some(&body))
    } else {
        build_request("GET", "/info", &host, None)
    };

    match http_exchange(addr, &request, connect_timeout) {
        Ok((200, body)) => match serde_json::from_str::<DeviceInfo>(&body) {
            Ok(info) if info.app == APP_TAG => match expected {
                Some(id) if id != info.id => Single::Gone,
                _ => Single::Alive(Some(info)),
            },
            // 200 but not our protocol.
            _ => {
                if expected.is_some() {
                    Single::Gone
                } else {
                    Single::Alive(None)
                }
            }
        },
        // A server without /info or /announce: an older build of this app (fine
        // if we only know it by mDNS name) — but never a v2 peer.
        Ok((404, _)) | Ok((405, _)) => {
            if expected.is_some() {
                Single::Gone
            } else {
                Single::Alive(None)
            }
        }
        Ok(_) => Single::Unreachable,
        Err(e) if e.kind() == io::ErrorKind::ConnectionRefused => Single::Gone,
        Err(_) => Single::Unreachable,
    }
}

/// Probe every candidate address in parallel; the first live one (in the given
/// order) wins.
fn probe_addrs(
    addrs: &[Ipv4Addr],
    port: u16,
    expected: Option<&str>,
    announce: bool,
) -> ProbeResult {
    if addrs.is_empty() {
        return ProbeResult::Unreachable;
    }
    let results: Vec<(Ipv4Addr, Single)> = if addrs.len() == 1 {
        vec![(addrs[0], probe_one(addrs[0], port, expected, announce, PROBE_TIMEOUT))]
    } else {
        thread::scope(|s| {
            let handles: Vec<_> = addrs
                .iter()
                .map(|ip| {
                    let ip = *ip;
                    s.spawn(move || (ip, probe_one(ip, port, expected, announce, PROBE_TIMEOUT)))
                })
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        })
    };

    let mut all_gone = true;
    let mut found: Option<(Ipv4Addr, Option<DeviceInfo>)> = None;
    for (ip, res) in results {
        match res {
            Single::Alive(info) => {
                if found.is_none() {
                    found = Some((ip, info));
                }
                all_gone = false;
            }
            Single::Gone => {}
            Single::Unreachable => all_gone = false,
        }
    }
    match found {
        Some((ip, info)) => ProbeResult::Alive { ip, info },
        None if all_gone => ProbeResult::Gone,
        None => ProbeResult::Unreachable,
    }
}

/// Verify a candidate in the background and list it if it answers. Retries a
/// few times because a peer may advertise before its HTTP server is bound.
fn spawn_verify(
    key: String,
    expected_id: Option<String>,
    alias: String,
    port: u16,
    mut addrs: Vec<Ipv4Addr>,
    hostname: String,
) {
    {
        let mut reg = lock(&REGISTRY);
        if !reg.inflight.insert(key.clone()) {
            return;
        }
    }
    prefer_order(&mut addrs, &local_ipv4s());

    thread::spawn(move || {
        let mut listed = false;
        for attempt in 0..3 {
            match probe_addrs(&addrs, port, expected_id.as_deref(), true) {
                ProbeResult::Alive { ip, info } => {
                    let alias = info.as_ref().map(|i| i.alias.clone()).unwrap_or(alias.clone());
                    eprintln!("Peer verified: {} ({}:{}) as '{}'", key, ip, port, alias);
                    upsert_verified(
                        key.clone(),
                        expected_id.clone(),
                        alias,
                        port,
                        ip,
                        &addrs,
                        hostname.clone(),
                    );
                    listed = true;
                    break;
                }
                ProbeResult::Gone | ProbeResult::Unreachable => {
                    if attempt < 2 {
                        thread::sleep(Duration::from_millis(1000));
                    }
                }
            }
        }
        if !listed {
            eprintln!(
                "Peer {} announced addresses {:?}:{} but none answered; not listing it \
                 (firewall, client isolation, or VPN-only address?)",
                key, addrs, port
            );
        }
        lock(&REGISTRY).inflight.remove(&key);
    });
}

struct ProbeJob {
    key: String,
    addrs: Vec<Ipv4Addr>,
    port: u16,
    expected: Option<String>,
}

fn run_probe_round() {
    let locals = local_ipv4s();
    let jobs: Vec<ProbeJob> = {
        let reg = lock(&REGISTRY);
        reg.peers
            .iter()
            .map(|(k, e)| {
                let mut addrs = e.addrs.clone();
                prefer_order(&mut addrs, &locals);
                // Current address first: stable unless it actually fails.
                if let Ok(cur) = e.peer.ip.parse::<Ipv4Addr>() {
                    addrs.retain(|a| *a != cur);
                    addrs.insert(0, cur);
                }
                ProbeJob {
                    key: k.clone(),
                    addrs,
                    port: e.peer.port,
                    expected: e.id.clone(),
                }
            })
            .collect()
    };
    if jobs.is_empty() {
        return;
    }

    let results: Vec<(String, ProbeResult)> = thread::scope(|s| {
        let handles: Vec<_> = jobs
            .iter()
            .map(|j| {
                s.spawn(move || {
                    (
                        j.key.clone(),
                        probe_addrs(&j.addrs, j.port, j.expected.as_deref(), false),
                    )
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });

    {
        let mut reg = lock(&REGISTRY);
        for (key, res) in results {
            let evict = match (reg.peers.get_mut(&key), res) {
                (None, _) => false,
                (Some(e), ProbeResult::Alive { ip, info }) => {
                    e.strikes = 0;
                    e.suspect = false;
                    e.peer.ip = ip.to_string();
                    if let Some(info) = info {
                        e.peer.alias = info.alias;
                    }
                    false
                }
                (Some(_), ProbeResult::Gone) => true,
                (Some(e), ProbeResult::Unreachable) => {
                    e.strikes += 1;
                    eprintln!("Peer {} unreachable (strike {}/{})", key, e.strikes, EVICT_STRIKES);
                    e.strikes >= EVICT_STRIKES
                }
            };
            if evict {
                eprintln!("Evicting peer {}", key);
                reg.peers.remove(&key);
            }
        }
    }
    emit_peers(false);
}

fn any_suspect() -> bool {
    lock(&REGISTRY)
        .peers
        .values()
        .any(|e| e.suspect || e.strikes > 0)
}

// ---------------------------------------------------------------------------
// Subnet scan (multicast-free fallback)
// ---------------------------------------------------------------------------

fn scan_now() {
    if SCANNING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(|| {
        run_scan();
        SCANNING.store(false, Ordering::SeqCst);
    });
}

fn run_scan() {
    let locals = local_ipv4s();
    let me = identity();
    let mut ports = vec![me.port];
    if me.port != DEFAULT_PORT {
        ports.push(DEFAULT_PORT);
    }

    let known: HashSet<(Ipv4Addr, u16)> = {
        let reg = lock(&REGISTRY);
        reg.peers
            .values()
            .filter_map(|e| e.peer.ip.parse().ok().map(|ip| (ip, e.peer.port)))
            .collect()
    };

    let mut targets: Vec<(Ipv4Addr, u16)> = Vec::new();
    let mut prefixes: HashSet<[u8; 3]> = HashSet::new();
    for local in locals.iter().filter(|ip| ip.is_private()) {
        let o = local.octets();
        let prefix = [o[0], o[1], o[2]];
        if prefixes.contains(&prefix) {
            continue;
        }
        if prefixes.len() >= MAX_SCAN_SUBNETS {
            break;
        }
        prefixes.insert(prefix);
        for host in 1..=254u8 {
            let target = Ipv4Addr::new(o[0], o[1], o[2], host);
            if locals.contains(&target) {
                continue;
            }
            for port in &ports {
                if !known.contains(&(target, *port)) {
                    targets.push((target, *port));
                }
            }
        }
    }
    if targets.is_empty() {
        return;
    }
    eprintln!(
        "Subnet scan: {} targets across {} subnet(s)",
        targets.len(),
        prefixes.len()
    );

    let next = AtomicUsize::new(0);
    let workers = SCAN_WORKERS.min(targets.len());
    thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(&(ip, port)) = targets.get(i) else { break };
                if let Single::Alive(Some(info)) =
                    probe_one(ip, port, None, true, SCAN_CONNECT_TIMEOUT)
                {
                    let me = identity();
                    if info.id.is_empty() || info.id == me.id {
                        continue;
                    }
                    eprintln!("Scan found peer {} at {}:{}", info.id, ip, port);
                    upsert_verified(
                        info.id.clone(),
                        Some(info.id.clone()),
                        info.alias.clone(),
                        info.port,
                        ip,
                        &[ip],
                        String::new(),
                    );
                }
            });
        }
    });
}

fn announce_all() {
    let targets: Vec<(Vec<Ipv4Addr>, u16, Option<String>)> = {
        let reg = lock(&REGISTRY);
        reg.peers
            .values()
            .map(|e| {
                let mut addrs = vec![];
                if let Ok(cur) = e.peer.ip.parse::<Ipv4Addr>() {
                    addrs.push(cur);
                }
                (addrs, e.peer.port, e.id.clone())
            })
            .collect()
    };
    for (addrs, port, id) in targets {
        thread::spawn(move || {
            let _ = probe_addrs(&addrs, port, id.as_deref(), true);
        });
    }
}

// ---------------------------------------------------------------------------
// Maintenance thread: probing, scanning, network-change detection
// ---------------------------------------------------------------------------

fn maintenance_loop(rx: std::sync::mpsc::Receiver<MaintCommand>) {
    let start = Instant::now();
    let mut next_probe = start + Duration::from_secs(2);
    let mut next_scan = start + Duration::from_millis(500);
    let mut next_iface = start + IFACE_CHECK_INTERVAL;
    let mut last_ifaces = local_ipv4s();

    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(MaintCommand::Now) => {
                let now = Instant::now();
                next_probe = now;
                next_scan = now;
            }
            Ok(MaintCommand::Suspect) => {
                let soon = Instant::now() + Duration::from_millis(300);
                if soon < next_probe {
                    next_probe = soon;
                }
            }
            Ok(MaintCommand::AnnounceAll) => announce_all(),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        let now = Instant::now();

        if now >= next_iface {
            next_iface = now + IFACE_CHECK_INTERVAL;
            let current = local_ipv4s();
            if current != last_ifaces {
                eprintln!("Network interfaces changed: {:?} -> {:?}", last_ifaces, current);
                last_ifaces = current;
                send_mdns(MdnsCommand::Refresh);
                next_scan = now;
                next_probe = now;
            }
        }

        if now >= next_probe {
            run_probe_round();
            next_probe = Instant::now()
                + if any_suspect() {
                    SUSPECT_PROBE_INTERVAL
                } else {
                    PROBE_INTERVAL
                };
        }

        if now >= next_scan {
            scan_now();
            next_scan = Instant::now() + SCAN_INTERVAL;
        }
    }
}

// ---------------------------------------------------------------------------
// mDNS thread
// ---------------------------------------------------------------------------

fn register_on(daemon: &ServiceDaemon) -> Result<(), String> {
    let me = identity();
    let short: String = me.id.chars().filter(|c| c.is_ascii_alphanumeric()).take(12).collect();
    // The host name must be unique per device. `hostname::get()` returns
    // "localhost" on many Android builds, so two phones would share one host
    // record and each service would resolve to BOTH phones' addresses.
    let host = format!("ls-{}.local.", short);
    let port_s = me.port.to_string();
    let props = [
        ("alias", me.alias.as_str()),
        ("id", me.id.as_str()),
        ("port", port_s.as_str()),
        ("v", "2"),
    ];
    // Empty address + addr_auto: mdns-sd publishes ALL current interface
    // addresses and keeps them updated when Wi-Fi reconnects or the IP changes.
    // (Previously a single address from `local_ip()` was frozen at startup and
    // could be a VPN/virtual adapter.)
    let info = ServiceInfo::new(SERVICE_TYPE, &me.id, &host, "", me.port, &props[..])
        .map_err(|e| format!("Failed to create ServiceInfo: {}", e))?
        .enable_addr_auto();
    daemon
        .register(info)
        .map_err(|e| format!("Failed to register service: {}", e))?;
    eprintln!("mDNS service registered: {} as '{}' on port {}", me.id, me.alias, me.port);
    Ok(())
}

fn start_daemon() -> Result<(ServiceDaemon, mdns_sd::Receiver<ServiceEvent>), String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;
    if let Err(e) = register_on(&daemon) {
        // Browsing still works without our own record, and the HTTP paths keep
        // us visible; surface the error but carry on.
        eprintln!("✗ {}", e);
    }
    let rx = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| format!("Failed to start browse: {}", e))?;
    eprintln!("✓ mDNS daemon up, browsing {}", SERVICE_TYPE);
    Ok((daemon, rx))
}

fn mdns_loop(rx: std::sync::mpsc::Receiver<MdnsCommand>) {
    let mut state: Option<(ServiceDaemon, mdns_sd::Receiver<ServiceEvent>)> = None;
    let mut last_attempt = Instant::now() - DAEMON_RETRY_INTERVAL;

    loop {
        if state.is_none() && last_attempt.elapsed() >= DAEMON_RETRY_INTERVAL {
            last_attempt = Instant::now();
            match start_daemon() {
                Ok((daemon, events)) => {
                    *lock(&DAEMON) = Some(daemon.clone());
                    state = Some((daemon, events));
                    send_maint(MaintCommand::Now);
                }
                Err(e) => eprintln!("✗ mDNS unavailable ({}); retrying in 5s", e),
            }
        }

        loop {
            match rx.try_recv() {
                Ok(MdnsCommand::Refresh) => {
                    if let Some((daemon, events)) = state.as_mut() {
                        refresh_browse(daemon, events);
                    }
                }
                Ok(MdnsCommand::Reregister) => {
                    if let Some((daemon, _)) = state.as_ref() {
                        if let Err(e) = register_on(daemon) {
                            eprintln!("✗ {}", e);
                        }
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => return,
            }
        }

        match state.as_ref() {
            Some((_, events)) => match events.recv_timeout(Duration::from_millis(200)) {
                Ok(event) => handle_mdns_event(event),
                Err(_) => {
                    if events.is_disconnected() {
                        eprintln!("✗ mDNS daemon stopped; will recreate it");
                        *lock(&DAEMON) = None;
                        state = None;
                    }
                }
            },
            None => thread::sleep(Duration::from_millis(200)),
        }
    }
}

/// Restart mdns-sd's query schedule on the SAME daemon (cache and known peers
/// are untouched). The old receiver is drained first so events already queued
/// on it are not lost when it is replaced.
fn refresh_browse(daemon: &ServiceDaemon, events: &mut mdns_sd::Receiver<ServiceEvent>) {
    match daemon.browse(SERVICE_TYPE) {
        Ok(new_rx) => {
            while let Ok(event) = events.try_recv() {
                handle_mdns_event(event);
            }
            *events = new_rx;
        }
        Err(e) => eprintln!("Warning: refresh browse failed: {}", e),
    }
}

fn handle_mdns_event(event: ServiceEvent) {
    match event {
        ServiceEvent::ServiceResolved(info) => {
            let fullname = info.get_fullname().to_string();
            let alias = info
                .get_property_val_str("alias")
                .map(str::to_string)
                .unwrap_or_else(|| "Unknown".to_string());
            let txt_id = info
                .get_property_val_str("id")
                .map(str::to_string)
                .filter(|s| !s.is_empty());
            let port = info.get_port();
            let hostname = info.get_hostname().to_string();
            let me = identity();
            let locals = local_ipv4s();

            let mut addrs: Vec<Ipv4Addr> = info
                .get_addresses_v4()
                .into_iter()
                .filter(usable_v4)
                .collect();
            prefer_order(&mut addrs, &locals);

            eprintln!(
                "mDNS resolved: {} alias='{}' id={:?} addrs={:?} port={}",
                fullname, alias, txt_id, addrs, port
            );

            // Self-filter. Primary key is the device id. Pre-v2 peers have no
            // id, so for those (and as a safety net) fall back to "this is one
            // of my own addresses on my own port".
            if txt_id.as_deref() == Some(me.id.as_str()) {
                return;
            }
            let on_my_address = addrs.iter().any(|a| locals.contains(a));
            if on_my_address && (txt_id.is_none() || port == me.port) {
                eprintln!("  skipping - resolves to this machine");
                return;
            }
            if addrs.is_empty() {
                eprintln!("  skipping - no usable IPv4 address");
                return;
            }

            let key = txt_id.clone().unwrap_or_else(|| fullname.clone());
            if !update_known(&key, &alias, port, &addrs) {
                spawn_verify(key, txt_id, alias, port, addrs, hostname);
            }
        }
        ServiceEvent::ServiceRemoved(_ty, fullname) => {
            // A goodbye, or a record that expired because multicast replies got
            // lost. Only a hint — probing decides whether the peer is gone.
            let fullname_l = fullname.to_lowercase();
            let instance_l = fullname_l
                .strip_suffix(&format!(".{}", SERVICE_TYPE))
                .unwrap_or(&fullname_l)
                .to_string();
            eprintln!("mDNS removed: {} (verifying by probe)", fullname);
            if mark_suspect(&instance_l, &fullname_l) {
                send_maint(MaintCommand::Suspect);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_http_response() {
        let raw = b"HTTP/1.0 200 OK\r\ncontent-length: 2\r\n\r\n{}";
        assert_eq!(parse_response(raw), Some((200, "{}".to_string())));
        assert_eq!(parse_response(b"garbage"), None);
        let nf = b"HTTP/1.0 404 Not Found\r\n\r\n";
        assert_eq!(parse_response(nf), Some((404, String::new())));
    }

    #[test]
    fn filters_unusable_addresses() {
        assert!(!usable_v4(&Ipv4Addr::new(127, 0, 0, 1)));
        assert!(!usable_v4(&Ipv4Addr::new(169, 254, 3, 4)));
        assert!(!usable_v4(&Ipv4Addr::UNSPECIFIED));
        assert!(usable_v4(&Ipv4Addr::new(192, 168, 1, 20)));
    }

    #[test]
    fn prefers_addresses_on_our_network() {
        let locals = [Ipv4Addr::new(192, 168, 1, 50)];
        let mut addrs = [
            Ipv4Addr::new(172, 29, 0, 1),
            Ipv4Addr::new(8, 8, 4, 4),
            Ipv4Addr::new(192, 168, 1, 7),
        ];
        prefer_order(&mut addrs, &locals);
        assert_eq!(addrs[0], Ipv4Addr::new(192, 168, 1, 7));
        assert_eq!(addrs[1], Ipv4Addr::new(172, 29, 0, 1));
    }

    #[test]
    fn merges_addresses_without_duplicates() {
        let mut v = vec![Ipv4Addr::new(10, 0, 0, 1)];
        merge_addrs(&mut v, &[Ipv4Addr::new(10, 0, 0, 1), Ipv4Addr::new(10, 0, 0, 2)]);
        assert_eq!(v.len(), 2);
    }
}
