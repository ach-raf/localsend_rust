package com.user.localshare

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Bundle

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
