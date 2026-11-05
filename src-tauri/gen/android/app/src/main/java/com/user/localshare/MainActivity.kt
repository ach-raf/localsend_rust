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
     * Opens a received file with a plain ACTION_VIEW so Android shows its own
     * "Open with" dialog / the user's default app, instead of the plugin's
     * Intent.createChooser sheet. Returns "" on success, else an error message.
     */
    inner class NativeBridge {
        @JavascriptInterface
        fun openFile(uriString: String): String {
            return try {
                val uri = Uri.parse(uriString)
                val mime = contentResolver.getType(uri) ?: "*/*"
                val view = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mime)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                try {
                    startActivity(view)
                } catch (e: ActivityNotFoundException) {
                    return "No app installed that can open this file ($mime)"
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
