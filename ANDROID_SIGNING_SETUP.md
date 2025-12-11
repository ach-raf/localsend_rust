# Android APK Signing Setup Guide

## Problem

Android requires all APKs to be signed before they can be installed. Without signing, you'll get:

```
INSTALL_PARSE_FAILED_NO_CERTIFICATES: Failed to collect certificates
```

## Complete Setup from Scratch

Follow these steps to set up Android APK signing for your Tauri app.

---

## Step 1: Generate the Keystore File

The keystore file contains the cryptographic keys used to sign your APK.

### Development Keystore (for testing)

```bash
keytool -genkey -v -keystore "src-tauri/gen/android/app/upload-keystore.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias upload -storepass android -keypass android -dname "CN=Tauri App, OU=Development, O=MyCompany, L=City, S=State, C=US"
```

### Production Keystore (for Google Play)

⚠️ **CRITICAL**: Use strong passwords for production!

```bash
keytool -genkey -v -keystore "src-tauri/gen/android/app/production-keystore.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias production -storepass YOUR_STRONG_PASSWORD -keypass YOUR_STRONG_PASSWORD -dname "CN=Your Company, OU=Mobile, O=Your Company Inc, L=Your City, S=Your State, C=US"
```

**Generated File Location**: `src-tauri/gen/android/app/upload-keystore.jks`

---

## Step 2: Create key.properties File

Create `src-tauri/gen/android/key.properties` with your signing credentials:

### For Development:

```properties
storePassword=android
keyPassword=android
keyAlias=upload
storeFile=upload-keystore.jks
```

### For Production:

```properties
storePassword=YOUR_STRONG_PASSWORD
keyPassword=YOUR_STRONG_PASSWORD
keyAlias=production
storeFile=production-keystore.jks
```

**Important Notes:**

- The `storeFile` path is relative to the `app/` directory
- Keep this file secure and **never commit it to public repositories**
- For this project, we've temporarily committed it for easier reproduction (development only!)

---

## Step 3: Configure build.gradle.kts

Update `src-tauri/gen/android/app/build.gradle.kts` to load the signing configuration.

Add these imports at the top:

```kotlin
import java.util.Properties
import java.io.FileInputStream
```

Add the keystore properties loading after the `tauriProperties` block:

```kotlin
val keyPropertiesFile = rootProject.file("key.properties")
val keyProperties = Properties()
if (keyPropertiesFile.exists()) {
    keyProperties.load(FileInputStream(keyPropertiesFile))
}
```

Add signing configuration inside the `android {}` block:

```kotlin
android {
    // ... existing config ...

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
        // ... debug config ...

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

---

## Step 4: Update .gitignore (Optional for Production)

For production apps, add to `src-tauri/gen/android/.gitignore`:

```gitignore
# Signing files (UNCOMMENT FOR PRODUCTION)
# key.properties
# *.jks
# *.keystore
```

**Note**: Currently these are commented out for easier development reproduction.

---

## Building and Installing

### Build Signed APK

```bash
npm run tauri android build -- --release
```

**Output Location**:

- Universal APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
- Architecture-specific APKs: `src-tauri/gen/android/app/build/outputs/apk/[arch]/release/`

### Install on Device

#### Option 1: Via ADB (Recommended)

```bash
# Find the APK
cd src-tauri/gen/android/app/build/outputs/apk/universal/release/

# Install
adb install app-universal-release.apk

# Or force reinstall
adb install -r app-universal-release.apk
```

#### Option 2: Manual Installation

1. Transfer the APK to your Android device
2. Enable "Install from Unknown Sources" in Settings → Security
3. Open the APK file using a file manager
4. Tap "Install"

---

## File Structure Reference

```
src-tauri/gen/android/
├── key.properties                          # Signing credentials (DO NOT COMMIT FOR PRODUCTION)
├── app/
│   ├── upload-keystore.jks                # Keystore file (DO NOT COMMIT FOR PRODUCTION)
│   └── build.gradle.kts                   # Modified to include signing config
└── .gitignore                             # Updated to exclude signing files
```

---

## Complete key.properties Reference

```properties
# Store password (password for the keystore file)
storePassword=android

# Key password (password for the specific key/alias)
keyPassword=android

# Key alias (name of the key in the keystore)
keyAlias=upload

