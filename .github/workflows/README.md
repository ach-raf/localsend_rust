# GitHub Actions Workflows

## Build and Release Workflow

This workflow automatically builds Windows executables and Android APKs on every push to `master` or `release`, and additionally creates a GitHub Release when you push a version tag (or push to the dedicated `release` branch, or run it manually).

### How It Works

The workflow consists of 3 jobs:

1. **build-windows**: Builds the Windows executable (.msi and .exe installers)
2. **build-android**: Builds the Android APK
3. **create-release**: Combines both artifacts and creates a GitHub release — only for `v*` tags, the `release` branch, or manual dispatch (not on every master push)

### Triggering the Workflow

The workflow builds on every push to `master` or `release` (artifacts only). A GitHub Release is created only in the cases below.

#### Option 1: Push a Version Tag (Creates a GitHub Release) — recommended for shipping

```bash
# Tag the current commit
git tag v1.0.0

# Push the tag to GitHub
git push origin v1.0.0
```

This will:

1. Build both Windows and Android versions
2. Create a GitHub release with the tag name
3. Upload all build artifacts to the release

#### Option 2: Push to the `release` Branch (Creates a GitHub Release)

```bash
git checkout -b release
git push origin release
```

Same outcome as a tag — builds both platforms and publishes a release (tagged `build-<date>-<run>`).

#### Option 3: Push to `master` (Artifacts Only)

Pushes to `master` build both platforms and upload them as workflow artifacts (available for 30 days in the Actions tab), but do **not** create a GitHub Release. Use this for ongoing development; cut a `v*` tag when you're ready to ship.

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

- Releases are only created for `v*` tags, the `release` branch, or manual dispatch — a plain `master` push only builds artifacts
- Check that the tag name starts with 'v' (e.g., `v1.0.0`)
- Verify the `GITHUB_TOKEN` has permission to create releases

### File Locations After Build

**Windows:**

- MSI: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi`
- EXE: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`

**Android:**

- APK: `src-tauri/gen/android/app/build/outputs/apk/**/*.apk`

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
