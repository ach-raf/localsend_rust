use crate::discovery::{handle_announce, local_device_info, DeviceInfo};
#[cfg(not(target_os = "android"))]
use crate::guard::numbered_name;
use crate::guard::{is_lan_ip, sanitize_alias, sanitize_filename, RateLimiter};
use crate::{lock, PendingTransfers, Session};
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Multipart, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::{AppHandle, Manager};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;
use urlencoding::decode;
use uuid::Uuid;

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{AndroidFsExt, FsUri, PublicGeneralPurposeDir};

/// How long the receiver has to answer an "accept?" prompt.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(60);
/// Prompts that can be waiting on the user at once. More than this is spam.
const MAX_PENDING_PROMPTS: usize = 16;
/// Prompt-causing requests (batch / message / un-sessioned upload) per source.
const PROMPTS_PER_MINUTE: usize = 12;
/// An approved session stays valid this long after its last upload starts.
const SESSION_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
/// A sender may say "10 MB" and send a few bytes more (file grew, rounding).
const SIZE_SLACK: u64 = 1024 * 1024;
const MAX_BATCH_FILES: usize = 500;
const MAX_MESSAGE_BYTES: usize = 256 * 1024;
const JSON_BODY_LIMIT: usize = 512 * 1024;

#[derive(Clone)]
struct ServerState {
    app_handle: AppHandle,
    /// Effective save directory, shared with `AppState` so a Settings change
    /// applies to the running server without a restart. Android ignores it
    /// (MediaStore owns the location).
    download_dir: Arc<Mutex<PathBuf>>,
    pending_transfers: PendingTransfers,
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    app_foreground: Arc<AtomicBool>,
    receiving: Arc<AtomicBool>,
    limiter: Arc<RateLimiter>,
}

type ApiError = (StatusCode, String);

fn err(status: StatusCode, msg: impl Into<String>) -> ApiError {
    (status, msg.into())
}

#[derive(Serialize, Clone, Deserialize)]
struct FileInfo {
    name: String,
    size: u64,
}

#[derive(Deserialize)]
struct BatchTransferRequest {
    session_id: String,
    sender_alias: String,
    files: Vec<FileInfo>,
}

/// What the UI sees for a batch: cleaned values plus the *observed* sender IP
/// (the alias is self-declared, the IP is not).
#[derive(Serialize, Clone)]
struct BatchRequestEvent {
    session_id: String,
    sender_alias: String,
    sender_ip: String,
    files: Vec<FileInfo>,
}

#[derive(Serialize, Clone)]
struct FileTransferRequest {
    transfer_id: String,
    file_name: String,
    file_size: Option<u64>,
    sender_ip: String,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    transfer_id: String,
    current_bytes: u64,
    total_bytes: Option<u64>,
}

#[derive(Deserialize)]
struct MessagePayload {
    sender_alias: String,
    content: String,
}

#[derive(Serialize, Clone)]
struct MessageEvent {
    sender_alias: String,
    sender_ip: String,
    content: String,
}

/// Picks the folder received files are written to: the user's configured
/// folder when set (desktop), otherwise the platform Downloads folder, with a
/// home-directory fallback for the rare systems that don't report one.
pub fn resolve_download_dir(app: &AppHandle, configured: Option<&str>) -> PathBuf {
    #[cfg(target_os = "android")]
    {
        let _ = configured;
        platform_download_dir(app)
    }

    #[cfg(not(target_os = "android"))]
    {
        configured
            .map(str::trim)
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| platform_download_dir(app))
    }
}

/// The OS Downloads folder, or `~/Downloads` when the platform lookup fails.
fn platform_download_dir(app: &AppHandle) -> PathBuf {
    app.path().download_dir().unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map(PathBuf::from)
            .unwrap_or_default();
        home.join("Downloads")
    })
}

