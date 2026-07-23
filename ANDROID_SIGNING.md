# Android Signing — Full Guide

Android requires every APK/AAB to be **signed** before it can be installed or uploaded to a store. Unsigned builds fail with `INSTALL_PARSE_FAILED_NO_CERTIFICATES`. This document is the single source of truth for how signing works in this project — local builds, CI, troubleshooting, backups, and how to graduate to production signing later.

> **Status (2026-07-21):** this project uses a **committed development keystore** (the deliberate "half-assed keystore for now" tradeoff). It is committed to git so that every machine and the CI runner produce APKs with the **same** signature. Graduating to private / Google-Play signing is documented at the end but has **not** been done.

---

## TL;DR — just build a signed APK

If the keystore is already in place (it is, in this repo):

```bash
npx tauri android build --split-per-abi --apk
```

> **Use `npx`, not `npm run ... --`.** npm parses flags on the line — even after `--` — as its own config and warns about unknown ones (`npm warn Unknown cli config "--apk"`); a future npm will drop them entirely ([npm/cli#9353](https://github.com/npm/cli/issues/9353)). `npx tauri ...` passes the flags straight to the CLI.

Output (per architecture):

```
src-tauri/gen/android/app/build/outputs/apk/<arch>/release/app-<arch>-release.apk
```

For a single universal APK instead:

```bash
npx tauri android build --apk
# -> .../apk/universal/release/app-universal-release.apk
```

Install on a connected device:

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

`tauri android build` produces a **release** build by default — it is signed automatically with the configured release key. There is no `--release` flag to add. `--apk` is a boolean flag — write `--apk`, not `--apk true`.

---

## Current state of this project

The keystore, its credentials, and the Gradle config that wires them up are **all committed** under `src-tauri/gen/android/`. The whole `gen/android/` directory is tracked by git on purpose — that is why CI does not run `tauri android init` and why the signing customization survives.

**The locked key's identity** (use this to verify nothing has changed):

| Field                | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| Keystore type        | PKCS12                                                              |
| Alias                | `upload`                                                            |
| Store password       | `android`                                                           |
| Key password         | `android`                                                           |
| Owner (DN)           | `CN=Tauri App, OU=Development, O=MyCompany, L=City, ST=State, C=US` |
| Valid                | 2025-12-11 → **2053-04-28**                                         |
| Signature algorithm  | `SHA384withRSA`                                                     |
| **SHA1 fingerprint** | `82:30:39:75:1B:D9:28:2B:C8:9E:10:6C:D5:43:A1:13:C7:1C:7A:49`       |

Verify at any time:

```bash
keytool -list -v -keystore src-tauri/gen/android/app/upload-keystore.jks -storepass android
```

If the SHA1 ever differs from the value above, **the keystore was regenerated** — see _Do not break this_.

---

## The signing files (what each one does)

Only **three** files do active signing work. Everything else is documentation/tooling.

```
src-tauri/gen/android/
├── app/
│   ├── upload-keystore.jks     # ACTIVE — the keystore (private key + cert), committed
│   ├── build.gradle.kts        # ACTIVE — loads key.properties, wires signing into the release build
│   └── proguard-rules.pro       # ACTIVE — R8/ProGuard rules for the minified release build
├── key.properties               # ACTIVE — credentials read by Gradle, committed
├── key.properties.template      # REFERENCE — same dev values + commented production guidance
└── .gitignore                   # the keystore/key.properties ignore lines are COMMENTED OUT on purpose
```

Repo-root files that are **not** active mechanisms, just helpers/docs:

- `ANDROID_SIGNING.md` — this file.
- `generate-android-keystore.sh` / `.bat` — one-shot scripts to regenerate a dev keystore. **Dangerous** to the committed identity; see _Do not break this_.

### `key.properties`

Read by Gradle at build time. `storeFile` is **relative to the `app/` directory**.

```properties
storePassword=android
keyPassword=android
keyAlias=upload
storeFile=upload-keystore.jks
```

> ✅ `storeFile=upload-keystore.jks` — correct (relative to `app/`)
> ❌ `storeFile=app/upload-keystore.jks` — wrong (double `app/`, causes "Keystore file not found" looking for `app/app/upload-keystore.jks`)

### `build.gradle.kts`

The relevant pieces (already in the committed file):

```kotlin
import java.util.Properties
import java.io.FileInputStream

// ... after tauriProperties ...
val keyPropertiesFile = rootProject.file("key.properties")
val keyProperties = Properties()
if (keyPropertiesFile.exists()) {
    keyProperties.load(FileInputStream(keyPropertiesFile))
}

android {
    signingConfigs {
        create("release") {
            if (keyPropertiesFile.exists()) {
                keyAlias = keyProperties["keyAlias"] as String
                keyPassword = keyProperties["keyPassword"] as String
                storeFile = file(keyProperties["storeFile"] as String)
                storePassword = keyProperties["storePassword"] as String
            }
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            if (keyPropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
}
```

If `key.properties` is absent, the release build is **unsigned** (the `if` guards skip the signing config) — so simply deleting `key.properties` produces an APK that won't install.

---

## CI — GitHub Actions (`.github/workflows/build-release.yml`)

The `build-android` job has a "Setup Android Keystore" step with **two branches**:

1. **If `ANDROID_KEYSTORE_BASE64` secret is set** → it is base64-decoded to `app/upload-keystore.jks`, and `key.properties` is written from the secrets. This is the production-key path.
2. **Else** → the step runs `keytool` to generate a **brand-new debug keystore on every run**, overwriting the committed `app/upload-keystore.jks` and `key.properties` on the runner.

> ⚠️ **Drift landmine:** if the `ANDROID_KEYSTORE_BASE64` secret is **not** set, every CI run signs with a _different throwaway key_ than your local builds (and a different one each run). Installing a CI build over a local build — or over a previous CI build — then fails with a signature mismatch and forces a full reinstall.
>
> For **consistent local ↔ CI signatures**, the `ANDROID_KEYSTORE_BASE64` secret must contain the **committed** keystore's bytes, and the password/alias secrets must match (`android` / `android` / `upload`).

The four CI secrets:

| Secret                      | Meaning                                                  |
| --------------------------- | -------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | Base64 of the `.jks` file (`base64 upload-keystore.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password (`android` for the dev key)            |
| `ANDROID_KEY_PASSWORD`      | Key password (`android` for the dev key)                 |
| `ANDROID_KEY_ALIAS`         | Key alias (`upload` for the dev key)                     |

To check whether they are set (read-only):

```bash
gh auth login      # once
gh secret list     # look for the four names above
```

---

## Do not break this

These are the ways the setup gets accidentally broken. All of them shift or remove the signing identity.

1. **Do not uncomment the signing lines in `src-tauri/gen/android/.gitignore`.** They are currently commented out with `# we are just using some half assed keystore for now`. Uncommenting `key.properties` / `*.jks` / `*.keystore` would remove the keystore from git on the next commit, and CI would no longer have a key (unless secrets are set).
2. **Do not run `generate-android-keystore.sh` / `.bat` casually.** They overwrite `app/upload-keystore.jks` with a freshly generated key — the SHA1 changes and previously installed APKs can no longer be upgraded in place. The scripts do prompt before overwrite, but the new identity still differs.
3. **Do not run `npm run tauri android init` casually.** It can regenerate `gen/android/` and overwrite the customized `build.gradle.kts`. Git protects you — `git checkout -- src-tauri/gen/android/app/build.gradle.kts` restores the committed version — but only if you notice and revert.

---

## Back up the keystore

The keystore is committed to git, so it is already backed up through your remote. Keep **one additional copy outside git** in case you ever purge it from the repo later (e.g. when graduating to private signing).

1. Copy the file to 2–3 secure locations (password-manager attachment, encrypted USB, private cloud vault):
   ```
   src-tauri/gen/android/app/upload-keystore.jks
   ```
2. Record next to the copy: alias `upload`, store/key password `android`, **SHA1 `82:30:39:75:1B:D9:28:2B:C8:9E:10:6C:D5:43:A1:13:C7:1C:7A:49`**.
3. Verify the backup is the right key:
   ```bash
   keytool -list -v -keystore <your-copy> -storepass android
   # confirm the SHA1 matches
   ```

> ⚠️ If you ever lose this key (and it is your Play Store upload key), **you cannot publish updates to your app.** Back it up redundantly.

---

## First-time setup (only if recreating from scratch)

You do **not** normally need this — the files are already committed. Use this section only when bootstrapping a fresh checkout that lacks the keystore, or a new project. **Be aware: running this changes the signing identity** — any APKs already installed under the old key will not upgrade in place.

### 1. Generate the keystore

Development (matches the committed identity's password scheme):

```bash
keytool -genkey -v \
  -keystore "src-tauri/gen/android/app/upload-keystore.jks" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload -storepass android -keypass android \
  -dname "CN=Tauri App, OU=Development, O=MyCompany, L=City, S=State, C=US"
```

Production (strong passwords, **never** commit — use only with the CI-secrets path):

```bash
keytool -genkey -v \
  -keystore "production-keystore.jks" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias production -storepass YOUR_STRONG_PASSWORD -keypass YOUR_STRONG_PASSWORD \
  -dname "CN=Your Company, OU=Mobile, O=Your Company Inc, L=Your City, S=Your State, C=US"
```

`-validity 10000` (~27 years) keeps the cert valid well beyond typical lifetimes.

### 2. Create `key.properties`

```properties
storePassword=android
keyPassword=android
keyAlias=upload
storeFile=upload-keystore.jks
```

### 3. Confirm `build.gradle.kts` has the signing config

It already does in this repo (see _The signing files_). On a fresh project, paste the `signingConfigs` + release-`buildType` block from that section.

### 4. Verify

```bash
ls src-tauri/gen/android/key.properties
ls src-tauri/gen/android/app/upload-keystore.jks
keytool -list -v -keystore src-tauri/gen/android/app/upload-keystore.jks -storepass android
```

---

## Installing the signed APK

**Via ADB (recommended):**

```bash
adb devices                                                     # confirm device is connected
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

**Manually:** copy the `.apk` to the device, enable _Install from Unknown Sources_, and open it with a file manager.

---

## Troubleshooting

### `Keystore file '...\app\app\upload-keystore.jks' not found`

The `storeFile` path is wrong — it doubled the `app/` segment.

- Fix: `storeFile=upload-keystore.jks` (relative to the `app/` dir, **not** `app/upload-keystore.jks`).

### `INSTALL_PARSE_FAILED_NO_CERTIFICATES`

The release APK was built without signing — `key.properties` is missing or the `signingConfig` line was removed from `build.gradle.kts`.

- Confirm `src-tauri/gen/android/key.properties` exists and has all four keys.
- Confirm `build.gradle.kts` wires `signingConfigs.getByName("release")` into the `release` buildType.
- Clean and rebuild: `npx tauri android build --apk` (remove stale outputs under `app/build/` if needed).

### `Wrong password` / `keystore was tampered with`

- Verify the passwords in `key.properties` match the keystore (`android` / `android` for the committed dev key).
- Check for typos, trailing spaces, or smart-quotes pasted from a doc.
- Regenerate only as a last resort — it changes the identity.

### `Incorrect AVA format` (during `keytool -genkey`)

- Double-quote paths that contain spaces: `"D:\Path With Spaces\file.jks"`.
- Ensure the target directory exists first.

### APK installs but won't upgrade an existing install ("app not installed" / signature conflict)

The new APK was signed with a **different key** than the one already on the device. Causes:

- CI built it without the `ANDROID_KEYSTORE_BASE64` secret → throwaway debug key (see _CI_).
- Someone regenerated the committed keystore.
- You are mixing a debug build and a release build.

Fix: align the signing identity (use the committed keystore everywhere; set the CI secret from it), then uninstall the old app and reinstall.

### Verify the whole setup in one go

```bash
ls src-tauri/gen/android/app/*.jks                  # keystore exists
cat src-tauri/gen/android/key.properties            # creds present
keytool -list -v -keystore src-tauri/gen/android/app/upload-keystore.jks -storepass android   # identity
adb devices                                         # device reachable
```

---

## Graduating to production / Google Play signing (deferred)

This project has **not** done this. Use it only if you are publishing to the Play Store or making the repo public. Once you upload a release key to Play, **you can never change it** — back it up in 3+ secure locations first.

1. Generate a strong production keystore locally (see _First-time setup_, production variant).
2. Add it to GitHub as the four secrets (`ANDROID_KEYSTORE_BASE64` = `base64 production-keystore.jks`, plus the strong passwords and alias). See README for the secret names.
3. Uncomment the signing lines in `src-tauri/gen/android/.gitignore`:
   ```gitignore
   key.properties
   *.jks
   *.keystore
   ```
4. Stop tracking the dev keystore and creds:
   ```bash
   git rm --cached src-tauri/gen/android/app/upload-keystore.jks
   git rm --cached src-tauri/gen/android/key.properties
   ```
5. Remove them from git history if the repo is or will become public (e.g. with `git filter-repo`), since they are currently in history.
6. Make the CI workflow's secret branch the only path (optionally fail the job if `ANDROID_KEYSTORE_BASE64` is unset instead of falling back to a debug key).
7. Upload the same key to Play Console as your app-signing key (or use Play App Signing and keep your upload key).

### Production checklist

- [ ] Production keystore generated with strong passwords
- [ ] Keystore added to GitHub secrets (base64 + passwords + alias)
- [ ] `key.properties` / `*.jks` / `*.keystore` added to `.gitignore`
- [ ] Keystore + creds removed from git index (and from history if repo is public)
- [ ] Keystore backed up to 3+ secure locations
- [ ] Passwords stored in a password manager
- [ ] CI builds verified to use the production key (check the SHA1 in build logs)
- [ ] Signed release APK tested on multiple devices before upload

---

## Quick reference

```bash
# Build a signed release APK
npx tauri android build --split-per-abi --apk

# Inspect the keystore identity
keytool -list -v -keystore src-tauri/gen/android/app/upload-keystore.jks -storepass android

# Install on a device
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

# Check whether CI signing secrets are set
gh secret list

# View app logs on the device
adb logcat | grep -iE "tauri|rust"
```
