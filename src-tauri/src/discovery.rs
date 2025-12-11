use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// Global handle to the discovery system
static DISCOVERY_CONTROL: Lazy<Arc<Mutex<Option<Sender<DiscoveryCommand>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub ip: String,
    pub port: u16,
    pub alias: String,
    pub hostname: String,
}

enum DiscoveryCommand {
    Refresh,
}

pub fn start_discovery(app: AppHandle, my_alias: String) {
    let service_type = "_myshare_app._tcp.local.";

    eprintln!("Starting discovery - filtering out self: {}", my_alias);

    let peers_map: Arc<Mutex<HashMap<String, Peer>>> = Arc::new(Mutex::new(HashMap::new()));
    let peers_map_clone = peers_map.clone();

    // Create control channel for refresh commands
    let (cmd_sender, cmd_receiver) = channel::<DiscoveryCommand>();
    *DISCOVERY_CONTROL.lock().unwrap() = Some(cmd_sender);

    thread::spawn(move || {
        eprintln!("mDNS discovery thread started");

        // Flag to force refresh
        let mut should_restart = true;
        let mut daemon_opt: Option<ServiceDaemon> = None;

        loop {
            // Create or recreate daemon if needed
            if should_restart {
                eprintln!("Starting new mDNS browse...");

                // Shutdown old daemon if exists
                if let Some(old_daemon) = daemon_opt.take() {
                    let _ = old_daemon.shutdown();
                    thread::sleep(Duration::from_millis(200));
                }

                // Create new daemon
                match ServiceDaemon::new() {
                    Ok(daemon) => {
                        match daemon.browse(service_type) {
                            Ok(receiver) => {
                                eprintln!("✓ mDNS browse started successfully");
                                daemon_opt = Some(daemon);

                                // Process events with timeout
                                loop {
                                    // Check for refresh command
                                    if let Ok(DiscoveryCommand::Refresh) = cmd_receiver.try_recv() {
                                        eprintln!("Refresh command received!");
                                        should_restart = true;
                                        break;
                                    }

                                    match receiver.recv_timeout(Duration::from_millis(500)) {
                                        Ok(event) => {
                                            process_mdns_event(
                                                event,
                                                &my_alias,
                                                &peers_map_clone,
                                                &app,
                                            );
                                        }
                                        Err(_) => {
                                            // Timeout - just continue to check for commands
                                            continue;
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("✗ Failed to start browse: {}", e);
                                thread::sleep(Duration::from_secs(5));
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("✗ Failed to create daemon: {}", e);
                        thread::sleep(Duration::from_secs(5));
                    }
                }
            }
        }
    });
}

fn process_mdns_event(
    event: ServiceEvent,
    my_alias: &str,
    peers_map: &Arc<Mutex<HashMap<String, Peer>>>,
    app: &AppHandle,
) {
    match event {
        ServiceEvent::SearchStarted(service_type) => {
            eprintln!("mDNS search started for {}", service_type);
        }
        ServiceEvent::ServiceFound(service_type, fullname) => {
            eprintln!("Service found: {} (type: {})", fullname, service_type);
        }
        ServiceEvent::ServiceResolved(info) => {
            eprintln!("Service resolved: {}", info.get_fullname());

            // Get alias first to check if this is our own device
            let alias = match info.get_property_val("alias") {
                Some(val) => {
                    // Handle the nested Option structure
                    match val {
                        Some(bytes) => String::from_utf8_lossy(bytes).to_string(),
                        None => "Unknown".to_string(),
                    }
                }
                None => "Unknown".to_string(),
            };

            eprintln!("  Alias: {}", alias);

            // Skip if this is our own device (simple alias comparison)
            if alias == my_alias {
                eprintln!("  Skipping - this is our own device");
                return;
            }

            // Get all IP addresses from the service
            let addresses: Vec<String> = info
                .get_addresses()
                .iter()
                .map(|ip| ip.to_string())
                .collect();

            eprintln!("  Addresses: {:?}", addresses);
            eprintln!("  Port: {}", info.get_port());

            // Get the first valid IP address
            let ip = addresses
                .iter()
                .find(|addr| !addr.is_empty())
                .cloned()
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

                eprintln!("  Adding peer: {} ({}:{})", alias, ip, port);
                peers_map.lock().unwrap().insert(key, peer);
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
        &ip_addr.to_string(),
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
