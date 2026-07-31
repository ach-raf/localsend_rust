use crate::PendingTransfers;
use axum::{
    extract::{DefaultBodyLimit, Multipart, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::{
    atomic::AtomicBool,
    Arc,
};
#[cfg(target_os = "android")]
use std::sync::atomic::Ordering;
use std::net::SocketAddr;
use std::path::PathBuf;
#[cfg(not(target_os = "android"))]
use std::path::Path;
use std::time::Instant;
use tauri::Emitter;
use tauri::{AppHandle, Manager}; // Import Manager for path()
use tokio::fs::{self};
use tokio::sync::oneshot;
use urlencoding::decode;
use uuid::Uuid;

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{AndroidFsExt, PublicGeneralPurposeDir};

#[derive(Clone)]
struct ServerState {
    app_handle: AppHandle,
    download_dir: PathBuf,
    pending_transfers: PendingTransfers,
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    app_foreground: Arc<AtomicBool>,
}

#[derive(Serialize, Clone, Deserialize)]
struct FileInfo {
    name: String,
    size: u64,
}

#[derive(Serialize, Clone, Deserialize)]
struct BatchTransferRequest {
    session_id: String,
    sender_alias: String,
    files: Vec<FileInfo>,
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

pub async fn start_server(
    app: AppHandle,
    port: u16,
    pending_transfers: PendingTransfers,
    app_foreground: Arc<AtomicBool>,
) {
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
        // On other platforms (Linux, macOS), use the system download directory.
        // download_dir() resolves via XDG → ~/Downloads on Linux and the home
        // Downloads folder on macOS; fall back to $HOME/Downloads (or a literal
        // "downloads" in CWD as last resort) if the path manager can't resolve.
        app.path().download_dir().unwrap_or_else(|_| {
            if let Ok(home) = std::env::var("HOME") {
                PathBuf::from(home).join("Downloads")
            } else {
                PathBuf::from("downloads")
            }
        })
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
        app_foreground,
    };

    let app_router = Router::new()
        .route("/upload", post(upload_handler))
        .route("/request", post(request_handler))
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
    let mut session_id: Option<String> = None;

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        eprintln!("Processing field: {}", name);
        if name == "size" {
            if let Ok(txt) = field.text().await {
                file_size = txt.parse().ok();
                eprintln!("Received file size: {:?}", file_size);
            }
            continue;
        }

        if name == "session_id" {
            if let Ok(txt) = field.text().await {
                // Remove potential quotes and trim
                let sid = txt.trim().trim_matches('"').to_string();
                eprintln!("Raw session_id field text: '{}'", txt);
                session_id = Some(sid);
                eprintln!("Final session ID: {:?}", session_id);
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
        let mut sanitized_name = file_name.replace([':', '/', '\\'], "_");

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

        // Check if this transfer is pre-authorized via session
        let mut pre_authorized = false;
        if let Some(ref sid) = session_id {
            let sessions = state.pending_transfers.authorized_sessions.lock().unwrap();
            let authorized = sessions.get(sid).cloned().unwrap_or(false);
            if authorized {
                pre_authorized = true;
                eprintln!(
                    "Transfer {} is pre-authorized via session {}",
                    transfer_id, sid
                );
            } else {
                eprintln!(
                    "Session {} found in request but NOT authorized. Authorized sessions: {:?}",
                    sid,
                    sessions.keys().collect::<Vec<_>>()
                );
            }
        } else {
            eprintln!("No session_id field found yet for transfer {}", transfer_id);
        }

        let accepted = if pre_authorized {
            true
        } else {
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
            match tokio::time::timeout(
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
        let received_file_uri: Option<String>;
        #[cfg(not(target_os = "android"))]
        let received_file_uri: Option<String> = None;

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

            // Use async API directly
            let api = state.app_handle.android_fs_async();
            match api
                .public_storage()
                .write_new(
                    None, // Use primary storage
                    PublicGeneralPurposeDir::Download,
                    &sanitized_name,
                    mime_type.as_deref(),
                    &file_data,
                )
                .await
            {
                Ok(uri) => {
                    eprintln!("File saved successfully via MediaStore: {}", sanitized_name);
                    if let Ok(actual_name) = api.get_name(&uri).await {
                        sanitized_name = actual_name;
                    }
                    received_file_uri = Some(uri.uri);
                }
                Err(e) => {
                    eprintln!("Failed to save file via MediaStore: {}", e);
                    let _ = state.app_handle.emit("file-receive-error", &sanitized_name);
                    continue;
                }
            }
        }

        #[cfg(not(target_os = "android"))]
        {
            // On other platforms, use standard file I/O
            // Get a unique filename if the file already exists
            let unique_filename = get_unique_filename(&state.download_dir, &sanitized_name).await;
            let final_path = state.download_dir.join(&unique_filename);
            eprintln!("Saving file to: {:?}", final_path);

            match fs::write(&final_path, &file_data).await {
                Ok(_) => {
                    eprintln!(
                        "File saved successfully: {:?} ({} bytes)",
                        final_path, current_bytes
                    );
                    // Update sanitized_name to the unique filename for the completion event
                    sanitized_name = unique_filename;
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
        // Determine the file path based on platform
        let file_path = if cfg!(target_os = "android") {
            // On Android, we can't easily get the file path from MediaStore
            // The file is saved via MediaStore API, so we'll return None
            None
        } else {
            // On other platforms, use the final path (sanitized_name may have been updated with unique name)
            let final_path = state.download_dir.join(&sanitized_name);
            Some(final_path.to_string_lossy().to_string())
        };

        let mut complete_payload = json!({
            "transfer_id": transfer_id.clone(),
            "file_name": sanitized_name.clone()
        });

        // Add file_path if available (Windows, Linux, macOS)
        if let Some(path) = file_path {
            complete_payload["file_path"] = json!(path);
        }
        if let Some(uri) = received_file_uri.as_ref() {
            complete_payload["file_uri"] = json!(uri);
        }

        #[cfg(target_os = "android")]
        let mut native_notification_shown = false;
        #[cfg(not(target_os = "android"))]
        let native_notification_shown = false;
        #[cfg(target_os = "android")]
        if !state.app_foreground.load(Ordering::Relaxed) {
            use tauri_plugin_notification::{NotificationExt, PermissionState};

            match state.app_handle.notification().permission_state() {
                Ok(PermissionState::Granted) => {
                    let notification_id = Uuid::parse_str(&transfer_id)
                        .map(|id| i32::from_le_bytes(id.as_bytes()[..4].try_into().unwrap()))
                        .unwrap_or_else(|_| transfer_id.bytes().fold(0i32, |acc, byte| {
                            acc.wrapping_mul(31).wrapping_add(byte as i32)
                        }));

                    if let Some(uri) = received_file_uri.as_ref() {
                        match state
                            .app_handle
                            .notification()
                            .builder()
                            .id(notification_id)
                            .channel_id("received-files")
                            .title("File received")
                            .body(format!("Tap to open {}", sanitized_name))
                            .extra("kind", "received-file")
                            .extra("fileUri", uri)
                            .auto_cancel()
                            .show()
                        {
                            Ok(()) => native_notification_shown = true,
                            Err(error) => {
                                eprintln!("Failed to show received-file notification: {error}")
                            }
                        }
                    }
                }
                Ok(state) => {
                    eprintln!("Notification permission not granted ({state}); using in-app toast")
                }
                Err(error) => {
                    eprintln!("Failed to check notification permission: {error}")
                }
            }
        }
        complete_payload["show_in_app"] = json!(!native_notification_shown);

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

/// Generate a unique filename by adding a UUID if the file already exists
#[cfg(not(target_os = "android"))]
async fn get_unique_filename(download_dir: &Path, filename: &str) -> String {
    let path = download_dir.join(filename);

    // If the file doesn't exist, return the original filename
    if !path.exists() {
        return filename.to_string();
    }

    // Split filename into name and extension
    let (name, ext) = if let Some(dot_pos) = filename.rfind('.') {
        let (n, e) = filename.split_at(dot_pos);
        (n, &e[1..]) // Remove the dot from extension
    } else {
        (filename, "")
    };

    // Generate a unique filename with UUID
    let new_filename = if ext.is_empty() {
        format!("{}_{}", name, Uuid::new_v4())
    } else {
        format!("{}_{}.{}", name, Uuid::new_v4(), ext)
    };

    eprintln!(
        "File '{}' already exists, using '{}' instead",
        filename, new_filename
    );
    new_filename
}

async fn message_handler(State(state): State<ServerState>, Json(payload): Json<MessagePayload>) {
    let _ = state.app_handle.emit("message-received", payload);
}

async fn request_handler(
    State(state): State<ServerState>,
    Json(payload): Json<BatchTransferRequest>,
) -> Json<serde_json::Value> {
    eprintln!(
        "Received batch transfer request: {} files from {} with session_id: {}",
        payload.files.len(),
        payload.sender_alias,
        payload.session_id
    );

    let session_id = payload.session_id.clone();
    let (tx, rx) = oneshot::channel();

    // Store the sender in pending_transfers
    {
        let mut transfers = state.pending_transfers.transfers.lock().unwrap();
        transfers.insert(session_id.clone(), tx);
    }

    // Emit event to frontend requesting confirmation for the whole batch
    if let Err(e) = state.app_handle.emit("batch-transfer-request", &payload) {
        eprintln!("Failed to emit batch-transfer-request: {}", e);
        let mut transfers = state.pending_transfers.transfers.lock().unwrap();
        transfers.remove(&session_id);
        return Json(json!({ "accepted": false }));
    }

    // Wait for user response
    let accepted = match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
        Ok(Ok(response)) => {
            eprintln!("Batch transfer {} response: {}", session_id, response);
            response
        },
        _ => {
            eprintln!("Batch transfer {} timed out or error", session_id);
            // Clean up from transfers map if timeout or channel closed
            let mut transfers = state.pending_transfers.transfers.lock().unwrap();
            transfers.remove(&session_id);
            false
        }
    };

    if accepted {
        let mut sessions = state.pending_transfers.authorized_sessions.lock().unwrap();
        sessions.insert(session_id.clone(), true);
        eprintln!("Session {} now authorized", session_id);
    }

    Json(json!({ "accepted": accepted }))
}
