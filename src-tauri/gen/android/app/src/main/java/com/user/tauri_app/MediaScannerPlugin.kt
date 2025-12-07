package com.user.tauri_app

import android.app.Activity
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Environment
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import java.io.File

@InvokeArg
class ScanMediaFileArgs {
    var path: String = ""
}

@TauriPlugin
class MediaScannerPlugin(private val activity: Activity) : Plugin(activity) {
    
    @Command
    fun scanMediaFile(invoke: Invoke) {
        val args = invoke.parseArgs(ScanMediaFileArgs::class.java)
        val filePath = args.path
        
        if (filePath.isNotEmpty()) {
            MediaScannerConnection.scanFile(
                activity,
                arrayOf(filePath),
                null
            ) { path, uri ->
                android.util.Log.d("MediaScanner", "Scanned $path -> $uri")
            }
        }
        invoke.resolve()
    }
    
    @Command
    fun getDownloadDirectory(invoke: Invoke): String {
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val result = JSObject()
        result.put("path", downloadsDir.absolutePath)
        invoke.resolve(result)
        return downloadsDir.absolutePath
    }
}
