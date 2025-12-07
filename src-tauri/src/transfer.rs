use reqwest::{multipart, Client};
use serde_json::json;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

pub async fn send_file(peer_ip: String, peer_port: u16, file_path: String) -> Result<(), String> {
    let client = Client::new();
    let url = format!("http://{}:{}/upload", peer_ip, peer_port);

    let path = PathBuf::from(&file_path);
    let file_name = path
        .file_name()
        .ok_or("Invalid file name")?
        .to_string_lossy()
        .to_string();

    let mut file = File::open(&path).await.map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .await
        .map_err(|e| e.to_string())?;

    let part = multipart::Part::bytes(buffer).file_name(file_name);

    let form = multipart::Form::new().part("file", part);

    let res = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

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
    let client = Client::new();
    let url = format!("http://{}:{}/upload", peer_ip, peer_port);

    let part = multipart::Part::bytes(file_data).file_name(file_name);

    let form = multipart::Form::new().part("file", part);

    let res = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

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
