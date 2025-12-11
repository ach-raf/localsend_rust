use crate::PendingTransfers;
use axum::{
    extract::{DefaultBodyLimit, Multipart, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use tauri::Emitter;
use tauri::{AppHandle, Manager}; // Import Manager for path()
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;
use urlencoding::decode;

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
        PathBuf::from("/storage/emulated/0/Download")
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
    while let Ok(Some(mut field)) = multipart.next_field().await {
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

        // Read all chunks into memory first (we need to wait for user confirmation)
        let mut file_data = Vec::new();
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    file_data.extend_from_slice(&chunk);
                }
                Ok(None) => {
                    break;
                }
                Err(e) => {
                    eprintln!("Error reading chunk: {}", e);
                    continue;
                }
            }
        }

        eprintln!("Read {} bytes from multipart", file_data.len());

        if file_data.is_empty() {
            eprintln!("Empty file received: {}", sanitized_name);
            continue;
        }

        // Try to infer extension if missing
        if std::path::Path::new(&sanitized_name).extension().is_none() {
            if let Some(kind) = infer::get(&file_data) {
                let ext = kind.extension();
                eprintln!("Inferred extension for {}: .{}", sanitized_name, ext);
                sanitized_name = format!("{}.{}", sanitized_name, ext);
            }
        }

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
            file_size: Some(file_data.len() as u64),
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
            continue;
        }

        // User accepted, save the file
        eprintln!("Transfer accepted, saving file: {}", sanitized_name);
        let _ = state.app_handle.emit("file-receive-start", &sanitized_name);

        let file_path = state.download_dir.join(&sanitized_name);

        match File::create(&file_path).await {
            Ok(mut file) => {
                match file.write_all(&file_data).await {
                    Ok(_) => {
                        if let Err(e) = file.flush().await {
                            eprintln!("Failed to flush file: {}", e);
                        } else {
                            eprintln!(
                                "File saved successfully: {:?} ({} bytes)",
                                file_path,
                                file_data.len()
                            );

                            // On Android, trigger media scan to make file visible
                            #[cfg(target_os = "android")]
                            {
                                if let Some(path_str) = file_path.to_str() {
                                    let _ = state.app_handle.emit("trigger-media-scan", path_str);
                                }
                            }

                            let _ = state
                                .app_handle
                                .emit("file-receive-complete", &sanitized_name);
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to write file: {}", e);
                        let _ = state.app_handle.emit("file-receive-error", &sanitized_name);
                    }
                }
            }
            Err(e) => {
                eprintln!("Failed to create file: {:?}", e);
                let _ = state.app_handle.emit("file-receive-error", &sanitized_name);
            }
        }
    }
}

async fn message_handler(State(state): State<ServerState>, Json(payload): Json<MessagePayload>) {
    let _ = state.app_handle.emit("message-received", payload);
}
