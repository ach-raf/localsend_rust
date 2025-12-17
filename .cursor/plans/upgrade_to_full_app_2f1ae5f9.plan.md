---
name: Upgrade to Full App
overview: Upgrade the MVP to a production-ready application by implementing streaming file transfers (removing memory limits), adding progress tracking, and implementing a transfer history.
todos: []
---

# Upgrade to Full-Fledged App

This plan addresses critical scalability issues and adds essential features to move the application from MVP to Production status.

## 1. Core Architecture: Streaming & Scalability

Currently, the app loads entire files into memory before sending/saving. This causes crashes with large files (>1GB).

- [ ] **Refactor `server.rs` (Receiver)**
    - Implement streaming multipart uploads directly to a temporary file in the Downloads folder (e.g., `.tmp` extension).
    - Avoid `file_data.extend_from_slice` which buffers in RAM.
    - Emit `transfer-progress` events during the write loop.
    - On user acceptance: Rename `.tmp` file to final filename.
    - On user rejection/timeout: Delete `.tmp` file.

- [ ] **Refactor `transfer.rs` (Sender)**
    - Ensure `reqwest` uses streaming bodies for file uploads.
    - Monitor the upload stream to emit `transfer-progress` events to the sender UI.

## 2. User Experience: Progress Tracking

- [ ] **Frontend State Management**
    - Add state for `transferProgress` (percentage, speed, eta).
    - Handle multiple concurrent transfers in the UI state.
- [ ] **UI Components**
    - Add `ProgressBar` to the Transfer Modal.
    - Show transfer speed and remaining time.

## 3. Feature: Transfer History

- [ ] **Backend Storage**
    - Create a simple persistent store (JSON file `history.json`) in the app config directory.
    - Store records: `id`, `filename`, `size`, `peer`, `direction` (send/receive), `status`, `timestamp`.
- [ ] **Frontend History Page**
    - Create `src/pages/History.tsx`.
    - Display list of past transfers.
    - Add "Clear History" button.
    - Add to Navigation bar.

## 4. (Optional) Advanced Features

- [ ] **Multiple Files / Folder Support**: Zip folders on the fly or send manifests (more complex, suggest doing after 1-3).
- [ ] **Encryption**: Add TLS/HTTPS support (self-signed certs).

## Files to Modify

- `src-tauri/src/server.rs`: Rewrite `upload_handler` for streaming.
- `src-tauri/src/transfer.rs`: Update `send_file`.
- `src/pages/Home.tsx`: Add progress bars.
- `src/App.tsx`: Add routing for History.
- `src/pages/History.tsx`: New file.