pub async fn start_server(
    app: AppHandle,
    port: u16,
    pending_transfers: PendingTransfers,
    app_foreground: Arc<AtomicBool>,
    receiving: Arc<AtomicBool>,
    download_dir: Arc<Mutex<PathBuf>>,
) {
    let resolved_dir = lock(&download_dir).clone();

    // Android writes through MediaStore, so there's no directory to manage.
    #[cfg(not(target_os = "android"))]
    {
        if !resolved_dir.exists() {
            if let Err(e) = fs::create_dir_all(&resolved_dir).await {
                eprintln!("Failed to create download directory: {}", e);
            }
        }
        sweep_stale_parts(&resolved_dir).await;
    }
    eprintln!("Download directory: {:?}", resolved_dir);

    let state = ServerState {
        app_handle: app.clone(),
        download_dir,
        pending_transfers,
        app_foreground,
        receiving,
        limiter: Arc::new(RateLimiter::new(PROMPTS_PER_MINUTE, Duration::from_secs(60))),
    };

    // Small JSON endpoints get a small body cap; only /upload may be huge.
    let json_routes = Router::new()
        .route("/request", post(request_handler))
        .route("/message", post(message_handler))
        .route("/announce", post(announce_handler))
        .layer(DefaultBodyLimit::max(JSON_BODY_LIMIT));

    let upload_routes = Router::new()
        .route("/upload", post(upload_handler))
        .layer(DefaultBodyLimit::disable());

    let app_router = Router::new()
        .merge(json_routes)
        .merge(upload_routes)
        .route("/ping", get(|| async { "pong" }))
        .route("/info", get(info_handler))
        .layer(middleware::from_fn(lan_only))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Server failed to bind {}: {}", addr, e);
            let _ = app.emit(
                "server-error",
                format!(
                    "Couldn't listen on port {port} ({e}). Another app may be using it — pick a different port in Settings and restart."
                ),
            );
            return;
        }
    };
    println!("Server listening on {}", addr);

    if let Err(e) = axum::serve(
        listener,
        app_router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    {
        eprintln!("Server stopped: {}", e);
        let _ = app.emit("server-error", format!("The receiving server stopped: {e}"));
    }
}

/// Rejects anything that isn't coming from the local network.
async fn lan_only(
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if is_lan_ip(remote.ip()) {
        Ok(next.run(request).await)
    } else {
        eprintln!("Blocked request from non-local address {}", remote.ip());
        Err(StatusCode::FORBIDDEN)
    }
}

/// Removes half-written files left behind if the app was killed mid-transfer.
#[cfg(not(target_os = "android"))]
async fn sweep_stale_parts(dir: &std::path::Path) {
    let Ok(mut entries) = fs::read_dir(dir).await else {
        return;
    };
    let cutoff = Duration::from_secs(60 * 60);
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !(name.starts_with(".localshare-") && name.ends_with(".part")) {
            continue;
        }
        let stale = entry
            .metadata()
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > cutoff);
        if stale {
            let _ = fs::remove_file(entry.path()).await;
        }
    }
}

async fn info_handler() -> Json<DeviceInfo> {
    Json(local_device_info())
}

async fn announce_handler(
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    Json(info): Json<DeviceInfo>,
) -> Json<DeviceInfo> {
    Json(handle_announce(remote.ip(), info))
}

// ---------------------------------------------------------------------------
// Prompting the user
// ---------------------------------------------------------------------------

enum Ask {
    Accepted,
    Rejected,
    TimedOut,
    /// Too many prompts already open, or this id is already being asked.
    Busy,
    Failed,
}

/// Drops the pending entry if the request goes away without an answer
/// (timeout, or the sender hung up) and tells the UI to close the prompt.
struct PendingGuard {
    app: AppHandle,
    pending: PendingTransfers,
    id: String,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        // Answered, expired or abandoned: the system notification is stale.
        dismiss_request_notification(&self.app, &self.id);
        let removed = lock(&self.pending.transfers).remove(&self.id).is_some();
        if removed {
            let _ = self
                .app
                .emit("transfer-request-cancelled", json!({ "id": self.id }));
        }
    }
}

