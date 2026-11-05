package com.user.localshare

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView

class MainActivity : TauriActivity() {
    // Held for the lifetime of the activity so the OS keeps delivering mDNS
    // multicast packets (224.0.0.251:5353) to us. Without this lock, Android's
    // Wi-Fi driver filters multicast traffic and device discovery silently fails
    // (peers only appear after a manual refresh, if at all). The field keeps a
    // strong reference so the lock is not GC'd/released while the app runs.
    private var multicastLock: WifiManager.MulticastLock? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        acquireMulticastLock()
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        webView.addJavascriptInterface(NativeBridge(), "LocalShareNative")
    }

    /**
     * Opens a received file the way other file apps do: plain ACTION_VIEW with
     * a read grant and a reliable MIME type, so Android shows its own "Open
     * with" dialog or the user's default app. Returns "" on success, else an
     * error message for the UI.
     */
    inner class NativeBridge {
        private fun isGeneric(m: String?) =
            m == null || m == "*/*" || m == "application/octet-stream"

        private fun resolveMime(uri: Uri, name: String?): String {
            var mime = contentResolver.getType(uri)
            if (isGeneric(mime)) {
                val ext = name?.substringAfterLast('.', "")?.lowercase().orEmpty()
                if (ext.isNotEmpty()) {
                    android.webkit.MimeTypeMap.getSingleton()
                        .getMimeTypeFromExtension(ext)?.let { mime = it }
                }
            }
            return mime ?: "*/*"
        }

        private fun viewIntent(uri: Uri, mime: String) =
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                clipData = android.content.ClipData.newRawUri("", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

        @JavascriptInterface
        fun openFile(uriString: String): String {
            return try {
                val uri = Uri.parse(uriString)
                val name = contentResolver.query(
                    uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null
                )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
                val mime = resolveMime(uri, name)

                // Special case: installing APKs needs the "install unknown apps"
                // permission for this app, otherwise the installer does nothing.
                if (mime == "application/vnd.android.package-archive" &&
                    !packageManager.canRequestPackageInstalls()
                ) {
                    startActivity(
                        Intent(
                            android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:$packageName")
                        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                    return "Allow \"Install unknown apps\" for Local Share, then tap Open File again"
                }

                try {
                    startActivity(viewIntent(uri, mime))
                } catch (e: ActivityNotFoundException) {
                    // Nothing handles this exact type: let the user pick any app.
                    try {
                        startActivity(
                            Intent.createChooser(viewIntent(uri, "*/*"), "Open with")
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    } catch (e2: ActivityNotFoundException) {
                        return "No app installed can open this file ($mime)"
                    }
                }
                ""
            } catch (e: Exception) {
                e.message ?: e.toString()
            }
        }
    }

    private fun acquireMulticastLock() {
        val wifiManager =
            applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                ?: run {
                    android.util.Log.w("MainActivity", "WifiManager unavailable; mDNS discovery may fail")
                    return
                }
        val lock = wifiManager.createMulticastLock("localsend_mdns").apply {
            // We manage this as a single app-lifetime lock, not per acquire/release
            // pair, so reference counting would only get in the way.
            setReferenceCounted(false)
            acquire()
        }
        multicastLock = lock
        android.util.Log.i("MainActivity", "MulticastLock acquired for mDNS discovery")
    }
}
