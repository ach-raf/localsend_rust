# Local Share

A cross-platform file sharing application built with Tauri, React, and TypeScript.

## Features

- 🚀 Fast and lightweight file transfers
- 🔒 Secure local network sharing
- 📱 Cross-platform: Windows, Android (and more coming soon)
- 🎨 Modern and intuitive UI built with React and Mantine

## Screenshots

### Desktop Version

<img src="screenshots/2025-12-25%2021_50_14-Local_Share-local-share.png" alt="Desktop Home" width="800" />
_Home screen with nearby peers_

<img src="screenshots/2025-12-25%2021_50_46-Local_Share-local-share.png" alt="Desktop Peer Selected" width="800" />
_Selecting a peer to send files_

<img src="screenshots/2025-12-25%2021_51_04-Local_Share-local-share.png" alt="Desktop Text Message" width="800" />
_Sending text messages_

<img src="screenshots/2025-12-25%2021_51_12-Local_Share-local-share.png" alt="Desktop Settings" width="800" />
_Settings configuration_

<img src="screenshots/2025-12-25%2021_52_49-Local_Share-local-share.png" alt="Desktop Incoming Transfer" width="800" />
_Incoming file transfer request_

<img src="screenshots/2025-12-25%2021_53_05-Local_Share-local-share.png" alt="Desktop File Received" width="800" />
_File received notification_

### Mobile Version

<img src="screenshots/Screenshot_20251225_215124_Local%20Share.jpg" alt="Mobile Home" width="400" />
_Mobile home screen_

<img src="screenshots/Screenshot_20251225_215136_Local%20Share.jpg" alt="Mobile Send Files" width="400" />
_Sending files from mobile_

<img src="screenshots/Screenshot_20251225_215141_Local%20Share.jpg" alt="Mobile Send Text" width="400" />
_Sending text messages from mobile_

<img src="screenshots/Screenshot_20251225_215218_Local%20Share.jpg" alt="Mobile Incoming Transfer" width="400" />
_Incoming file transfer on mobile_

## Building the App

### Build for Current Platform

```bash
npm run tauri build
```

### Build for Android

**⚠️ First-time setup**: Android APKs must be signed. See [ANDROID_SIGNING_QUICKSTART.md](ANDROID_SIGNING_QUICKSTART.md) for quick setup or [ANDROID_SIGNING_SETUP.md](ANDROID_SIGNING_SETUP.md) for detailed instructions.

```bash
# Initialize Android project (first time only)
npm run tauri android init

# Build signed APK
npm run tauri android build --split-per-abi --apk true
```

With --split-per-abi

Creates separate APKs for each architecture:

```bash
my-app-arm64-v8a.apk           (15 MB)  ← Modern
phonesmy-app-armeabi-v7a.apk   (15 MB)  ← Older
phonesmy-app-x86_64.apk        (15 MB)  ← Emulators/tablets
my-app-x86.apk                 (15 MB)  ← Rare devices
```

Can also use

```bash
--apk true or --aab true - Explicitly specify which format to build

-t <target> - Specify target architectures (e.g., aarch64, armv7, etc.)
```

**Output**: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`

## Automated Builds with GitHub Actions

This project includes a GitHub Actions workflow that automatically builds Windows executables and Android APKs.

### Quick Start with GitHub Actions

1. **Push to the release branch**:

   ```bash
   git checkout -b release
   git push origin release
   ```

   This creates build artifacts available in the GitHub Actions tab.

2. **Create a release with a version tag**:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

   This creates a GitHub release with both Windows and Android builds.

For more details, see [.github/workflows/README.md](.github/workflows/README.md)

### Setting Up Android Signing for CI/CD

To use your production keystore in GitHub Actions, add these secrets to your repository:

- `ANDROID_KEYSTORE_BASE64` - Base64 encoded keystore file
- `ANDROID_KEYSTORE_PASSWORD` - Keystore password
- `ANDROID_KEY_PASSWORD` - Key password
- `ANDROID_KEY_ALIAS` - Key alias

See [ANDROID_SIGNING_SETUP.md](ANDROID_SIGNING_SETUP.md) for detailed instructions.

## Development

### Prerequisites

- Node.js 18+
- Rust 1.70+
- For Android: Android SDK, NDK, Java 17+

### Running in Development Mode

```bash
npm install
npm run tauri dev
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite
- **UI Framework**: Mantine
- **Backend**: Rust, Tauri 2.0
- **Server**: Axum (HTTP server)
- **Networking**: mDNS for device discovery