/// Stable per-request notification id (so it can be dismissed later).
#[cfg(target_os = "android")]
fn notification_id(id: &str) -> i32 {
    id.bytes()
        .fold(7i32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as i32))
}

/// Android: when the app isn't in front, the in-app prompt can't be seen, so
/// raise a heads-up system notification (with Accept / Reject buttons that the
/// JS side wires to the same answer path as the modal).
#[cfg(target_os = "android")]
fn notify_request(state: &ServerState, id: &str, title: &str, body: &str) {
    use tauri_plugin_notification::{NotificationExt, PermissionState};

    if state.app_foreground.load(Ordering::Relaxed) {
        return;
    }
    match state.app_handle.notification().permission_state() {
        Ok(PermissionState::Granted) => {
            if let Err(e) = state
                .app_handle
                .notification()
                .builder()
                .id(notification_id(id))
                .channel_id("incoming-requests")
                .title(title)
                .body(body)
                .action_type_id("incoming-request")
                .extra("kind", "incoming-request")
                .extra("requestId", id)
                .show()
            {
                eprintln!("Failed to show request notification: {e}");
            }
        }
        other => eprintln!("Request notification skipped (permission: {other:?})"),
    }
}

#[cfg(not(target_os = "android"))]
fn notify_request(_: &ServerState, _: &str, _: &str, _: &str) {}

#[cfg(target_os = "android")]
fn dismiss_request_notification(app: &AppHandle, id: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().remove_active(vec![notification_id(id)]);
}

#[cfg(not(target_os = "android"))]
fn dismiss_request_notification(_: &AppHandle, _: &str) {}

async fn ask_user<T: Serialize + Clone>(
    state: &ServerState,
    id: &str,
    event: &str,
    payload: &T,
    heads_up: (&str, &str),
) -> Ask {
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = lock(&state.pending_transfers.transfers);
        if pending.len() >= MAX_PENDING_PROMPTS || pending.contains_key(id) {
            return Ask::Busy;
        }
        pending.insert(id.to_string(), tx);
    }
    let _guard = PendingGuard {
        app: state.app_handle.clone(),
        pending: state.pending_transfers.clone(),
        id: id.to_string(),
    };

    if let Err(e) = state.app_handle.emit(event, payload) {
        eprintln!("Failed to emit {}: {}", event, e);
        return Ask::Failed;
    }
    notify_request(state, id, heads_up.0, heads_up.1);

    match tokio::time::timeout(PROMPT_TIMEOUT, rx).await {
        Ok(Ok(true)) => Ask::Accepted,
        Ok(Ok(false)) => Ask::Rejected,
        Ok(Err(_)) => Ask::Failed,
        Err(_) => Ask::TimedOut,
    }
}

fn check_receiving(state: &ServerState) -> Result<(), ApiError> {
    if state.receiving.load(Ordering::Relaxed) {
        Ok(())
    } else {
        Err(err(
            StatusCode::FORBIDDEN,
            "This device isn't accepting transfers right now",
        ))
    }
}

fn check_rate(state: &ServerState, ip: IpAddr) -> Result<(), ApiError> {
    if state.limiter.allow(ip) {
        Ok(())
    } else {
        eprintln!("Rate limit hit for {}", ip);
        Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests — slow down and try again in a minute",
        ))
    }
}

// ---------------------------------------------------------------------------
// Sessions (approved batches)
// ---------------------------------------------------------------------------

