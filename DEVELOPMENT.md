# Local Share development

This document covers local setup, builds, verification, and the parts of the
architecture that are useful when changing the project. See [README.md](README.md)
for the end-user overview.

## Project layout

Local Share is a Tauri 2 application with two main parts:

- `src/` contains the React 19 and TypeScript interface. It uses Mantine,
  Tailwind, and Vite.
- `src-tauri/src/` contains the Rust backend. It uses mDNS for discovery, Axum
  for the receiving HTTP server, and Tauri commands and events to communicate
  with the interface.

The app uses its own `_myshare_app._tcp.local.` mDNS service and HTTP protocol.
It is not compatible with LocalSend clients.

## Prerequisites

All platforms require:

- Node.js 20
- npm
- the stable Rust toolchain
- the platform prerequisites from the [Tauri 2 documentation](https://v2.tauri.app/start/prerequisites/)

Android builds also require Java 17, the Android SDK, and NDK
`26.1.10909125`. The CI build targets Android API 34.

## Install dependencies

From the repository root:

```bash
npm install
```

Use `npm ci` when you want an exact install from `package-lock.json`, as the CI
workflow does.

## Run locally

Run the complete desktop application, including the Rust backend:

```bash
npm run tauri dev
```

The Vite development server uses port `1420`. The peer-to-peer HTTP server uses
port `3030` by default; users can change that port in Settings.

`npm run dev` starts only the Vite frontend. Most features will not work because
Tauri commands and native events are unavailable in a browser.

## Verification

There is no automated test suite in this repository. Use these checks before
submitting a change:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

`npm run build` runs the TypeScript compiler and creates the Vite production
bundle. Changes to discovery or transfers should also be exercised manually
with two devices running `npm run tauri dev` or an installed build.

## Desktop builds

Build installers for the current desktop platform:

```bash
npm run tauri build
```

Tauri writes desktop bundles below `src-tauri/target/release/bundle/` unless a
specific Rust target was selected.

### Linux prerequisites

On Debian or Ubuntu, install the native packages required by the current Tauri
configuration:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

Then run `npm run tauri build`. The configured bundle targets produce `.deb`,
`.rpm`, and `.AppImage` packages.

## Android builds

The Android project under `src-tauri/gen/android/` is committed and contains
project-specific Gradle and signing configuration. Do not run
`npm run tauri android init` during normal setup: it can overwrite those files.

Build a universal signed APK:

```bash
npx tauri android build --apk
```

Build smaller, architecture-specific APKs:

```bash
npx tauri android build --split-per-abi --apk
```

APK output is written below
`src-tauri/gen/android/app/build/outputs/apk/`. See
[ANDROID_SIGNING.md](ANDROID_SIGNING.md) before changing anything related to the
keystore, `key.properties`, Gradle signing configuration, or release signing.

### Passing Tauri CLI flags

Use `npx tauri ...` for commands with flags. Do not pass Tauri flags through an
npm script; npm currently interprets flags such as `--apk` as npm configuration
and warns that unknown options may stop working in a future release.

Commands without flags, such as `npm run tauri dev` and
`npm run tauri build`, can continue to use the npm script.

## How transfers work

Each app instance advertises itself over mDNS and runs an Axum server on its
configured port. The server exposes four routes:

- `GET /ping` checks whether a discovered peer is reachable.
- `POST /request` asks the receiving device to approve a batch of files.
- `POST /upload` streams a file after approval.
- `POST /message` delivers a text message.

A multi-file transfer is approved once. The sender first submits file metadata
to `/request`; after the receiver accepts, subsequent `/upload` requests use the
authorized session ID. A file sent without a session uses a per-file approval
prompt.

Files and messages are sent over unencrypted HTTP on the local network. The
application deliberately has no cloud relay or account service.

## Platform-specific behavior

- Windows and Linux use normal filesystem paths and save received files through
  the platform Downloads directory.
- Android uses content URIs for selected files and MediaStore for received files
  in Downloads.
- Android filename recovery includes content-based extension detection for
  providers that return ID-only names, including special handling for APK files.

When changing transfers, keep the Android and desktop code paths in sync.

## Tauri command and event bridge

The interface calls Rust with Tauri `invoke`. New commands must be registered in
the `invoke_handler!` list in `src-tauri/src/lib.rs` as well as implemented.

Rust sends peer, transfer, and message updates back as Tauri events. The main
frontend subscriptions are in `src/pages/Home.tsx`; changes to an event name or
payload must be applied on both sides.

## Automated releases

`.github/workflows/build-release.yml` runs on every push to `master` and can also
be started manually. It builds:

- Windows x86_64 installers and a portable ZIP
- Linux x86_64 `.deb`, `.rpm`, and `.AppImage` packages
- Android universal and per-ABI APKs

After a successful build, the workflow publishes a regular GitHub Release with
a generated tag in the form `vYYYY.MM.DD-<run-number>`. A push to a separate
`release` branch or a manually created version tag is not part of the current
release process.

The Android job uses repository secrets when `ANDROID_KEYSTORE_BASE64` is set.
Without those secrets, the runner replaces the checked-in keystore with a new
throwaway key for that run. Read [ANDROID_SIGNING.md](ANDROID_SIGNING.md) for the
signature implications and the expected keystore identity.

## Key configuration files

- `package.json`: frontend dependencies and npm scripts
- `vite.config.ts`: Vite development server and frontend build configuration
- `src-tauri/Cargo.toml`: Rust dependencies and package metadata
- `src-tauri/tauri.conf.json`: application identity, window, and bundle settings
- `src-tauri/capabilities/default.json`: Tauri permissions and HTTP scope
- `.github/workflows/build-release.yml`: CI builds and GitHub Releases
