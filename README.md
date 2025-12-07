# LocalSend Rust

A cross-platform file sharing application built with Tauri, React, and TypeScript.

## Features

- 🚀 Fast and lightweight file transfers
- 🔒 Secure local network sharing
- 📱 Cross-platform: Windows, Android (and more coming soon)
- 🎨 Modern and intuitive UI built with React and Mantine

## Building the App

### Build for Current Platform

```bash
npm run tauri build
```

### Build for Android

```bash
npm run tauri android build -- --release
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
