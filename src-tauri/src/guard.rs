//! Inbound-request hygiene: everything a peer sends us is untrusted input.
//!
//! These are small, pure helpers (so they can be unit-tested) used by the HTTP
//! server to decide *who* may talk to us, *how often*, and what is safe to put
//! on disk or on screen.

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Only devices on the local network may talk to us. The server binds
/// `0.0.0.0`, so without this a port-forward, VPN or a mis-routed interface
/// would expose the "accept this file?" prompt to the internet.
pub fn is_lan_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_lan_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_lan_v4(mapped);
            }
            is_lan_v6(v6)
        }
    }
}

fn is_lan_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        // 100.64.0.0/10 — carrier-grade NAT, also what Tailscale uses.
        || (o[0] == 100 && (64..=127).contains(&o[1]))
}

fn is_lan_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    ip.is_loopback()
        || (first & 0xfe00) == 0xfc00 // unique local fc00::/7
        || (first & 0xffc0) == 0xfe80 // link local fe80::/10
}

/// Sliding-window limiter keyed by source IP. A peer that spams "send me a
/// file" requests would otherwise bury the receiver in prompts.
pub struct RateLimiter {
    hits: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
    max: usize,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            hits: Mutex::new(HashMap::new()),
            max,
            window,
        }
    }

    /// Records an attempt; `false` means the caller is over its budget.
    pub fn allow(&self, ip: IpAddr) -> bool {
        self.allow_at(ip, Instant::now())
    }

    fn allow_at(&self, ip: IpAddr, now: Instant) -> bool {
        let mut hits = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        // Opportunistic cleanup keeps the map from growing with every IP seen.
        if hits.len() > 256 {
            hits.retain(|_, q| {
                q.back()
                    .is_some_and(|t| now.duration_since(*t) < self.window)
            });
        }
        let queue = hits.entry(ip).or_default();
        while queue
            .front()
            .is_some_and(|t| now.duration_since(*t) >= self.window)
        {
            queue.pop_front();
        }
        if queue.len() >= self.max {
            return false;
        }
        queue.push_back(now);
        true
    }
}

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

const MAX_FILENAME_BYTES: usize = 160;

/// Turns a peer-supplied name into something safe to create in the downloads
/// folder: no path components, no characters Windows/Android reject, no
/// reserved device names, bounded length. Never returns an empty string.
pub fn sanitize_filename(raw: &str) -> String {
    // Peers may send "a/b/c.txt" or "..\\..\\evil.exe": keep the last component.
    let last = raw.rsplit(['/', '\\']).next().unwrap_or(raw);

    let cleaned: String = last
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();

    // Windows silently strips trailing dots/spaces, which can alias another file.
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    let mut name = if trimmed.is_empty() {
        "file".to_string()
    } else {
        trimmed.to_string()
    };

    let stem_upper = split_ext(&name).0.to_ascii_uppercase();
    if WINDOWS_RESERVED.contains(&stem_upper.as_str()) {
        name = format!("_{name}");
    }

    if name.len() > MAX_FILENAME_BYTES {
        let (stem, ext) = split_ext(&name);
        // Keep the extension (it decides how the file opens), trim the stem.
        let ext_len = ext.len().min(24);
        let budget = MAX_FILENAME_BYTES.saturating_sub(ext_len + 1);
        let mut cut = stem.len().min(budget);
        while cut > 0 && !stem.is_char_boundary(cut) {
            cut -= 1;
        }
        name = if ext.is_empty() {
            stem[..cut].to_string()
        } else {
            format!("{}.{}", &stem[..cut], &ext[..ext_len])
        };
    }
    name
}

/// Splits `name.ext` at the last dot; a leading dot is part of the stem.
fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i + 1..]),
        _ => (name, ""),
    }
}

/// `photo.jpg` → `photo (1).jpg`, `photo (2).jpg`, …
#[cfg_attr(target_os = "android", allow(dead_code))]
pub fn numbered_name(name: &str, n: u32) -> String {
    let (stem, ext) = split_ext(name);
    if ext.is_empty() {
        format!("{stem} ({n})")
    } else {
        format!("{stem} ({n}).{ext}")
    }
}

