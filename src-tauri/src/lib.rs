mod config;
mod discovery;
mod server;
mod transfer;

use crate::config::{generate_anime_name, load_config, save_config, AppConfig};
use crate::discovery::{refresh_discovery, register_service, start_discovery, update_alias};
use crate::server::start_server;
use crate::transfer::{send_file, send_file_bytes, send_text};
use mdns_sd::ServiceDaemon;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
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
    let old_alias = {
        let config = state.config.lock().unwrap();
        config.alias.clone()
    };

    let mut config = state.config.lock().unwrap();
    *config = new_config.clone();
    save_config(&app, &new_config)?;
    drop(config); // Release lock before doing heavy operations

    // If alias changed, re-register mDNS service and update discovery
    if old_alias != new_config.alias {
        eprintln!(
            "Alias changed from '{}' to '{}', re-registering service...",
            old_alias, new_config.alias
        );

        // First, explicitly unregister the old service by dropping the old daemon
        {
            let mut daemon_lock = state.service_daemon.lock().unwrap();
            if let Some(old_daemon) = daemon_lock.take() {
                eprintln!("Shutting down old mDNS service...");
                // Explicitly shutdown the old daemon to unregister the service
                if let Err(e) = old_daemon.shutdown() {
                    eprintln!("Warning: Failed to shutdown old daemon: {}", e);
                }
                // Give time for the unregistration to propagate across the network
                std::thread::sleep(std::time::Duration::from_millis(1000));
            }
        }

        // Now register the new service
        eprintln!(
            "Registering new mDNS service with alias '{}'...",
            new_config.alias
        );
        let daemon = register_service(&new_config.alias, new_config.port)?;
        *state.service_daemon.lock().unwrap() = Some(daemon);

        // Update the discovery system with new alias
        update_alias(new_config.alias.clone())?;

        // Emit event to frontend to update UI
        app.emit("alias-changed", new_config.alias.clone())
            .map_err(|e| e.to_string())?;

        eprintln!("Service re-registered and discovery updated successfully!");
    }

    Ok(())
}

#[tauri::command]
async fn send_file_to_peer(
    app: AppHandle,
    peer_ip: String,
    peer_port: u16,
    file_path: String,
) -> Result<(), String> {
    send_file(app, peer_ip, peer_port, file_path).await
}

#[tauri::command]
async fn send_file_bytes_to_peer(
    peer_ip: String,
    peer_port: u16,
    mut file_name: String,
    file_data: Vec<u8>,
) -> Result<(), String> {
    // If filename looks like an Android content URI ID (e.g., "msf_1000285299"),
    // try to infer a better name from file content
    if file_name.starts_with("msf_") || file_name.starts_with("document_") {
        if !file_name.contains('.') {
            // Check for APK signature first (ZIP with AndroidManifest.xml)
            // APKs start with PK (ZIP) but contain specific files
            let is_apk = if file_data.len() > 30 {
                // Check if it's a ZIP and look for APK-specific indicators
                file_data.starts_with(&[0x50, 0x4B, 0x03, 0x04]) // PK ZIP signature
                    && (
                        // Look for AndroidManifest in the file data (simple heuristic)
                        String::from_utf8_lossy(&file_data[..file_data.len().min(8192)])
                            .contains("AndroidManifest")
                    )
            } else {
                false
            };

            if is_apk {
                file_name = format!("app.apk");
                eprintln!("Detected APK file, using filename: {}", file_name);
            } else if let Some(kind) = infer::get(&file_data) {
                let ext = kind.extension();
                eprintln!("Inferred extension for {}: .{}", file_name, ext);
                // For common types, use a generic but descriptive name
                let mime_type = kind.mime_type();
                file_name = match mime_type {
                    s if s.starts_with("image/") => format!("image.{}", ext),
                    s if s.starts_with("video/") => format!("video.{}", ext),
                    s if s.starts_with("audio/") => format!("audio.{}", ext),
                    "application/pdf" => format!("document.{}", ext),
                    "application/vnd.android.package-archive" => format!("app.apk"),
                    "application/zip" => format!("archive.{}", ext),
                    _ => format!("file.{}", ext),
                };
                eprintln!("Using inferred filename: {}", file_name);
            }
        }
    }

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
async fn scan_media_file(app: AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::{AndroidFsExt, FileUri};
        use tauri_plugin_fs::FilePath;

        // Use the Android FS plugin to scan the file
        let api = app.android_fs_async();
        let url =
            url::Url::parse(&path).map_err(|e| format!("Failed to parse content URI: {}", e))?;
        let fs_path = FilePath::Url(url);
        let uri: FileUri = fs_path.into();
        api.public_storage()
            .scan(&uri)
            .await
            .map_err(|e| format!("Failed to scan media file: {}", e))?;
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

#[tauri::command]
async fn get_file_name(app: AppHandle, file_path: String) -> Result<String, String> {
    // Handle Android content URIs like content://.../msf:1000285299
    // or content://.../document/12345
    if file_path.starts_with("content://") {
        #[cfg(target_os = "android")]
        {
            use tauri_plugin_android_fs::{AndroidFsExt, FileUri};
            use tauri_plugin_fs::FilePath;

            // Use the Android FS plugin to get the file name from the URI
            let api = app.android_fs_async();
            let url = url::Url::parse(&file_path)
                .map_err(|e| format!("Failed to parse content URI: {}", e))?;
            let fs_path = FilePath::Url(url);
            let uri: FileUri = fs_path.into();
            return match api.get_name(&uri).await {
                Ok(name) => Ok(name),
                Err(e) => {
                    eprintln!("Failed to get name from Android FS API: {}", e);
                    // Fallback: try to extract from URI
                    if let Some(last_segment) = file_path.split('/').last() {
                        // Remove any query parameters or fragments
                        let clean_segment = last_segment.split('?').next().unwrap_or(last_segment);
                        if clean_segment.contains('.') && !clean_segment.contains(':') {
                            Ok(clean_segment.to_string())
                        } else {
                            Err(format!("Failed to get filename from URI: {}", e))
                        }
                    } else {
                        Err(format!("Failed to get filename from URI: {}", e))
                    }
                }
            };
        }

        #[cfg(not(target_os = "android"))]
        {
            return Err("Content URIs are only supported on Android".to_string());
        }
    }

    // Regular file path - extract filename
    let path = std::path::Path::new(&file_path);
    if let Some(file_name) = path.file_name() {
        Ok(file_name.to_string_lossy().to_string())
    } else {
        Err("Invalid file path".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_android_fs::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let config = load_config(app.handle());
            let port = config.port;
            let alias = config.alias.clone();

            eprintln!("Starting LocalShare Rust on port {}", port);
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
            respond_to_file_transfer,
            get_file_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
