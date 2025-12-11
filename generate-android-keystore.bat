@echo off
REM Generate Android Keystore for Development (Windows)
REM 
REM This script generates a development keystore for signing Android APKs.
REM For production, use strong passwords and keep the keystore secure!

setlocal enabledelayedexpansion

set KEYSTORE_PATH=src-tauri\gen\android\app\upload-keystore.jks
set KEY_PROPERTIES_PATH=src-tauri\gen\android\key.properties

echo.
echo 🔐 Generating Android Keystore...
echo.

REM Check if keystore already exists
if exist "%KEYSTORE_PATH%" (
    echo ⚠️  Keystore already exists at: %KEYSTORE_PATH%
    set /p "OVERWRITE=Do you want to overwrite it? (y/N): "
    if /i not "!OVERWRITE!"=="y" (
        echo ❌ Cancelled.
        exit /b 1
    )
    del "%KEYSTORE_PATH%"
)

REM Generate keystore
echo 📝 Creating keystore...
keytool -genkey -v -keystore "%KEYSTORE_PATH%" -keyalg RSA -keysize 2048 -validity 10000 -alias upload -storepass android -keypass android -dname "CN=Tauri App, OU=Development, O=MyCompany, L=City, S=State, C=US"

echo ✅ Keystore created at: %KEYSTORE_PATH%
echo.

REM Create key.properties if it doesn't exist
if not exist "%KEY_PROPERTIES_PATH%" (
    echo 📝 Creating key.properties...
    (
        echo storePassword=android
        echo keyPassword=android
        echo keyAlias=upload
        echo storeFile=upload-keystore.jks
    ) > "%KEY_PROPERTIES_PATH%"
    echo ✅ key.properties created at: %KEY_PROPERTIES_PATH%
) else (
    echo ℹ️  key.properties already exists at: %KEY_PROPERTIES_PATH%
)

echo.
echo 🎉 Setup complete!
echo.
echo 📋 Summary:
echo   - Keystore: %KEYSTORE_PATH%
echo   - Config: %KEY_PROPERTIES_PATH%
echo   - Passwords: android / android (development only!)
echo.
echo 🚀 Next steps:
echo   npm run tauri android build -- --release
echo.
echo ⚠️  IMPORTANT: These are development credentials!
echo    For production, generate a new keystore with strong passwords.
echo.

endlocal