/// Spends one file from an approved session. Returns the byte budget for it.
fn claim_session(state: &ServerState, sid: &str, from: IpAddr) -> Result<u64, ApiError> {
    let mut sessions = lock(&state.pending_transfers.authorized_sessions);
    let now = Instant::now();
    sessions.retain(|_, s| s.expires > now);

    let Some(session) = sessions.get_mut(sid) else {
        return Err(err(
            StatusCode::FORBIDDEN,
            "Transfer approval expired — send again",
        ));
    };
    if session.peer_ip != from {
        eprintln!("Session {} used from {} (expected {})", sid, from, session.peer_ip);
        return Err(err(StatusCode::FORBIDDEN, "Session belongs to another device"));
    }
    if session.files_left == 0 {
        return Err(err(
            StatusCode::FORBIDDEN,
            "More files than were approved",
        ));
    }
    session.files_left -= 1;
    session.expires = now + SESSION_IDLE_TTL;
    Ok(session.bytes_left.saturating_add(SIZE_SLACK))
}

fn settle_session(state: &ServerState, sid: &str, bytes: u64) {
    let mut sessions = lock(&state.pending_transfers.authorized_sessions);
    let finished = if let Some(s) = sessions.get_mut(sid) {
        s.bytes_left = s.bytes_left.saturating_sub(bytes);
        s.files_left == 0
    } else {
        false
    };
    if finished {
        sessions.remove(sid);
    }
}

// ---------------------------------------------------------------------------
// /request — batch pre-authorisation
// ---------------------------------------------------------------------------

async fn request_handler(
    State(state): State<ServerState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    Json(payload): Json<BatchTransferRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_receiving(&state)?;
    check_rate(&state, remote.ip())?;

    if Uuid::parse_str(&payload.session_id).is_err() {
        return Err(err(StatusCode::BAD_REQUEST, "Invalid session id"));
    }
    if payload.files.is_empty() || payload.files.len() > MAX_BATCH_FILES {
        return Err(err(
            StatusCode::BAD_REQUEST,
            format!("A batch must contain 1–{MAX_BATCH_FILES} files"),
        ));
    }

    let files: Vec<FileInfo> = payload
        .files
        .into_iter()
        .map(|f| FileInfo {
            name: sanitize_filename(&decode_name(&f.name)),
            size: f.size,
        })
        .collect();
    let total_bytes = files.iter().fold(0u64, |a, f| a.saturating_add(f.size));

    let session_id = payload.session_id;
    let event = BatchRequestEvent {
        session_id: session_id.clone(),
        sender_alias: sanitize_alias(&payload.sender_alias),
        sender_ip: remote.ip().to_string(),
        files: files.clone(),
    };
    eprintln!(
        "Batch request: {} files from {} ({})",
        files.len(),
        event.sender_alias,
        remote.ip()
    );

    let heads_up_title = format!("{} wants to send you files", event.sender_alias);
    let heads_up_body = format!(
        "{} file{} · {} — from {}",
        files.len(),
        if files.len() == 1 { "" } else { "s" },
        human_size(total_bytes),
        remote.ip()
    );
    match ask_user(
        &state,
        &session_id,
        "batch-transfer-request",
        &event,
        (&heads_up_title, &heads_up_body),
    )
    .await
    {
        Ask::Accepted => {
            let mut sessions = lock(&state.pending_transfers.authorized_sessions);
            let now = Instant::now();
            sessions.retain(|_, s| s.expires > now);
            sessions.insert(
                session_id,
                Session {
                    peer_ip: remote.ip(),
                    files_left: files.len(),
                    bytes_left: total_bytes,
                    expires: now + SESSION_IDLE_TTL,
                },
            );
            Ok(Json(json!({ "accepted": true })))
        }
        Ask::Rejected => Ok(Json(json!({ "accepted": false, "reason": "rejected" }))),
        Ask::TimedOut => Ok(Json(json!({ "accepted": false, "reason": "timeout" }))),
        Ask::Busy => Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            "Receiver is busy with other requests",
        )),
        Ask::Failed => Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Couldn't show the prompt")),
    }
}

// ---------------------------------------------------------------------------
// /message
// ---------------------------------------------------------------------------

