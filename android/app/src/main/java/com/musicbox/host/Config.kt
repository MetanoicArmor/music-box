package com.musicbox.host

import android.content.ContentValues
import android.content.Context
import android.content.SharedPreferences
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.edit
import java.io.File

data class AppConfig(
    val port: Int = 3000,
    val adminPassword: String = "changeme",
    val kickThreshold: Int = -2,
    val playingKickDislikes: Int = 3,
    val voteRateLimit: Int = 10,
    val voteRateWindowSec: Int = 30,
    val maxUploadMb: Int = 100,
    val maxTrackMinutes: Int = 10,
    var eventMode: Boolean = false,
) {
    fun durationLimitError(durationSec: Int?): String? {
        if (maxTrackMinutes <= 0) return null
        val sec = durationSec ?: return null
        if (sec <= 0) return null
        if (sec > maxTrackMinutes * 60) return "trackTooLong"
        return null
    }
}

class ConfigStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("musicbox", Context.MODE_PRIVATE)

    fun load(): AppConfig = AppConfig(
        port = prefs.getInt("port", 3000),
        adminPassword = prefs.getString("adminPassword", "changeme") ?: "changeme",
        kickThreshold = prefs.getInt("kickThreshold", -2),
        playingKickDislikes = prefs.getInt("playingKickDislikes", 3),
        voteRateLimit = prefs.getInt("voteRateLimit", 10),
        voteRateWindowSec = prefs.getInt("voteRateWindowSec", 30),
        maxUploadMb = prefs.getInt("maxUploadMb", 100),
        maxTrackMinutes = prefs.getInt("maxTrackMinutes", 10),
        eventMode = prefs.getBoolean("eventMode", false),
    )

    fun save(config: AppConfig) {
        prefs.edit {
            putInt("port", config.port)
            putString("adminPassword", config.adminPassword)
            putInt("kickThreshold", config.kickThreshold)
            putInt("playingKickDislikes", config.playingKickDislikes)
            putInt("voteRateLimit", config.voteRateLimit)
            putInt("voteRateWindowSec", config.voteRateWindowSec)
            putInt("maxUploadMb", config.maxUploadMb)
            putInt("maxTrackMinutes", config.maxTrackMinutes)
            putBoolean("eventMode", config.eventMode)
        }
    }
}

class AppPaths(private val context: Context) {
    val root: File = context.filesDir
    val data: File = File(root, "data")
    val db: File = File(data, "music-box.db")
    val tlsP12: File = File(data, "tls.p12")
    val tlsMeta: File = File(data, "tls-meta.json")
    private val legacyMedia: File = File(root, "media")
    @Volatile private var cachedMedia: File? = null

    val media: File
        get() {
            val cached = cachedMedia
            if (cached != null && isPublicPath(cached) && cached.isDirectory) return cached
            val resolved = resolveSharedMediaDir()
            cachedMedia = resolved
            return resolved
        }

    val usbHint: String
        get() = if (isPublicMusicBox) "Music / MusicBox" else media.absolutePath

    val isPublicMusicBox: Boolean
        get() = isPublicPath(media)

    fun ensureDirs() {
        cachedMedia = null
        data.mkdirs()
        media.mkdirs()
        tempDir
        writableMedia
        migrateLegacyMedia()
        notifyDir()
    }

    private fun isPublicPath(dir: File): Boolean =
        dir.absolutePath.replace('\\', '/').contains("/Music/MusicBox")

