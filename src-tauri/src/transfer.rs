use futures::stream::StreamExt;
use reqwest::{multipart, Body, Client};
use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};

/// Detects if a file is an APK and returns the correct MIME type
/// APK files are ZIP archives, so we need to check for APK-specific content
fn get_mime_type_for_file(file_name: &str, file_data: Option<&[u8]>) -> String {
    // Check by extension first (fastest)
    if file_name.to_lowercase().ends_with(".apk") {
        return "application/vnd.android.package-archive".to_string();
    }

    // If we have file data, check for APK signature
    if let Some(data) = file_data {
        if data.len() > 30 && data.starts_with(&[0x50, 0x4B, 0x03, 0x04]) {
            // ZIP signature found, check for AndroidManifest
            let preview = &data[..data.len().min(8192)];
            if String::from_utf8_lossy(preview).contains("AndroidManifest") {
                return "application/vnd.android.package-archive".to_string();
            }
        }
    }

    // Default to octet-stream
    "application/octet-stream".to_string()
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    transfer_id: String,
    current_bytes: u64,
    total_bytes: u64,
}

pub async fn send_file(
    app: AppHandle,
    peer_ip: String,
    peer_port: u16,
    file_path: String,
) -> Result<(), String> {
    eprintln!(
        "send_file called with: {} -> {}:{}",
        file_path, peer_ip, peer_port
    );

    let client = Client::builder()
        .timeout(Duration::from_secs(300)) // 5 minute timeout
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let url = format!("http://{}:{}/upload", peer_ip, peer_port);
    eprintln!("Upload URL: {}", url);

    let path = PathBuf::from(&file_path);
    eprintln!("Opening file: {:?}", path);

    let file_name = path
        .file_name()
        .ok_or("Invalid file name")?
        .to_string_lossy()
        .to_string();
    eprintln!("File name: {}", file_name);

    let file = File::open(&path).await.map_err(|e| {
        eprintln!("Failed to open file: {}", e);
        format!("Failed to open file: {}", e)
    })?;

    let file_size = file.metadata().await.map_err(|e| e.to_string())?.len();
    eprintln!("File size: {}", file_size);

    // Create a stream from the file
    let stream = FramedRead::new(file, BytesCodec::new());

    // Progress tracking
    let uploaded = Arc::new(Mutex::new(0u64));
    let last_emit = Arc::new(Mutex::new(Instant::now()));
    let uploaded_clone = uploaded.clone();
    let app_handle = app.clone();
    let transfer_id = file_name.clone(); // Use filename as ID for sender tracking

    let progress_stream = stream.map(move |chunk| {
        if let Ok(bytes) = &chunk {
            let len = bytes.len() as u64;
            let mut uploaded_val = uploaded_clone.lock().unwrap();
            *uploaded_val += len;

            let mut last = last_emit.lock().unwrap();
            if last.elapsed().as_millis() > 100 {
                // Throttle updates to every 100ms
                *last = Instant::now();
                let _ = app_handle.emit(
                    "transfer-progress",
                    ProgressPayload {
                        transfer_id: transfer_id.clone(),
                        current_bytes: *uploaded_val,
                        total_bytes: file_size,
                    },
                );
            }
        }
        chunk
    });

    let body = Body::wrap_stream(progress_stream);

    // Determine MIME type based on filename
    let mime_type = get_mime_type_for_file(&file_name, None);

    let part = multipart::Part::stream(body)
        .file_name(file_name.clone())
        .mime_str(&mime_type)
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new()
        .text("size", file_size.to_string())
        .part("file", part);

    eprintln!("Sending multipart request...");
    let res = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            eprintln!("Request failed: {}", e);
            format!("Request failed: {}", e)
        })?;

    eprintln!("Response status: {}", res.status());
    if res.status().is_success() {
        // Emit 100% progress
        let _ = app.emit(
            "transfer-progress",
            ProgressPayload {
                transfer_id: file_name,
                current_bytes: file_size,
                total_bytes: file_size,
            },
        );
        Ok(())
    } else {
        Err(format!("Upload failed with status: {}", res.status()))
    }
}

pub async fn send_file_bytes(
    peer_ip: String,
    peer_port: u16,
    file_name: String,
    file_data: Vec<u8>,
) -> Result<(), String> {
    eprintln!(
        "send_file_bytes called: {} ({} bytes) -> {}:{}",
        file_name,
        file_data.len(),
        peer_ip,
        peer_port
    );

    let client = Client::builder()
        .timeout(Duration::from_secs(300)) // 5 minute timeout
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let url = format!("http://{}:{}/upload", peer_ip, peer_port);
    eprintln!("Upload URL: {}", url);

    let file_size = file_data.len() as u64;

    // Determine MIME type based on filename and content
    let mime_type = get_mime_type_for_file(&file_name, Some(&file_data));

    let part = multipart::Part::bytes(file_data)
        .file_name(file_name.clone())
        .mime_str(&mime_type)
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new()
        .text("size", file_size.to_string())
        .part("file", part);

    eprintln!("Sending multipart request with filename: {}", file_name);
    let res = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            eprintln!("Request failed: {}", e);
            format!("Request failed: {}", e)
        })?;

    eprintln!("Response status: {}", res.status());
    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("Upload failed with status: {}", res.status()))
    }
}

pub async fn send_text(
    peer_ip: String,
    peer_port: u16,
    text: String,
    sender_alias: String,
) -> Result<(), String> {
    let client = Client::new();
    let url = format!("http://{}:{}/message", peer_ip, peer_port);

    let payload = json!({
        "sender_alias": sender_alias,
        "content": text
    });

    let res = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("Message failed with status: {}", res.status()))
    }
}
