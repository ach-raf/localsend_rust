# File Transfer Fixes

## Issues Fixed

### 1. URL-Encoded Filenames from Android

**Problem**: Files received from Android had names like `image%3A1000283390` without extensions because Android URIs contain colons (`:`) that get URL-encoded to `%3A`.

**Solution**:

- Added `urlencoding` dependency to decode URL-encoded filenames
- Sanitize filenames by replacing problematic characters (`:`, `/`, `\`) with underscores
- **NEW**: Added `infer` dependency to automatically detect and append file extensions (e.g., `.jpg`, `.png`, `.pdf`) based on file content when missing.

**Changes**:

- `src-tauri/Cargo.toml`: Added `urlencoding = "2.1"` and `infer = "0.15"`
- `src-tauri/src/server.rs`: Added URL decoding, filename sanitization, and magic-byte extension inference in `upload_handler`

### 2. Files Not Visible on Android

**Problem**: Files saved on Android weren't visible in the file manager or gallery apps because the media scanner wasn't notified.

**Solution**:

- Created a Kotlin plugin (`MediaScannerPlugin`) that calls Android's `MediaScanConnection.scanFile()`
- Integrated the plugin with the Tauri app to trigger media scans after files are saved
- Files now appear immediately in the Downloads folder and gallery

**Changes**:

- `src-tauri/gen/android/app/src/main/java/com/user/tauri_app/MediaScannerPlugin.kt`: New Kotlin plugin for media scanning
- `src-tauri/gen/android/app/src/main/java/com/user/tauri_app/MainActivity.kt`: Registered the media scanner plugin
- `src-tauri/src/server.rs`: Emits `trigger-media-scan` event after saving files on Android
- `src/pages/Home.tsx`: Added event listener to call the media scanner plugin

### 3. Windows to Android 0KB Files

**Problem**: Files sent from Windows to Android arrived as 0KB. This was caused by the frontend using `readFile` (JavaScript) to load files into memory before sending. This approach is memory-intensive, flaky for large files, and subject to strict Tauri FS scope permissions which often silently failed or returned empty data.

**Solution**:

- **Desktop (Windows/Linux/macOS)**: Switched to using `send_file_to_peer` Rust command. This passes the _file path_ to the backend, allowing Rust to stream the file directly from disk. This bypasses frontend memory limits and FS scope issues.
- **Mobile (Android)**: Kept `readFile` fallback because Android uses Content URIs that Rust cannot directly open as paths.

**Changes**:

- `src/pages/Home.tsx`: Updated `handleSelectFiles` and `unlistenFileDrop` to prioritize `send_file_to_peer` (path-based) and fallback to `send_file_bytes_to_peer` (byte-based).

### 4. Proper Downloads Folder Location

**Problem**: Files were being saved to inconsistent locations across platforms.

**Solution**:

- **Windows**: Now uses `%USERPROFILE%\Downloads`
- **Android**: Now uses `/storage/emulated/0/Download`
- **Other platforms**: Uses the system's download directory

**Changes**:

- `src-tauri/src/server.rs`: Updated `start_server()` to use platform-specific download directories.

## Verification

Internet search confirmed:

1. **Android Content URIs**: Indeed lack extensions, confirming the need for server-side inference.
2. **Large File Reads**: `fs.readFile` in JS is known to crash or fail with large files, confirming the move to Rust-native file streaming.

## Build Commands

```bash
# Build for Windows
npm run tauri build

# Build for Android
npm run tauri android build -- --release
```