    fun notifyFile(file: File) {
        MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), null, null)
    }

    val tempDir: File
        get() = File(context.cacheDir, "musicbox-tmp").also { it.mkdirs() }

    val writableMedia: File
        get() {
            val dir = File(
                context.getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: root,
                "MusicBox",
            )
            dir.mkdirs()
            return dir
        }

    fun newTempFile(ext: String = ".bin"): File {
        val suffix = if (ext.startsWith(".")) ext else ".$ext"
        return File(tempDir, "upload-${java.util.UUID.randomUUID()}$suffix")
    }

    /**
     * Puts an audio file into shared Music/MusicBox (USB-visible).
     * Temp/hidden .bin files must never be written there — Android returns EPERM.
     */
    fun publishAudio(source: File, artist: String, title: String, ext: String, deleteSource: Boolean = true): File {
        val suffix = if (ext.startsWith(".")) ext.lowercase() else ".${ext.lowercase()}"
        val mime = MediaNames.mimeForExt(suffix)
        if (Build.VERSION.SDK_INT >= 29) {
            val viaStore = publishViaMediaStore(source, MediaNames.safeMediaName(artist, title) + suffix, mime)
            if (viaStore != null) {
                if (deleteSource) source.delete()
                return viaStore
            }
        }
        val publicDest = MediaNames.uniqueMediaPath(media, artist, title, suffix)
        if (copyIfWritable(source, publicDest)) {
            notifyFile(publicDest)
            if (deleteSource) source.delete()
            return publicDest
        }
        val fallback = MediaNames.uniqueMediaPath(writableMedia, artist, title, suffix)
        MediaNames.moveOrCopy(source, fallback)
        notifyFile(fallback)
        android.util.Log.w("MusicBox", "published to app folder ${fallback.absolutePath}")
        return fallback
    }

    @Suppress("DEPRECATION")
    private fun publishViaMediaStore(source: File, displayName: String, mime: String): File? {
        val collections = mutableListOf(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI)
        if (mime == "audio/webm" || mime == "audio/opus" || mime == "video/webm") {
            collections += MediaStore.Files.getContentUri("external")
        }
        for (collection in collections) {
            val published = insertMedia(collection, source, displayName, mime)
            if (published != null) return published
        }
        return null
    }

    @Suppress("DEPRECATION")
    private fun insertMedia(collection: Uri, source: File, displayName: String, mime: String): File? {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_MUSIC}/MusicBox/")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = try {
            context.contentResolver.insert(collection, values)
        } catch (e: Exception) {
            android.util.Log.w("MusicBox", "MediaStore insert rejected $mime into $collection", e)
            null
        } ?: return null
        return try {
            context.contentResolver.openOutputStream(uri)?.use { out ->
                source.inputStream().use { it.copyTo(out) }
            } ?: throw java.io.IOException("openOutputStream returned null")
            val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            context.contentResolver.update(uri, done, null, null)
            fileFromMediaUri(uri) ?: expectedPublicFile(displayName).takeIf { it.isFile && it.length() > 0 }
        } catch (e: Exception) {
            android.util.Log.w("MusicBox", "MediaStore write failed", e)
            runCatching { context.contentResolver.delete(uri, null, null) }
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun expectedPublicFile(displayName: String): File {
        val musicRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
        return File(File(musicRoot, "MusicBox"), displayName)
    }

    @Suppress("DEPRECATION")
    private fun fileFromMediaUri(uri: Uri): File? {
        val projection = arrayOf(MediaStore.Audio.Media.DATA)
        context.contentResolver.query(uri, projection, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(MediaStore.Audio.Media.DATA)
            if (idx >= 0 && c.moveToFirst()) {
                val path = c.getString(idx)
                if (!path.isNullOrBlank()) {
                    val file = File(path)
                    if (file.isFile) return file
                }
            }
        }
        return null
    }

    private fun copyIfWritable(source: File, dest: File): Boolean = runCatching {
        dest.parentFile?.mkdirs()
        source.copyTo(dest, overwrite = true)
        dest.isFile && dest.length() > 0
    }.getOrDefault(false)

    fun listSharedAudio(): List<File> {
        val found = linkedMapOf<String, File>()
        collectFromDisk(media, found)
        collectFromDisk(writableMedia, found)
        collectFromMediaStore(found)
        return found.values.toList()
    }

    @Suppress("DEPRECATION")
    private fun resolveSharedMediaDir(): File {
        val musicRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
        val publicDir = File(musicRoot, "MusicBox")
        if (publicDir.exists() || publicDir.mkdirs() || publicDir.isDirectory) {
            return publicDir
        }
        val extRoot = context.getExternalFilesDir(Environment.DIRECTORY_MUSIC)
            ?: context.getExternalFilesDir(null)
            ?: File(root, "media")
        val fallback = File(extRoot, "MusicBox")
        fallback.mkdirs()
        android.util.Log.w("MusicBox", "public Music/MusicBox unavailable, using ${fallback.absolutePath}")
        return fallback
    }

    private fun migrateLegacyMedia() {
        if (!legacyMedia.isDirectory || legacyMedia.canonicalPath == media.canonicalPath) return
        legacyMedia.listFiles()?.forEach { file ->
            if (!file.isFile || file.name.startsWith('.')) return@forEach
            val dest = File(media, file.name)
            if (!dest.exists()) {
                val ext = ".${file.extension}"
                if (MediaNames.isAudioExt(ext)) {
                    runCatching { publishAudio(file, "Unknown", file.nameWithoutExtension, ext, deleteSource = false) }
                }
            }
        }
        notifyDir()
    }

    private fun notifyDir() {
        MediaScannerConnection.scanFile(context, arrayOf(media.absolutePath), null, null)
    }

    private fun collectFromDisk(dir: File, into: MutableMap<String, File>) {
        if (!dir.isDirectory) return
        dir.walkTopDown()
            .filter { it.isFile && !it.name.startsWith('.') }
            .filter { MediaNames.isAudioExt("." + it.extension) }
            .forEach { into[it.absolutePath] = it }
    }

    @Suppress("DEPRECATION")
    private fun collectFromMediaStore(into: MutableMap<String, File>) {
        val prefix = media.absolutePath.trimEnd('/', '\\')
        val projection = arrayOf(MediaStore.Audio.Media.DATA)
        val (selection, args) = if (Build.VERSION.SDK_INT >= 29) {
            "${MediaStore.Audio.Media.DATA} LIKE ? OR ${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ?" to
                arrayOf("$prefix%", "%MusicBox%")
        } else {
            "${MediaStore.Audio.Media.DATA} LIKE ?" to arrayOf("$prefix%")
        }
        try {
            context.contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                args,
                null,
            )?.use { c ->
                val idx = c.getColumnIndex(MediaStore.Audio.Media.DATA)
                if (idx < 0) return
                while (c.moveToNext()) {
                    val path = c.getString(idx) ?: continue
                    val file = File(path)
                    if (file.isFile && MediaNames.isAudioExt("." + file.extension)) {
                        into[file.absolutePath] = file
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("MusicBox", "MediaStore scan failed", e)
        }
    }
}