# Store file path (relative to the app/ directory)
# Use forward slashes even on Windows
storeFile=upload-keystore.jks
```

**Path Resolution**:

- The `storeFile` path is relative to `src-tauri/gen/android/app/`
- ✅ Correct: `storeFile=upload-keystore.jks`
- ❌ Wrong: `storeFile=app/upload-keystore.jks` (adds extra `app/` in path)

---

## Reproducing This Setup

If you need to recreate this setup on a new machine or project:

1. **Copy these files**:

   ```
   src-tauri/gen/android/key.properties
   src-tauri/gen/android/app/upload-keystore.jks
   ```

2. **Or regenerate from scratch**:

   ```bash
   # Step 1: Generate keystore
   keytool -genkey -v \
     -keystore "src-tauri/gen/android/app/upload-keystore.jks" \
     -keyalg RSA \
     -keysize 2048 \
     -validity 10000 \
     -alias upload \
     -storepass android \
     -keypass android \
     -dname "CN=Tauri App, OU=Development, O=MyCompany, L=City, S=State, C=US"

   # Step 2: Create key.properties file
   # (Create the file with the content shown in Step 2 above)

   # Step 3: Ensure build.gradle.kts has the signing configuration
   # (Already included in this project)
   ```

3. **Verify setup**:

   ```bash
   # List keystore contents
   keytool -list -v \
     -keystore src-tauri/gen/android/app/upload-keystore.jks \
     -storepass android

   # Build to test
   npm run tauri android build -- --release
   ```

---

## Production Deployment Checklist

When deploying to Google Play Store:

- [ ] Generate a production keystore with strong passwords
- [ ] Update `key.properties` with production credentials
- [ ] Back up the keystore file to 3+ secure locations
- [ ] Document the passwords in a secure password manager
- [ ] Add signing files to `.gitignore`
- [ ] Remove signing files from git history if accidentally committed
- [ ] Test the signed APK on multiple devices
- [ ] Keep the keystore file forever (required for all future updates)

**⚠️ WARNING**: If you lose your production keystore, you cannot update your app on Google Play!

---

## Troubleshooting

### Error: "Keystore file not found"

**Symptom**:

```
Keystore file 'D:\...\app\app\upload-keystore.jks' not found
```

**Solution**:

- Check that `storeFile=upload-keystore.jks` (not `app/upload-keystore.jks`)
- The path is relative to the `app/` directory
- Verify the keystore file exists: `ls src-tauri/gen/android/app/*.jks`

### Error: "INSTALL_PARSE_FAILED_NO_CERTIFICATES"

**Symptom**: APK won't install, certificate error

**Solution**:

- Ensure `key.properties` exists
- Verify the keystore file exists
- Check that `build.gradle.kts` has the signing configuration
- Try cleaning: `npm run tauri android build -- --clean`

### Error: "Incorrect AVA format"

**Symptom**: Keystore generation fails

**Solution**:

- Use double quotes around paths with spaces: `"D:\Path With Spaces\file.jks"`
- Ensure the directory exists before generating the keystore

### Error: "Wrong password" or "keystore was tampered with"

**Symptom**: Build fails with password error

**Solution**:

- Verify passwords in `key.properties` match the keystore
- Check for typos or extra spaces
- Regenerate the keystore if passwords are lost

### Verify Your Setup

```bash
# 1. Check keystore exists
ls src-tauri/gen/android/app/*.jks

# 2. Check key.properties exists
cat src-tauri/gen/android/key.properties

# 3. List keystore contents
keytool -list -v -keystore src-tauri/gen/android/app/upload-keystore.jks -storepass android

# 4. Check ADB devices
adb devices

# 5. Clean and rebuild
npm run tauri android build -- --clean
```

---

## Quick Reference Commands

```bash
# Generate development keystore
keytool -genkey -v -keystore "src-tauri/gen/android/app/upload-keystore.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias upload -storepass android -keypass android -dname "CN=Tauri App, OU=Development, O=MyCompany, L=City, S=State, C=US"

# Verify keystore
keytool -list -v -keystore src-tauri/gen/android/app/upload-keystore.jks -storepass android

# Build release APK
npm run tauri android build -- --release

# Install on device
adb install src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

# View Android logs
adb logcat | grep -i "tauri\|rust"

# Clean build
npm run tauri android build -- --clean
```

---

## Additional Resources

- [Official Tauri Android Guide](https://tauri.app/v1/guides/building/android)
- [Android App Signing](https://developer.android.com/studio/publish/app-signing)
- [Keytool Documentation](https://docs.oracle.com/javase/8/docs/technotes/tools/unix/keytool.html)
- [Flutter Signing Guide (similar process)](https://docs.flutter.dev/deployment/android#signing-the-app)

---

## Summary

✅ **What was done**:

1. Generated `upload-keystore.jks` with development credentials
2. Created `key.properties` with signing configuration
3. Modified `build.gradle.kts` to load and use signing configuration
4. Updated `.gitignore` (commented out for development convenience)

✅ **Result**: Your Android APK is now signed and can be installed on devices!

⚠️ **Remember**: These are development credentials. Use strong passwords and secure storage for production apps!
