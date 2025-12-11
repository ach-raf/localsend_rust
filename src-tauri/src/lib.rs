mod config;
mod discovery;
mod server;
mod transfer;

use crate::config::{generate_anime_name, load_config, save_config, AppConfig};
use crate::discovery::{refresh_discovery, register_service, start_discovery};
use crate::server::start_server;
use crate::transfer::{send_file, send_file_bytes, send_text};
use mdns_sd::ServiceDaemon;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

#[derive(Clone)]
pub struct PendingTransfers {
    pub transfers: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

struct AppState {
    config: Mutex<AppConfig>,
    #[allow(dead_code)] // Kept alive to maintain mDNS registration
    service_daemon: Mutex<Option<ServiceDaemon>>,
    pending_transfers: PendingTransfers,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    new_config: AppConfig,
) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    *config = new_config.clone();
    save_config(&app, &new_config)?;
    // TODO: Restart services if needed
    Ok(())
}

#[tauri::command]
async fn send_file_to_peer(
    peer_ip: String,
    peer_port: u16,
    file_path: String,
) -> Result<(), String> {
    send_file(peer_ip, peer_port, file_path).await
}

#[tauri::command]
async fn send_file_bytes_to_peer(
    peer_ip: String,
    peer_port: u16,
    file_name: String,
    file_data: Vec<u8>,
) -> Result<(), String> {
    send_file_bytes(peer_ip, peer_port, file_name, file_data).await
}

#[tauri::command]
async fn send_text_to_peer(
    peer_ip: String,
    peer_port: u16,
    text: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sender_alias = state.config.lock().unwrap().alias.clone();
    send_text(peer_ip, peer_port, text, sender_alias).await
}

#[tauri::command]
fn refresh_peers() -> Result<(), String> {
    eprintln!("Refresh peers command called");
    refresh_discovery()
}

#[tauri::command]
fn generate_random_name() -> String {
    generate_anime_name()
}

#[tauri::command]
fn scan_media_file(app: AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        // On Android, call the Kotlin plugin through Tauri's plugin system
        // The MediaScannerPlugin will handle the actual media scanning
        use tauri::Emitter;
        app.emit("scan-media-file", path)
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let _ = path;
        // No-op on other platforms
    }

    Ok(())
}

#[tauri::command]
fn respond_to_file_transfer(
    state: State<'_, AppState>,
    transfer_id: String,
    accepted: bool,
) -> Result<(), String> {
    let mut transfers = state
        .pending_transfers
        .transfers
        .lock()
        .map_err(|e| format!("Failed to lock transfers: {}", e))?;

    if let Some(sender) = transfers.remove(&transfer_id) {
        sender
            .send(accepted)
            .map_err(|_| "Failed to send response".to_string())?;
        Ok(())
    } else {
        Err(format!("Transfer {} not found", transfer_id))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config = load_config(app.handle());
            let port = config.port;
            let alias = config.alias.clone();

            eprintln!("Starting LocalSend Rust on port {}", port);
            eprintln!("Device alias: {}", alias);

            // Register Service and keep daemon alive
            let daemon = match register_service(&alias, port) {
                Ok(d) => {
                    eprintln!("✓ Service registered successfully");
                    Some(d)
                }
                Err(e) => {
                    eprintln!("✗ Failed to register service: {}", e);
                    None
                }
            };

            let pending_transfers = PendingTransfers {
                transfers: Arc::new(Mutex::new(HashMap::new())),
            };

            app.manage(AppState {
                config: Mutex::new(config),
                service_daemon: Mutex::new(daemon),
                pending_transfers: pending_transfers.clone(),
            });

            // Start Discovery
            eprintln!("Starting discovery service...");
            start_discovery(app.handle().clone(), alias.clone());

            // Start HTTP Server
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                eprintln!("Starting HTTP server...");
                start_server(handle, port, pending_transfers).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_settings,
            save_settings,
            send_file_to_peer,
            send_file_bytes_to_peer,
            send_text_to_peer,
            refresh_peers,
            scan_media_file,
            generate_random_name,
            respond_to_file_transfer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
