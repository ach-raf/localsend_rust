# Android APK Signing Setup Guide

## Problem

You were getting the error: `INSTALL_PARSE_FAILED_NO_CERTIFICATES: Failed to collect certificates`

This happens because Android requires all APKs to be signed before they can be installed on a device.

## Solution Applied

I've set up code signing for your Android app. Here's what was done:

### 1. Generated a Keystore File

Created `src-tauri/gen/android/app/upload-keystore.jks` with the following credentials:

- **Store Password**: `android`
- **Key Password**: `android`
- **Key Alias**: `upload`
- **Validity**: 10,000 days

⚠️ **IMPORTANT FOR PRODUCTION**: These are development credentials. For a production app, you should:

- Generate a new keystore with strong passwords
- Store the keystore and passwords securely
- Never commit the keystore to version control (already added to `.gitignore`)

### 2. Created Configuration File

Created `src-tauri/gen/android/key.properties` with the signing credentials.

### 3. Modified Build Configuration

Updated `src-tauri/gen/android/app/build.gradle.kts` to:

- Load the signing credentials from `key.properties`
- Configure the release build type to use the keystore for signing

## How to Build a Signed APK

Now you can build your Android app with:

```bash
npm run tauri android build
```

Or for a release build specifically:

```bash
npm run tauri android build -- --release
```

The generated APK will be signed and can be installed on your Android device.

## Installing the APK

After building, you can install the APK on your device:

1. **Via ADB (Android Debug Bridge)**:

   ```bash
   adb install path/to/your-app.apk
   ```

2. **Manual Installation**:
   - Transfer the APK to your device
   - Enable "Install from Unknown Sources" in your device settings
   - Open the APK file and install

## For Production Release

When you're ready to publish to the Google Play Store:

1. **Generate a production keystore**:

   ```bash
   keytool -genkey -v -keystore "D:\PycharmProjects\localsend_rust\src-tauri\gen\android\app\upload-keystore.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias upload -storepass android -keypass android -dname "CN=Tauri App, OU=Development, O=MyCompany, L=City, S=State, C=US"
   ```

2. **Update `key.properties`** with your new credentials:

   ```
   storePassword=YOUR_STRONG_PASSWORD
   keyPassword=YOUR_STRONG_PASSWORD
   keyAlias=production
   storeFile=app/production-keystore.jks
   ```

3. **Keep your keystore safe**:
   - Back it up in a secure location
   - Never share the passwords
   - If you lose this keystore, you won't be able to update your app on Google Play

## Files Modified/Created

- ✅ `src-tauri/gen/android/app/upload-keystore.jks` - Keystore file (created)
- ✅ `src-tauri/gen/android/key.properties` - Signing configuration (created)
- ✅ `src-tauri/gen/android/app/build.gradle.kts` - Build script (modified)
- ✅ `src-tauri/gen/android/.gitignore` - Updated to exclude keystore files

## Troubleshooting

If you still encounter issues:

1. **Clean the build**:

   ```bash
   npm run tauri android build -- --clean
   ```

2. **Verify the keystore**:

   ```bash
   keytool -list -v -keystore src-tauri/gen/android/app/upload-keystore.jks -alias upload
   ```

   Password: `android`

3. **Check ADB connection**:
   ```bash
   adb devices
   ```

## Next Steps

Try building and installing your app:

```bash
npm run tauri android build
```

The APK should now install successfully on your Android device! 🎉
