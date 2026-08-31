package com.musicbox.host

import android.content.Context
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import androidx.core.location.LocationManagerCompat

class HotspotHelper(private val context: Context) {
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private var reservation: WifiManager.LocalOnlyHotspotReservation? = null

    @RequiresApi(Build.VERSION_CODES.O)
    fun start(onResult: (ssid: String?, password: String?, error: String?) -> Unit) {
        if (isEmulator()) {
            onResult(null, null, context.getString(R.string.hotspot_emulator))
            return
        }
        if (!wifi.isWifiEnabled) {
            onResult(null, null, context.getString(R.string.hotspot_enable_wifi))
            return
        }
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        if (!LocationManagerCompat.isLocationEnabled(lm)) {
            onResult(null, null, context.getString(R.string.hotspot_enable_location))
            return
        }
        try {
            wifi.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation) {
                    reservation = res
                    val (ssid, pass) = readConfig(res)
                    onResult(ssid, pass, null)
                }

                override fun onFailed(reason: Int) {
                    onResult(null, null, explainFail(reason))
                }

                override fun onStopped() {
                    reservation = null
                }
            }, Handler(Looper.getMainLooper()))
        } catch (e: SecurityException) {
            onResult(null, null, context.getString(R.string.hotspot_need_permission))
        } catch (e: Exception) {
            onResult(null, null, e.message ?: context.getString(R.string.hotspot_error))
        }
    }

    fun stop() {
        try {
            reservation?.close()
        } catch (_: Exception) {
        }
        reservation = null
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun readConfig(res: WifiManager.LocalOnlyHotspotReservation): Pair<String?, String?> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val cfg = res.softApConfiguration
            @Suppress("DEPRECATION")
            val ssid = cfg.ssid?.trim('"')
            val pass = cfg.passphrase
            return ssid to pass
        }
        @Suppress("DEPRECATION")
        val cfg = res.wifiConfiguration
        return cfg?.SSID?.trim('"') to cfg?.preSharedKey?.trim('"')
    }

    private fun explainFail(reason: Int): String = when (reason) {
        WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE ->
            context.getString(R.string.hotspot_busy)
        WifiManager.LocalOnlyHotspotCallback.ERROR_GENERIC ->
            context.getString(R.string.hotspot_generic)
        WifiManager.LocalOnlyHotspotCallback.ERROR_NO_CHANNEL ->
            context.getString(R.string.hotspot_no_channel)
        WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED ->
            context.getString(R.string.hotspot_tethering)
        else -> context.getString(R.string.hotspot_failed, reason)
    }

    companion object {
        fun isEmulator(): Boolean {
            val fp = Build.FINGERPRINT
            return fp.startsWith("generic") ||
                fp.contains("emulator") ||
                Build.MODEL.contains("sdk", ignoreCase = true) ||
                Build.MODEL.contains("Emulator") ||
                Build.PRODUCT.contains("sdk") ||
                Build.HARDWARE.contains("ranchu") ||
                Build.HARDWARE.contains("goldfish")
        }
    }
}
