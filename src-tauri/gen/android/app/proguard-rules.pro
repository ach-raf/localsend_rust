# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# The notification plugin uses Jackson/reflection for its Android command models.
-keep class app.tauri.notification.** { *; }

# The share-target plugin returns these models through Tauri's Jackson bridge.
# Preserve their field names so release builds expose the same JSON as debug builds.
-keep class com.achraf.androidsharetarget.PendingSharesResponse { *; }
-keep class com.achraf.androidsharetarget.NativeIncomingShare { *; }
-keep class com.achraf.androidsharetarget.NativeSharedFile { *; }
