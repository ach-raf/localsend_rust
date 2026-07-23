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

> **⚠️ Pass flags with `npx`, not `npm run`.**
> `npm run tauri android build -- --apk` produces `npm warn Unknown cli config "--apk"`. npm inspects **every** flag on the line — even the ones after `--` — against its own config, warns about the ones it doesn't know, and a future npm version will drop them entirely ([npm/cli#9353](https://github.com/npm/cli/issues/9353)).
> `npx tauri ...` runs the CLI directly, so the flags reach Tauri untouched. Use `npm run tauri X` only for commands with **no** flags (`dev`, `build`, `android init`).

### Build for Current Platform (desktop)

```bash
npm run tauri build      # no flags → npm run is fine
```

### Build for Android

**⚠️ First-time setup**: Android APKs must be signed. See [ANDROID_SIGNING.md](ANDROID_SIGNING.md) for the full guide (current setup, CI, troubleshooting, backups, and production signing).

```bash
# Initialize Android project (first time only) — no flags, npm run is fine
npm run tauri android init

# Build a single universal signed APK (smallest command, one file for all devices)
npx tauri android build --apk

# Build one signed APK per architecture (smaller per-device downloads)
npx tauri android build --split-per-abi --apk
```

The flags (from `npx tauri android build --help`):

| Flag | Meaning |
| --- | --- |
| `--apk` | Build APKs (Play Store submission uses `--aab` instead) |
| `--aab` | Build AABs (Android App Bundle) |
| `--split-per-abi` | Split the output per ABI instead of one universal bundle |
| `-t, --target <TARGETS>` | Build only specific targets: `aarch64`, `armv7`, `i686`, `x86_64` |
| `-d, --debug` | Debug build instead of release |

> `--apk` and `--aab` are boolean flags — write `--apk`, **not** `--apk true`. Omitting both builds APK + AAB.

**Output** (under `src-tauri/gen/android/app/build/outputs/apk/`):

- Universal build (`--apk`): `universal/release/app-universal-release.apk`
- Split build (`--split-per-abi --apk`): one APK per ABI —

  ```
  arm64/release/app-arm64-release.apk       ← modern 64-bit phones (use this one)
  arm/release/app-arm-release.apk           ← older 32-bit phones
  x86_64/release/app-x86_64-release.apk     ← emulators / tablets
  x86/release/app-x86-release.apk           ← rare devices
  ```

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

See [ANDROID_SIGNING.md](ANDROID_SIGNING.md) for detailed instructions.

## Development

### Prerequisites

- Node.js 18+
- Rust 1.70+
- For Android: Android SDK, NDK, Java 17+

### Running in Development Mode

```bash
npm install
npm run tauri dev     # no flags → npm run is fine
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite
- **UI Framework**: Mantine
- **Backend**: Rust, Tauri 2.0
- **Server**: Axum (HTTP server)
- **Networking**: mDNS for device discovery
