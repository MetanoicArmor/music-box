package com.musicbox.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import androidx.media3.ui.PlayerNotificationManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class HostService : LifecycleService() {
    private var playerNotifications: PlayerNotificationManager? = null

    override fun attachBaseContext(base: android.content.Context) {
        super.attachBaseContext(HostLocale.wrap(base))
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        startForegroundCompat(placeholderNotification(getString(R.string.notification_starting)))
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val app = application as MusicBoxApp
                if (!app.runtime.ui.value.running) {
                    app.runtime.startBlocking()
                }
                withContext(Dispatchers.Main) {
                    attachPlayerNotification(app.runtime)
                    startForegroundCompat(placeholderNotification(app.runtime.ui.value.publicUrl.ifBlank { getString(R.string.host_running) }))
                }
            } catch (e: Exception) {
                android.util.Log.e("MusicBox", "host start failed", e)
                (application as MusicBoxApp).runtime.reportError(e.message ?: e.toString())
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        playerNotifications?.setPlayer(null)
        playerNotifications = null
        try {
            (application as MusicBoxApp).runtime.stopBlocking()
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    private fun attachPlayerNotification(runtime: HostRuntime) {
        val player = runtime.player ?: return
        val manager = PlayerNotificationManager.Builder(this, NOTIFICATION_ID, CHANNEL_ID)
            .setMediaDescriptionAdapter(object : PlayerNotificationManager.MediaDescriptionAdapter {
                override fun getCurrentContentTitle(player: androidx.media3.common.Player): CharSequence {
                    val t = runtime.queue?.getCurrentTrack()
                    return t?.title ?: getString(R.string.host_running)
                }

                override fun createCurrentContentIntent(player: androidx.media3.common.Player): PendingIntent? {
                    val intent = Intent(this@HostService, MainActivity::class.java)
                    return PendingIntent.getActivity(
                        this@HostService, 0, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                }

                override fun getCurrentContentText(player: androidx.media3.common.Player): CharSequence? {
                    return runtime.queue?.getCurrentTrack()?.artist
                }

                override fun getCurrentLargeIcon(
                    player: androidx.media3.common.Player,
                    callback: PlayerNotificationManager.BitmapCallback,
                ) = null
            })
            .setNotificationListener(object : PlayerNotificationManager.NotificationListener {
                override fun onNotificationPosted(notificationId: Int, notification: Notification, ongoing: Boolean) {
                    if (ongoing) startForegroundCompat(notification)
                }
            })
            .build()
        manager.setPlayer(player.exo)
        manager.setUseNextAction(true)
        manager.setUsePreviousAction(true)
        manager.setUseRewindAction(false)
        manager.setUseFastForwardAction(false)
        playerNotifications = manager
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun placeholderNotification(text: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun createChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW),
        )
    }

    companion object {
        const val CHANNEL_ID = "musicbox_playback"
        const val NOTIFICATION_ID = 42
    }
}
