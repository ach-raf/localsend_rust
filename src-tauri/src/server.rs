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
use urlencoding::decode;

#[derive(Clone)]
struct ServerState {
    app_handle: AppHandle,
    download_dir: PathBuf,
}

#[derive(Deserialize, Serialize, Clone)]
struct MessagePayload {
    sender_alias: String,
    content: String,
}

pub async fn start_server(app: AppHandle, port: u16) {
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

        // Notify frontend about incoming file immediately (using sanitized name so far)
        let _ = state.app_handle.emit("file-receive-start", &sanitized_name);

        // Read the first chunk to determine type (and avoid reading whole file to memory)
        let mut first_chunk = None;
        match field.chunk().await {
            Ok(Some(chunk)) => {
                eprintln!("First chunk size: {} bytes", chunk.len());
                first_chunk = Some(chunk);
            }
            Ok(None) => {
                eprintln!("Empty file received: {}", sanitized_name);
            }
            Err(e) => {
                eprintln!("Failed to read first chunk: {}", e);
                continue;
            }
        }

        // If we have data, try to infer extension if missing
        if let Some(ref bytes) = first_chunk {
            if std::path::Path::new(&sanitized_name).extension().is_none() {
                if let Some(kind) = infer::get(bytes) {
                    let ext = kind.extension();
                    eprintln!("Inferred extension for {}: .{}", sanitized_name, ext);
                    sanitized_name = format!("{}.{}", sanitized_name, ext);
                }
            }
        }

        let file_path = state.download_dir.join(&sanitized_name);

        if let Ok(mut file) = File::create(&file_path).await {
            let mut success = true;
            let mut total_bytes_written = 0usize;

            // Write first chunk
            if let Some(bytes) = first_chunk {
                total_bytes_written += bytes.len();
                if let Err(e) = file.write_all(&bytes).await {
                    eprintln!("Failed to write first chunk: {}", e);
                    success = false;
                }
            }

            // Stream the rest of the file
            if success {
                let mut chunk_count = 1;
                loop {
                    match field.chunk().await {
                        Ok(Some(chunk)) => {
                            chunk_count += 1;
                            let chunk_size = chunk.len();
                            total_bytes_written += chunk_size;
                            eprintln!(
                                "Chunk {}: {} bytes (total: {} bytes)",
                                chunk_count, chunk_size, total_bytes_written
                            );

                            if let Err(e) = file.write_all(&chunk).await {
                                eprintln!("Failed to write chunk {}: {}", chunk_count, e);
                                success = false;
                                break;
                            }
                        }
                        Ok(None) => {
                            eprintln!("Reached end of file stream");
                            break;
                        }
                        Err(e) => {
                            eprintln!("Error reading chunk {}: {}", chunk_count, e);
                            success = false;
                            break;
                        }
                    }
                }
            }

            // Ensure all data is written to disk
            if let Err(e) = file.flush().await {
                eprintln!("Failed to flush file: {}", e);
                success = false;
            }

            if success {
                eprintln!(
                    "File saved successfully: {:?} ({} bytes total)",
                    file_path, total_bytes_written
                );

                // On Android, trigger media scan to make file visible
                #[cfg(target_os = "android")]
                {
                    if let Some(path_str) = file_path.to_str() {
                        let _ = state.app_handle.emit("trigger-media-scan", path_str);
                    }
                }
            } else {
                eprintln!(
                    "File transfer failed after writing {} bytes",
                    total_bytes_written
                );
            }
        } else {
            eprintln!("Failed to create file: {:?}", file_path);
        }

        // Notify frontend about completion (using final sanitized name)
        let _ = state
            .app_handle
            .emit("file-receive-complete", &sanitized_name);
    }
}

async fn message_handler(State(state): State<ServerState>, Json(payload): Json<MessagePayload>) {
    let _ = state.app_handle.emit("message-received", payload);
}