async fn message_handler(
    State(state): State<ServerState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    Json(payload): Json<MessagePayload>,
) -> Result<StatusCode, ApiError> {
    check_receiving(&state)?;
    check_rate(&state, remote.ip())?;

    let content = payload.content.trim_end().to_string();
    if content.trim().is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "Empty message"));
    }
    if content.len() > MAX_MESSAGE_BYTES {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "Message too long"));
    }

    state
        .app_handle
        .emit(
            "message-received",
            MessageEvent {
                sender_alias: sanitize_alias(&payload.sender_alias),
                sender_ip: remote.ip().to_string(),
                content,
            },
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// /upload
// ---------------------------------------------------------------------------

fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn decode_name(raw: &str) -> String {
    // e.g. image%3A1000283390 -> image:1000283390
    decode(raw).map(|s| s.to_string()).unwrap_or_else(|_| raw.to_string())
}

fn looks_like_apk(bytes: &[u8]) -> bool {
    bytes.len() > 30
        && bytes.starts_with(&[0x50, 0x4B, 0x03, 0x04]) // PK zip signature
        && String::from_utf8_lossy(&bytes[..bytes.len().min(8192)]).contains("AndroidManifest")
}

/// Fills in a missing extension and picks a MIME type from the first bytes.
/// (APK detection is duplicated in lib.rs / transfer.rs — keep them in sync.)
fn name_and_mime_from_head(name: &str, head: &[u8]) -> (String, Option<String>) {
    let has_ext = std::path::Path::new(name).extension().is_some();
    let lower = name.to_lowercase();

    if lower.ends_with(".apk") || looks_like_apk(head) {
        let n = if has_ext { name.to_string() } else { format!("{name}.apk") };
        return (n, Some("application/vnd.android.package-archive".into()));
    }
    match infer::get(head) {
        Some(kind) => {
            let mime = kind.mime_type();
            let n = if has_ext || mime == "application/zip" {
                name.to_string()
            } else {
                format!("{name}.{}", kind.extension())
            };
            (n, Some(mime.to_string()))
        }
        None => (name.to_string(), None),
    }
}

/// A file being written. Dropping it without `commit` removes the partial file,
/// so an aborted or failed transfer never leaves junk behind.
#[cfg(not(target_os = "android"))]
struct Sink {
    file: Option<fs::File>,
    part_path: PathBuf,
    dir: PathBuf,
    name: String,
    committed: bool,
}

#[cfg(not(target_os = "android"))]
impl Sink {
    async fn create(dir: &std::path::Path, name: &str, _mime: Option<&str>) -> Result<Self, String> {
        let part_path = dir.join(format!(".localshare-{}.part", Uuid::new_v4()));
        let file = fs::File::create(&part_path)
            .await
            .map_err(|e| format!("Couldn't create file: {e}"))?;
        Ok(Self {
            file: Some(file),
            part_path,
            dir: dir.to_path_buf(),
            name: name.to_string(),
            committed: false,
        })
    }

    async fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.file
            .as_mut()
            .ok_or("sink closed")?
            .write_all(chunk)
            .await
            .map_err(|e| format!("Couldn't write file: {e}"))
    }

    /// Moves the finished file to its final, collision-free name.
    async fn commit(mut self) -> Result<(String, Option<String>, Option<String>), String> {
        let mut file = self.file.take().ok_or("sink closed")?;
        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);

        for n in 0..1000u32 {
            let candidate = if n == 0 {
                self.name.clone()
            } else {
                numbered_name(&self.name, n)
            };
            let target = self.dir.join(&candidate);
            // create_new reserves the name atomically; the rename then
            // replaces our empty placeholder.
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
            {
                Ok(_) => {
                    if let Err(e) = fs::rename(&self.part_path, &target).await {
                        let _ = std::fs::remove_file(&target);
                        return Err(format!("Couldn't save file: {e}"));
                    }
                    self.committed = true;
                    return Ok((candidate, Some(target.to_string_lossy().to_string()), None));
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("Couldn't save file: {e}")),
            }
        }
        Err("Too many files with the same name".into())
    }
}