/// Display name for a peer: control characters stripped, bounded, never blank.
pub fn sanitize_alias(raw: &str) -> String {
    let cleaned: String = raw.chars().filter(|c| !c.is_control()).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return "Unknown device".to_string();
    }
    trimmed.chars().take(64).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_addresses_pass_and_public_ones_do_not() {
        for ok in ["192.168.1.20", "10.0.0.5", "172.20.1.1", "127.0.0.1", "169.254.3.4", "100.100.1.1"] {
            assert!(is_lan_ip(ok.parse().unwrap()), "{ok} should be LAN");
        }
        for bad in ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34"] {
            assert!(!is_lan_ip(bad.parse().unwrap()), "{bad} should be blocked");
        }
        assert!(is_lan_ip("::1".parse().unwrap()));
        assert!(is_lan_ip("fe80::1".parse().unwrap()));
        assert!(is_lan_ip("fd12:3456::1".parse().unwrap()));
        assert!(is_lan_ip("::ffff:192.168.1.9".parse().unwrap()));
        assert!(!is_lan_ip("2001:4860:4860::8888".parse().unwrap()));
        assert!(!is_lan_ip("::ffff:8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn rate_limiter_blocks_bursts_then_recovers() {
        let limiter = RateLimiter::new(3, Duration::from_secs(10));
        let ip: IpAddr = "192.168.1.2".parse().unwrap();
        let other: IpAddr = "192.168.1.3".parse().unwrap();
        let t0 = Instant::now();
        assert!(limiter.allow_at(ip, t0));
        assert!(limiter.allow_at(ip, t0));
        assert!(limiter.allow_at(ip, t0));
        assert!(!limiter.allow_at(ip, t0));
        assert!(limiter.allow_at(other, t0), "budgets are per source");
        assert!(limiter.allow_at(ip, t0 + Duration::from_secs(11)));
    }

    #[test]
    fn filenames_cannot_escape_or_break_the_filesystem() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(sanitize_filename("a/b/c.txt"), "c.txt");
        assert_eq!(sanitize_filename(".."), "file");
        assert_eq!(sanitize_filename("   "), "file");
        assert_eq!(sanitize_filename("report.pdf. "), "report.pdf");
        assert_eq!(sanitize_filename("what?*.txt"), "what__.txt");
        assert_eq!(sanitize_filename("image:1000283390"), "image_1000283390");
        assert_eq!(sanitize_filename("CON"), "_CON");
        assert_eq!(sanitize_filename("nul.txt"), "_nul.txt");
        assert_eq!(sanitize_filename("tab\tname.txt"), "tab_name.txt");
        assert_eq!(sanitize_filename("holiday photo.jpg"), "holiday photo.jpg");
        // Leading dots are stripped so peers can't drop hidden files.
        assert_eq!(sanitize_filename(".bashrc"), "bashrc");
    }

    #[test]
    fn long_names_keep_their_extension() {
        let long = format!("{}.mp4", "x".repeat(400));
        let out = sanitize_filename(&long);
        assert!(out.len() <= MAX_FILENAME_BYTES);
        assert!(out.ends_with(".mp4"));
        let multibyte = format!("{}.txt", "é".repeat(300));
        let out = sanitize_filename(&multibyte);
        assert!(out.len() <= MAX_FILENAME_BYTES && out.ends_with(".txt"));
    }

    #[test]
    fn collision_names_are_readable() {
        assert_eq!(numbered_name("photo.jpg", 2), "photo (2).jpg");
        assert_eq!(numbered_name("README", 1), "README (1)");
        assert_eq!(numbered_name("a.tar.gz", 1), "a.tar (1).gz");
    }

    #[test]
    fn aliases_are_bounded_and_never_blank() {
        assert_eq!(sanitize_alias("  Naruto\n"), "Naruto");
        assert_eq!(sanitize_alias("\u{7}\u{0}"), "Unknown device");
        assert_eq!(sanitize_alias(&"a".repeat(200)).chars().count(), 64);
    }
}
