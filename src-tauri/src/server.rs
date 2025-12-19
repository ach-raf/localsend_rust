use crate::PendingTransfers;
use axum::{
    extract::{DefaultBodyLimit, Multipart, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Instant;
use tauri::Emitter;
use tauri::{AppHandle, Manager}; // Import Manager for path()
use tokio::fs::{self};
use tokio::sync::oneshot;
use urlencoding::decode;

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{AndroidFsExt, PublicGeneralPurposeDir};

#[derive(Clone)]
struct ServerState {
    app_handle: AppHandle,
    download_dir: PathBuf,
    pending_transfers: PendingTransfers,
}

#[derive(Serialize, Clone)]
struct FileTransferRequest {
    transfer_id: String,
    file_name: String,
    file_size: Option<u64>,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    transfer_id: String,
    current_bytes: u64,
    total_bytes: Option<u64>,
}

#[derive(Deserialize, Serialize, Clone)]
struct MessagePayload {
    sender_alias: String,
    content: String,
}

pub async fn start_server(app: AppHandle, port: u16, pending_transfers: PendingTransfers) {
    // Get the proper Downloads directory for the platform
    let download_dir = if cfg!(target_os = "android") {
        // On Android, use the public Downloads directory
        // This path is standard on Android
        PathBuf::from("/storage/emulated/0/Downloads")
    } else if cfg!(target_os = "windows") {
        // On Windows, use the user's Downloads folder
        app.path().download_dir().unwrap_or_else(|_| {
            // Fallback: try to construct the path manually
            if let Ok(user_profile) = std::env::var("USERPROFILE") {
                PathBuf::from(user_profile).join("Downloads")
            } else {
                PathBuf::from("downloads")
            }
        })
    } else {
        // On other platforms (Linux, macOS), use the system download directory
        app.path()
            .download_dir()
            .unwrap_or_else(|_| PathBuf::from("downloads"))
    };

    // Ensure download directory exists
    if !download_dir.exists() {
        if let Err(e) = fs::create_dir_all(&download_dir).await {
            eprintln!("Failed to create download directory: {}", e);
        }
    }

    eprintln!("Download directory: {:?}", download_dir);

    let state = ServerState {
        app_handle: app.clone(),
        download_dir,
        pending_transfers,
    };

    let app_router = Router::new()
        .route("/upload", post(upload_handler))
        .route("/message", post(message_handler))
        .route("/ping", get(|| async { "pong" }))
        .layer(DefaultBodyLimit::disable()) // Disable body size limit for file transfers
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    println!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app_router).await.unwrap();
}

async fn upload_handler(State(state): State<ServerState>, mut multipart: Multipart) {
    let mut file_size: Option<u64> = None;

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "size" {
            if let Ok(txt) = field.text().await {
                file_size = txt.parse().ok();
                eprintln!("Received file size: {:?}", file_size);
            }
            continue;
        }

        let raw_file_name = if let Some(name) = field.file_name() {
            name.to_string()
        } else {
            continue;
        };

        // Decode URL-encoded filename (e.g., image%3A1000283390 -> image:1000283390)
        let file_name = decode(&raw_file_name)
            .map(|s| s.to_string())
            .unwrap_or_else(|_| raw_file_name.clone());

        // Sanitize filename to remove problematic characters (like :)
        let mut sanitized_name = file_name
            .replace(':', "_")
            .replace('/', "_")
            .replace('\\', "_");

        eprintln!(
            "Receiving file: {} (original: {})",
            sanitized_name, raw_file_name
        );

        // Generate a unique transfer ID
        let transfer_id = format!(
            "{}_{}",
            sanitized_name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );

        // Create a oneshot channel for the response
        let (tx, rx) = oneshot::channel();

        // Store the sender in pending_transfers
        {
            let mut transfers = state.pending_transfers.transfers.lock().unwrap();
            transfers.insert(transfer_id.clone(), tx);
        }

        // Emit event to frontend requesting confirmation
        let request = FileTransferRequest {
            transfer_id: transfer_id.clone(),
            file_name: sanitized_name.clone(),
            file_size,
        };

        if let Err(e) = state.app_handle.emit("file-transfer-request", &request) {
            eprintln!("Failed to emit file-transfer-request: {}", e);
            // Clean up
            let mut transfers = state.pending_transfers.transfers.lock().unwrap();
            transfers.remove(&transfer_id);
            continue;
        }

        eprintln!(
            "Waiting for user confirmation for transfer: {}",
            transfer_id
        );

        // Wait for user response (with timeout)
        let accepted = match tokio::time::timeout(
            std::time::Duration::from_secs(60), // 60 second timeout
            rx,
        )
        .await
        {
            Ok(Ok(response)) => {
                eprintln!("User response for {}: {}", transfer_id, response);
                response
            }
            Ok(Err(_)) => {
                eprintln!("Channel closed for transfer: {}", transfer_id);
                false
            }
            Err(_) => {
                eprintln!("Timeout waiting for confirmation: {}", transfer_id);
                let _ = state.app_handle.emit("file-transfer-timeout", &transfer_id);
                false
            }
        };

        if !accepted {
            eprintln!("Transfer rejected or timed out: {}", transfer_id);
            let _ = state
                .app_handle
                .emit("file-transfer-rejected", &sanitized_name);
            // We should stop here. If we continue, we risk reading the next field incorrectly or stalling.
            // Best to drop the multipart stream by returning, which closes the connection.
            return;
        }

        // User accepted, stream to file
        eprintln!("Transfer accepted, streaming file: {}", sanitized_name);

        let start_payload = json!({
            "transfer_id": transfer_id,
            "file_name": sanitized_name
        });
        let _ = state.app_handle.emit("file-receive-start", start_payload);

        let mut current_bytes = 0;
        let mut last_emit = Instant::now();
        let mut first_chunk = true;
        let mut write_error = false;
        let mut file_data = Vec::new();

        // Read all chunks into memory
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    if first_chunk {
                        // Only infer extension if missing AND not already handled by sender
                        // This prevents overriding extensions that were already determined
                        if std::path::Path::new(&sanitized_name).extension().is_none() {
                            // Check for APK signature first
                            let is_apk = chunk.len() > 30
                                && chunk.starts_with(&[0x50, 0x4B, 0x03, 0x04]) // PK ZIP signature
                                && String::from_utf8_lossy(&chunk[..chunk.len().min(2048)])
                                    .contains("AndroidManifest");

                            if is_apk {
                                eprintln!("Detected APK file on receive");
                                sanitized_name = format!("{}.apk", sanitized_name);
                            } else if let Some(kind) = infer::get(&chunk) {
                                let ext = kind.extension();
                                // Only add extension if it's not a generic ZIP (could be APK)
                                if kind.mime_type() != "application/zip" {
                                    eprintln!(
                                        "Inferred extension for {}: .{}",
                                        sanitized_name, ext
                                    );
                                    sanitized_name = format!("{}.{}", sanitized_name, ext);
                                } else {
                                    eprintln!(
                                        "Skipping ZIP extension inference (might be APK or other)"
                                    );
                                }
                            }
                        }
                        first_chunk = false;
                    }

                    file_data.extend_from_slice(&chunk);
                    current_bytes += chunk.len() as u64;

                    if last_emit.elapsed().as_millis() > 100 {
                        last_emit = Instant::now();
                        let _ = state.app_handle.emit(
                            "transfer-progress",
                            ProgressPayload {
                                transfer_id: transfer_id.clone(),
                                current_bytes,
                                total_bytes: file_size,
                            },
                        );
                    }
                }
                Ok(None) => break, // End of field
                Err(e) => {
                    eprintln!("Error reading chunk: {}", e);
                    let _ = state.app_handle.emit("file-receive-error", &sanitized_name);
                    write_error = true;
                    break;
                }
            }
        }

        // If there was an error during reading, skip to next field
        if write_error {
            continue;
        }

        // Now write the file using the appropriate method for the platform
        #[cfg(target_os = "android")]
        {
            // On Android, use the Android FS plugin to write to Downloads via MediaStore
            eprintln!("Using Android MediaStore to save file: {}", sanitized_name);

            // Determine MIME type - prioritize APK detection over generic ZIP detection
            let mime_type = if sanitized_name.to_lowercase().ends_with(".apk") {
                Some("application/vnd.android.package-archive".to_string())
            } else if file_data.len() > 30
                && file_data.starts_with(&[0x50, 0x4B, 0x03, 0x04])
                && String::from_utf8_lossy(&file_data[..file_data.len().min(8192)])
                    .contains("AndroidManifest")
            {
                // Detected APK by content signature
                eprintln!("Detected APK file by content signature");
                Some("application/vnd.android.package-archive".to_string())
            } else if let Some(kind) = infer::get(&file_data) {
                let detected_mime = kind.mime_type();
                // If infer detected ZIP but it might be an APK, check more carefully
                if detected_mime == "application/zip" {
                    // Check if it's actually an APK
                    if String::from_utf8_lossy(&file_data[..file_data.len().min(8192)])
                        .contains("AndroidManifest")
                    {
                        eprintln!("Detected APK file (was misidentified as ZIP)");
                        Some("application/vnd.android.package-archive".to_string())
                    } else {
                        Some(detected_mime.to_string())
                    }
                } else {
                    Some(detected_mime.to_string())
                }
            } else {
                None
            };

            let app_clone = state.app_handle.clone();
            let data_clone = file_data.clone();
            let name_clone = sanitized_name.clone();

            match tokio::task::spawn_blocking(move || {
                let api = app_clone.android_fs();
                api.public_storage().write_new(
                    None, // Use primary storage
                    PublicGeneralPurposeDir::Download,
                    &name_clone,
                    mime_type.as_deref(),
                    &data_clone,
                )
            })
            .await
            {
                Ok(Ok(_)) => {
                    eprintln!("File saved successfully via MediaStore: {}", sanitized_name);
                }
                Ok(Err(e)) => {
                    eprintln!("Failed to save file via MediaStore: {}", e);
                    let _ = state.app_handle.emit("file-receive-error", &sanitized_name);
                    continue;
                }
                Err(e) => {
                    eprintln!("Failed to spawn blocking task: {}", e);
                    let _ = state.app_handle.emit("file-receive-error", &sanitized_name);
                    continue;
                }
            }
        }

        #[cfg(not(target_os = "android"))]
        {
            // On other platforms, use standard file I/O
            let final_path = state.download_dir.join(&sanitized_name);
            eprintln!("Saving file to: {:?}", final_path);

            // Remove existing file if it exists
            if final_path.exists() {
                eprintln!("Final file already exists, removing: {:?}", final_path);
                if let Err(e) = fs::remove_file(&final_path).await {
                    eprintln!("Failed to remove existing file: {}", e);
                }
            }

            match fs::write(&final_path, &file_data).await {
                Ok(_) => {
                    eprintln!(
                        "File saved successfully: {:?} ({} bytes)",
                        final_path, current_bytes
                    );
                }
                Err(e) => {
                    eprintln!("Failed to write file: {}", e);
                    let _ = state.app_handle.emit("file-receive-error", &sanitized_name);
                    continue;
                }
            }
        }

        eprintln!(
            "File saved successfully: {} ({} bytes)",
            sanitized_name, current_bytes
        );

        // Emit 100% progress first
        eprintln!(
            "Emitting 100% progress: {} / {}",
            current_bytes, current_bytes
        );
        let _ = state.app_handle.emit(
            "transfer-progress",
            ProgressPayload {
                transfer_id: transfer_id.clone(),
                current_bytes,
                total_bytes: Some(current_bytes),
            },
        );

        // Then emit completion
        let complete_payload = json!({
            "transfer_id": transfer_id.clone(),
            "file_name": sanitized_name.clone()
        });
        eprintln!("Emitting file-receive-complete: {:?}", complete_payload);
        if let Err(e) = state
            .app_handle
            .emit("file-receive-complete", complete_payload)
        {
            eprintln!("Failed to emit file-receive-complete: {}", e);
        }

        // Reset file_size for next field
        file_size = None;
    }
}

async fn message_handler(State(state): State<ServerState>, Json(payload): Json<MessagePayload>) {
    let _ = state.app_handle.emit("message-received", payload);
}