#[cfg(not(target_os = "android"))]
impl Drop for Sink {
    fn drop(&mut self) {
        if !self.committed {
            self.file.take(); // release the handle first (Windows)
            let _ = std::fs::remove_file(&self.part_path);
        }
    }
}

/// Android: stream into a MediaStore "pending" entry (invisible to other apps
/// until complete), then publish it; remove it if anything goes wrong.
#[cfg(target_os = "android")]
struct Sink {
    app: AppHandle,
    file: Option<fs::File>,
    uri: Option<FsUri>,
}

#[cfg(target_os = "android")]
impl Sink {
    async fn create(_dir: &std::path::Path, name: &str, mime: Option<&str>, app: &AppHandle) -> Result<Self, String> {
        let api = app.android_fs_async();
        let uri = api
            .public_storage()
            .create_new_file_with_pending(None, PublicGeneralPurposeDir::Download, name, mime)
            .await
            .map_err(|e| format!("Couldn't create file: {e}"))?;
        let std_file = match api.open_file_writable(&uri).await {
            Ok(f) => f,
            Err(e) => {
                let _ = api.remove_file(&uri).await;
                return Err(format!("Couldn't open file for writing: {e}"));
            }
        };
        Ok(Self {
            app: app.clone(),
            file: Some(fs::File::from_std(std_file)),
            uri: Some(uri),
        })
    }

    async fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.file
            .as_mut()
            .ok_or("sink closed")?
            .write_all(chunk)
            .await
            .map_err(|e| format!("Couldn't write file: {e}"))
    }

    async fn commit(mut self) -> Result<(String, Option<String>, Option<String>), String> {
        let mut file = self.file.take().ok_or("sink closed")?;
        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);
        let uri = self.uri.take().ok_or("sink closed")?;
        let api = self.app.android_fs_async();
        api.public_storage()
            .set_pending(&uri, false)
            .await
            .map_err(|e| format!("Couldn't publish file: {e}"))?;
        let name = api.get_name(&uri).await.unwrap_or_else(|_| "file".into());
        Ok((name, None, Some(uri.uri.clone())))
    }
}

#[cfg(target_os = "android")]
impl Drop for Sink {
    fn drop(&mut self) {
        self.file.take();
        if let Some(uri) = self.uri.take() {
            let app = self.app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = app.android_fs_async().remove_file(&uri).await;
            });
        }
    }
}

async fn open_sink(
    state: &ServerState,
    name: &str,
    mime: Option<&str>,
) -> Result<Sink, String> {
    // Clone through the lock so a Settings change mid-transfer can't race the
    // create call.
    let download_dir = lock(&state.download_dir).clone();
    #[cfg(not(target_os = "android"))]
    {
        Sink::create(&download_dir, name, mime).await
    }
    #[cfg(target_os = "android")]
    {
        Sink::create(&download_dir, name, mime, &state.app_handle).await
    }
}

/// Unwinds a half-finished receive: tells the UI and (via Drop) deletes the
/// partial file.
fn fail_receive(state: &ServerState, transfer_id: &str, name: &str, why: &str) {
    eprintln!("Receive of {name} failed: {why}");
    let _ = state.app_handle.emit(
        "file-receive-error",
        json!({ "transfer_id": transfer_id, "file_name": name, "reason": why }),
    );
}

