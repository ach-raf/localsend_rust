#!/bin/bash
# Generate Android Keystore for Development
# 
# This script generates a development keystore for signing Android APKs.
# For production, use strong passwords and keep the keystore secure!

set -e

KEYSTORE_PATH="src-tauri/gen/android/app/upload-keystore.jks"
KEY_PROPERTIES_PATH="src-tauri/gen/android/key.properties"

echo "🔐 Generating Android Keystore..."
echo ""

# Check if keystore already exists
if [ -f "$KEYSTORE_PATH" ]; then
    echo "⚠️  Keystore already exists at: $KEYSTORE_PATH"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Cancelled."
        exit 1
    fi
    rm -f "$KEYSTORE_PATH"
fi

# Generate keystore
echo "📝 Creating keystore..."
keytool -genkey -v \
    -keystore "$KEYSTORE_PATH" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -alias upload \
    -storepass android \
    -keypass android \
    -dname "CN=Tauri App, OU=Development, O=MyCompany, L=City, S=State, C=US"

echo "✅ Keystore created at: $KEYSTORE_PATH"
echo ""

# Create key.properties if it doesn't exist
if [ ! -f "$KEY_PROPERTIES_PATH" ]; then
    echo "📝 Creating key.properties..."
    cat > "$KEY_PROPERTIES_PATH" << EOF
storePassword=android
keyPassword=android
keyAlias=upload
storeFile=upload-keystore.jks
EOF
    echo "✅ key.properties created at: $KEY_PROPERTIES_PATH"
else
    echo "ℹ️  key.properties already exists at: $KEY_PROPERTIES_PATH"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Summary:"
echo "  - Keystore: $KEYSTORE_PATH"
echo "  - Config: $KEY_PROPERTIES_PATH"
echo "  - Passwords: android / android (development only!)"
echo ""
echo "🚀 Next steps:"
echo "  npm run tauri android build -- --release"
echo ""
echo "⚠️  IMPORTANT: These are development credentials!"
echo "   For production, generate a new keystore with strong passwords."
