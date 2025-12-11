use reqwest::{multipart, Client};
use serde_json::json;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

pub async fn send_file(peer_ip: String, peer_port: u16, file_path: String) -> Result<(), String> {
    eprintln!(
        "send_file called with: {} -> {}:{}",
        file_path, peer_ip, peer_port
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout
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

    let mut file = File::open(&path).await.map_err(|e| {
        eprintln!("Failed to open file: {}", e);
        format!("Failed to open file: {}", e)
    })?;
    eprintln!("File opened successfully");

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).await.map_err(|e| {
        eprintln!("Failed to read file: {}", e);
        format!("Failed to read file: {}", e)
    })?;
    eprintln!("Read {} bytes from file", buffer.len());

    let part = multipart::Part::bytes(buffer).file_name(file_name);
    let form = multipart::Form::new().part("file", part);

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
        .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let url = format!("http://{}:{}/upload", peer_ip, peer_port);
    eprintln!("Upload URL: {}", url);

    let part = multipart::Part::bytes(file_data).file_name(file_name);
    let form = multipart::Form::new().part("file", part);

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