async fn upload_handler(
    State(state): State<ServerState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_receiving(&state)?;

    let mut file_size: Option<u64> = None;
    let mut session_id: Option<String> = None;
    let mut saved = 0usize;

    loop {
        let mut field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                if saved > 0 {
                    break;
                }
                return Err(err(StatusCode::BAD_REQUEST, format!("Bad upload: {e}")));
            }
        };

        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "size" => {
                file_size = field.text().await.ok().and_then(|t| t.trim().parse().ok());
                continue;
            }
            "session_id" => {
                if let Ok(txt) = field.text().await {
                    session_id = Some(txt.trim().trim_matches('"').to_string());
                }
                continue;
            }
            _ => {}
        }

        let Some(raw_file_name) = field.file_name().map(str::to_string) else {
            continue;
        };
        let mut file_name = sanitize_filename(&decode_name(&raw_file_name));
        let transfer_id = format!("{}_{}", Uuid::new_v4().simple(), saved);

        // --- authorisation ---------------------------------------------
        let mut byte_budget: Option<u64> = file_size.map(|s| s.saturating_add(SIZE_SLACK));
        if let Some(sid) = session_id.as_deref() {
            byte_budget = Some(claim_session(&state, sid, remote.ip())?);
        } else {
            check_rate(&state, remote.ip())?;
            let request = FileTransferRequest {
                transfer_id: transfer_id.clone(),
                file_name: file_name.clone(),
                file_size,
                sender_ip: remote.ip().to_string(),
            };
            let body = format!("{} — from {}", file_name, remote.ip());
            match ask_user(
                &state,
                &transfer_id,
                "file-transfer-request",
                &request,
                ("Incoming file", &body),
            )
            .await
            {
                Ask::Accepted => {}
                Ask::Rejected => return Err(err(StatusCode::FORBIDDEN, "Declined by receiver")),
                Ask::TimedOut => {
                    return Err(err(StatusCode::REQUEST_TIMEOUT, "Receiver didn't answer in time"))
                }
                Ask::Busy => {
                    return Err(err(
                        StatusCode::TOO_MANY_REQUESTS,
                        "Receiver is busy with other requests",
                    ))
                }
                Ask::Failed => {
                    return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Couldn't show the prompt"))
                }
            }
        }

        let _ = state.app_handle.emit(
            "file-receive-start",
            json!({ "transfer_id": transfer_id, "file_name": file_name }),
        );

        // --- stream to disk ----------------------------------------------
        let mut current_bytes: u64 = 0;
        let mut last_emit = Instant::now();
        let mut pending_first: Option<axum::body::Bytes> = None;

        // Peek the first chunk so the name/MIME can be inferred before the
        // file is created.
        match field.chunk().await {
            Ok(Some(chunk)) => pending_first = Some(chunk),
            Ok(None) => {}
            Err(e) => {
                fail_receive(&state, &transfer_id, &file_name, &e.to_string());
                return Err(err(StatusCode::BAD_REQUEST, format!("Upload interrupted: {e}")));
            }
        }

        let head: &[u8] = pending_first.as_deref().unwrap_or(&[]);
        let (named, mime) = name_and_mime_from_head(&file_name, head);
        file_name = named;
        let mut sink = match open_sink(&state, &file_name, mime.as_deref()).await {
            Ok(s) => s,
            Err(e) => {
                fail_receive(&state, &transfer_id, &file_name, &e);
                return Err(err(StatusCode::INSUFFICIENT_STORAGE, e));
            }
        };

        let mut next = pending_first.take();
        loop {
            let chunk = match next.take() {
                Some(c) => c,
                None => match field.chunk().await {
                    Ok(Some(c)) => c,
                    Ok(None) => break,
                    Err(e) => {
                        fail_receive(&state, &transfer_id, &file_name, &e.to_string());
                        return Err(err(StatusCode::BAD_REQUEST, format!("Upload interrupted: {e}")));
                    }
                },
            };

            current_bytes += chunk.len() as u64;
            if byte_budget.is_some_and(|b| current_bytes > b) {
                fail_receive(&state, &transfer_id, &file_name, "larger than announced");
                return Err(err(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "File is larger than what was approved",
                ));
            }
            if let Err(e) = sink.write(&chunk).await {
                fail_receive(&state, &transfer_id, &file_name, &e);
                return Err(err(StatusCode::INSUFFICIENT_STORAGE, e));
            }

            if last_emit.elapsed() > Duration::from_millis(100) {
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

        // --- publish -----------------------------------------------------
        let (final_name, final_path, file_uri) = match sink.commit().await {
            Ok(done) => done,
            Err(e) => {
                fail_receive(&state, &transfer_id, &file_name, &e);
                return Err(err(StatusCode::INSUFFICIENT_STORAGE, e));
            }
        };
        if let Some(sid) = session_id.as_deref() {
            settle_session(&state, sid, current_bytes);
        }
        eprintln!("Saved {final_name} ({current_bytes} bytes)");

        let _ = state.app_handle.emit(
            "transfer-progress",
            ProgressPayload {
                transfer_id: transfer_id.clone(),
                current_bytes,
                total_bytes: Some(current_bytes),
            },
        );

        let mut complete = json!({
            "transfer_id": transfer_id,
            "file_name": final_name,
            "size": current_bytes,
            "sender_ip": remote.ip().to_string(),
        });
        if let Some(path) = final_path {
            complete["file_path"] = json!(path);
        }
        if let Some(uri) = file_uri.as_ref() {
            complete["file_uri"] = json!(uri);
        }
        let native_shown = notify_received(&state, &transfer_id, &final_name, file_uri.as_deref());
        complete["show_in_app"] = json!(!native_shown);

        if let Err(e) = state.app_handle.emit("file-receive-complete", complete) {
            eprintln!("Failed to emit file-receive-complete: {}", e);
        }

        saved += 1;
        file_size = None;
    }

    if saved == 0 {
        return Err(err(StatusCode::BAD_REQUEST, "No file in upload"));
    }
    Ok(Json(json!({ "saved": saved })))
}

