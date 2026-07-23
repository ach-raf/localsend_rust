# GitHub Actions Workflows

## Build and Release Workflow

This workflow automatically builds Windows and Android versions and **publishes a real GitHub Release on every push to `master`**. No tags to create, no pre-releases — every push ships.

### How It Works

The workflow has 3 jobs:

1. **build-windows**: Builds the Windows executable (.msi and .exe installers) plus a portable `.zip` (standalone `Local Share.exe`, no install needed)
2. **build-android**: Builds the Android APK
3. **create-release**: Combines both, publishes a clean GitHub Release with the new commit messages as the notes

### Triggering the Workflow

Push to `master`. That's it.

```bash
git push origin master
```

This will:

1. Build both Windows and Android versions
2. Publish a **real** (non-pre-) release named like `Local Share v2026.07.23-18` (date + run number)
3. Attach all artifacts with clean names: MSI installer, NSIS `.exe` setup, portable `.zip`, and per-ABI APKs (universal, arm64-v8a, armeabi-v7a, x86_64, x86)
4. Fill the release notes with the commit messages from that push

You can also run it manually from the Actions tab → "Run workflow" (`workflow_dispatch`).

### Setting Up Android Signing (Important!)

For production releases, you should use your own keystore instead of the auto-generated debug keystore.

#### Step 1: Prepare Your Keystore

If you already have a keystore (`src-tauri/gen/android/app/upload-keystore.jks`), convert it to base64:

**Linux/Mac:**

```bash
base64 -i src-tauri/gen/android/app/upload-keystore.jks | tr -d '\n' > keystore.b64
```

**Windows (PowerShell):**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("src-tauri\gen\android\app\upload-keystore.jks")) | Out-File -Encoding ASCII keystore.b64
```

#### Step 2: Add GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

- **ANDROID_KEYSTORE_BASE64**: Paste the contents of `keystore.b64`
- **ANDROID_KEYSTORE_PASSWORD**: Your keystore password (default: `android`)
- **ANDROID_KEY_PASSWORD**: Your key password (default: `android`)
- **ANDROID_KEY_ALIAS**: Your key alias (default: `upload`)

⚠️ **If you don't set these secrets**, the workflow will automatically generate a debug keystore (NOT suitable for production releases to Google Play Store).

### Workflow Outputs

After the workflow completes:

#### For Branch Pushes (master):

- Artifacts are available in the Actions tab → Select workflow run → Artifacts section
- Download `windows-executable` and `android-apk` artifacts

#### For Tag / `release` Branch Pushes:

- A published (non-draft) release is created automatically
- The release body and files are available immediately on the Releases page

### Customization

#### Change the Trigger Branch

Edit `.github/workflows/build-release.yml`:

```yaml
on:
  push:
    branches:
      - main # Change from 'release' to 'main' or any other branch
```

#### Build Only on Tags

```yaml
on:
  push:
    tags:
      - "v*"
```

#### Manual Trigger

The workflow includes `workflow_dispatch`, so you can manually trigger it from:

- GitHub Actions tab → Select workflow → Run workflow

### Troubleshooting

#### Windows Build Fails

- Check that your `Cargo.toml` is properly configured
- Ensure all Rust dependencies are available on Windows
- Check the build logs for specific errors

#### Android Build Fails

Common issues:

1. **Missing Android SDK components**: The workflow installs them automatically, but versions might need adjustment
2. **NDK version mismatch**: Update the NDK version in the workflow if needed
3. **Keystore issues**: Verify your keystore secrets are correctly set

#### Release Not Created

- Every push to `master` should create a release. If it didn't, check the Actions log — the `create-release` job depends on both build jobs finishing first.
- Verify the `GITHUB_TOKEN` has permission to create releases (it does by default with `permissions: contents: write` at the top of the workflow).

#### Cleaning up old `build-*` pre-releases

The workflow used to auto-publish `build-YYYY-MM-DD-N` pre-releases. Those old releases and their tags can be deleted from the Releases page (each release has a Delete button), or in bulk with the GitHub CLI:

```bash
gh release list --json tagName -q '.[].tagName' | grep '^build-' | xargs -I{} gh release delete {} --cleanup-tag -y
```

### File Locations After Build

**Windows:**

- MSI: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi`
- EXE (NSIS installer): `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`
- Portable ZIP: `Local-Share-portable-x86_64.zip` — contains the standalone `Local Share.exe`, no install required (just extract and run)

**Android:**

- Universal APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk`
- Per-ABI APKs: `src-tauri/gen/android/app/build/outputs/apk/<abi>/release/*.apk`
  - `arm64` → `Local-Share-<TAG>-android-arm64-v8a.apk`
  - `arm` → `Local-Share-<TAG>-android-armeabi-v7a.apk`
  - `x86_64` → `Local-Share-<TAG>-android-x86_64.apk`
  - `x86` → `Local-Share-<TAG>-android-x86.apk`

### Best Practices

1. **Test locally first**: Build locally before pushing to ensure everything works
2. **Use semantic versioning**: Follow semver for your tags (e.g., v1.0.0, v1.1.0)
3. **Keep secrets secure**: Never commit keystores or passwords to the repository
4. **Update release notes**: Edit the release body with meaningful changelogs after publishing

### Additional Resources

- [Tauri Documentation](https://tauri.app/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Android App Signing](https://developer.android.com/studio/publish/app-signing)

### Support

If you encounter issues:

1. Check the Actions logs for detailed error messages
2. Review the Tauri and GitHub Actions documentation
3. Ensure all prerequisites are met (Node.js, Rust, Android SDK)
