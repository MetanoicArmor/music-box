package com.musicbox.host

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        (application as MusicBoxApp).runtime.refreshMediaFolder()
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val uris = pickerUris(result.resultCode, result.data)
        filePathCallback?.onReceiveValue(uris)
        filePathCallback = null
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(HostLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestRuntimePermissions()
        val runtime = (application as MusicBoxApp).runtime
        setContent {
            val state by runtime.ui.collectAsState()
            MusicBoxTheme {
                HostApp(
                    state = state,
                    runtime = runtime,
                    onStart = {
                        ContextCompat.startForegroundService(
                            this,
                            Intent(this, HostService::class.java),
                        )
                    },
                    onStop = {
                        stopService(Intent(this, HostService::class.java))
                    },
                    onOpenSystemHotspot = {
                        val intents = listOf(
                            Intent("com.android.settings.WIFI_TETHER_SETTINGS"),
                            Intent(Settings.ACTION_WIRELESS_SETTINGS),
                            Intent(Settings.ACTION_WIFI_SETTINGS),
                        )
                        for (intent in intents) {
                            try {
                                startActivity(intent)
                                break
                            } catch (_: Exception) {
                            }
                        }
                    },
                )
            }
        }
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        super.onDestroy()
    }

    fun launchFileChooser(
        callback: ValueCallback<Array<Uri>>?,
        params: WebChromeClient.FileChooserParams?,
    ): Boolean {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = callback
        if (callback == null) return false
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "video/*", "*/*"))
            putExtra(
                Intent.EXTRA_ALLOW_MULTIPLE,
                params?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE,
            )
        }
        return try {
            fileChooserLauncher.launch(Intent.createChooser(intent, getString(R.string.app_name)))
            true
        } catch (e: Exception) {
            android.util.Log.e("MusicBox", "file chooser failed", e)
            filePathCallback = null
            callback.onReceiveValue(null)
            false
        }
    }

    private fun requestRuntimePermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 33) {
            needed += Manifest.permission.POST_NOTIFICATIONS
            needed += Manifest.permission.NEARBY_WIFI_DEVICES
            needed += Manifest.permission.READ_MEDIA_AUDIO
        } else {
            needed += Manifest.permission.READ_EXTERNAL_STORAGE
            needed += Manifest.permission.WRITE_EXTERNAL_STORAGE
        }
        needed += Manifest.permission.ACCESS_FINE_LOCATION
        needed += Manifest.permission.ACCESS_COARSE_LOCATION
        permissionLauncher.launch(needed.toTypedArray())
    }

    private fun pickerUris(resultCode: Int, data: Intent?): Array<Uri>? {
        WebChromeClient.FileChooserParams.parseResult(resultCode, data)?.let { return it }
        if (resultCode != RESULT_OK || data == null) return null
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) {
            return Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
        }
        return data.data?.let { arrayOf(it) }
    }
}

fun createGuestWebView(activity: ComponentActivity, url: String): WebView {
    CookieManager.getInstance().setAcceptCookie(true)
    return WebView(activity).apply {
        isFocusable = true
        isFocusableInTouchMode = true
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.defaultTextEncodingName = "utf-8"
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                val host = activity as? MainActivity ?: return false
                return host.launchFileChooser(filePathCallback, fileChooserParams)
            }
        }
        webViewClient = object : WebViewClient() {
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                handler?.proceed()
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false
        }
        if (url.isNotBlank()) loadUrl(url)
    }
}