/// Android only: when the app is in the background, surface the received file
/// as a system notification. Returns whether one was shown.
#[cfg(target_os = "android")]
fn notify_received(
    state: &ServerState,
    transfer_id: &str,
    file_name: &str,
    file_uri: Option<&str>,
) -> bool {
    use tauri_plugin_notification::{NotificationExt, PermissionState};

    if state.app_foreground.load(Ordering::Relaxed) {
        return false;
    }
    let Some(uri) = file_uri else { return false };
    match state.app_handle.notification().permission_state() {
        Ok(PermissionState::Granted) => {
            let notification_id = transfer_id
                .bytes()
                .fold(0i32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as i32));
            match state
                .app_handle
                .notification()
                .builder()
                .id(notification_id)
                .channel_id("received-files")
                .title("File received")
                .body(format!("Tap to open {file_name}"))
                .extra("kind", "received-file")
                .extra("fileUri", uri)
                .auto_cancel()
                .show()
            {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("Failed to show received-file notification: {error}");
                    false
                }
            }
        }
        Ok(other) => {
            eprintln!("Notification permission not granted ({other}); using in-app toast");
            false
        }
        Err(error) => {
            eprintln!("Failed to check notification permission: {error}");
            false
        }
    }
}

#[cfg(not(target_os = "android"))]
fn notify_received(_: &ServerState, _: &str, _: &str, _: Option<&str>) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_human_readable() {
        assert_eq!(human_size(0), "0 B");
        assert_eq!(human_size(1536), "1.5 KB");
        assert_eq!(human_size(5 * 1024 * 1024), "5.0 MB");
    }

    #[test]
    fn apk_is_recognised_even_without_extension() {
        let mut head = vec![0x50, 0x4B, 0x03, 0x04];
        head.extend_from_slice(&[0u8; 40]);
        head.extend_from_slice(b"AndroidManifest.xml");
        let (name, mime) = name_and_mime_from_head("msf_1000285299", &head);
        assert_eq!(name, "msf_1000285299.apk");
        assert_eq!(mime.as_deref(), Some("application/vnd.android.package-archive"));
    }

    #[test]
    fn extension_is_inferred_only_when_missing() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        assert_eq!(name_and_mime_from_head("image_1", &png).0, "image_1.png");
        assert_eq!(name_and_mime_from_head("photo.jpeg", &png).0, "photo.jpeg");
    }
}
