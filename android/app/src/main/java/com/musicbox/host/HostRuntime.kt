package com.musicbox.host

import android.app.Application
import android.content.Context
import android.os.PowerManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class HostUiState(
    val running: Boolean = false,
    val publicUrl: String = "",
    val lanIp: String = "",
    val port: Int = 3000,
    val https: Boolean = true,
    val currentTitle: String = "",
    val currentArtist: String = "",
    val error: String? = null,
    val hotspotSsid: String? = null,
    val hotspotPassword: String? = null,
    val adminPassword: String = "changeme",
    val mediaFolder: String = "",
    val mediaFolderUsb: String = "Music / MusicBox",
)

class HostRuntime(private val app: Application) {
    private val job = SupervisorJob()
    val scope = CoroutineScope(job + Dispatchers.IO)
    val configStore = ConfigStore(app)
    val paths = AppPaths(app)
    val hotspot = HotspotHelper(app)

    private val _ui = MutableStateFlow(
        HostUiState(
            adminPassword = configStore.load().adminPassword,
            port = configStore.load().port,
            mediaFolder = paths.media.absolutePath,
            mediaFolderUsb = paths.usbHint,
        ),
    )
    val ui: StateFlow<HostUiState> = _ui.asStateFlow()

    lateinit var config: AppConfig
        private set
    private var database: AppDatabase? = null
    var queue: QueueRepository? = null
        private set
    var player: PlaybackController? = null
        private set
    private var mediaIndex: MediaIndex? = null
    private var downloader: TrackDownloader? = null
    private var server: MusicBoxServer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null

    @Synchronized
    fun startBlocking() {
        if (_ui.value.running) return
        config = configStore.load()
        paths.ensureDirs()
        val db = AppDatabase(app, paths)
        database = db
        var broadcaster: () -> Unit = {}
        val q = QueueRepository(db, { config }, { broadcaster() }) { player?.isPlaybackActive() == true }
        queue = q
        val (cleared, stopped) = q.resetToEmptySession()
        android.util.Log.i("MusicBox", "fresh start queue=$cleared stopped=$stopped")
        val index = MediaIndex(db, paths)
        mediaIndex = index
        index.scan()
        val p = kotlinx.coroutines.runBlocking(Dispatchers.Main) {
            PlaybackController(app, q, scope)
        }
        player = p
        val dl = TrackDownloader(q, paths, index, { config }) { p.startPlaybackIfIdle() }
        downloader = dl
        val srv = MusicBoxServer(
            context = app,
            config = config,
            queue = q,
            player = p,
            mediaIndex = index,
            paths = paths,
            downloader = dl,
            setEventMode = { enabled ->
                config.eventMode = enabled
                configStore.save(config)
            },
        )
        server = srv
        broadcaster = {
            srv.broadcastState()
            refreshNowPlaying()
        }
        srv.start()
        dl.kick()
        acquireLocks()
        val lanIp = getLanIp()
        val https = srv.httpsEnabled
        val publicUrl = if (https) getPublicUrl(config.port, lanIp) else "http://$lanIp:${config.port}"
        android.util.Log.i("MusicBox", "media folder ${paths.media.absolutePath}")
        _ui.value = _ui.value.copy(
            running = true,
            publicUrl = publicUrl,
            lanIp = lanIp,
            port = config.port,
            https = https,
            adminPassword = config.adminPassword,
            mediaFolder = paths.media.absolutePath,
            mediaFolderUsb = paths.usbHint,
            error = null,
        )
        refreshNowPlaying()
    }

    @Synchronized
    fun stopBlocking() {
        try { server?.stop() } catch (_: Exception) {}
        try {
            val p = player
            if (p != null) kotlinx.coroutines.runBlocking(Dispatchers.Main) { p.release() }
        } catch (_: Exception) {}
        try { database?.close() } catch (_: Exception) {}
        hotspot.stop()
        releaseLocks()
        server = null
        player = null
        queue = null
        downloader = null
        mediaIndex = null
        database = null
        _ui.value = _ui.value.copy(
            running = false,
            publicUrl = "",
            currentTitle = "",
            currentArtist = "",
            hotspotSsid = null,
            hotspotPassword = null,
        )
    }

    fun refreshMediaFolder() {
        paths.ensureDirs()
        _ui.value = _ui.value.copy(
            mediaFolder = paths.media.absolutePath,
            mediaFolderUsb = paths.usbHint,
        )
    }

    fun reportError(message: String) {
        _ui.value = _ui.value.copy(running = false, error = message)
    }

    fun saveConfig(next: AppConfig) {
        config = next
        configStore.save(next)
        _ui.value = _ui.value.copy(port = next.port, adminPassword = next.adminPassword)
    }

    fun startHotspot() {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) {
            _ui.value = _ui.value.copy(error = app.getString(R.string.hotspot_need_android8))
            return
        }
        hotspot.start { ssid, pass, err ->
            _ui.value = _ui.value.copy(hotspotSsid = ssid, hotspotPassword = pass, error = err)
            if (ssid != null) {
                val lanIp = getLanIp()
                val https = _ui.value.https
                _ui.value = _ui.value.copy(
                    lanIp = lanIp,
                    publicUrl = if (https) getPublicUrl(_ui.value.port, lanIp) else "http://$lanIp:${_ui.value.port}",
                )
            }
        }
    }

    private fun refreshNowPlaying() {
        val current = queue?.getCurrentTrack()
        _ui.value = _ui.value.copy(
            currentTitle = current?.title.orEmpty(),
            currentArtist = current?.artist.orEmpty(),
        )
    }

    private fun acquireLocks() {
        val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "musicbox:host").apply {
            setReferenceCounted(false)
            acquire()
        }
        val wm = app.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
        @Suppress("DEPRECATION")
        wifiLock = wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "musicbox:wifi").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseLocks() {
        try { wakeLock?.release() } catch (_: Exception) {}
        try { wifiLock?.release() } catch (_: Exception) {}
        wakeLock = null
        wifiLock = null
    }

    fun shutdown() {
        stopBlocking()
        scope.cancel()
    }
}

class MusicBoxApp : Application() {
    lateinit var runtime: HostRuntime
        private set

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(HostLocale.wrap(base))
    }

    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            val httpsCio = error is UnsupportedOperationException &&
                (error.message?.contains("CIO Engine") == true || error.message?.contains("HTTPS") == true)
            if (httpsCio) {
                android.util.Log.e("MusicBox", "ignored CIO HTTPS crash", error)
                return@setDefaultUncaughtExceptionHandler
            }
            previous?.uncaughtException(thread, error)
        }
        runtime = HostRuntime(this)
        runtime.refreshMediaFolder()
        Youtube.init()
    }
}
