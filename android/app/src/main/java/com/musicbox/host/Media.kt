package com.musicbox.host

import android.content.Context
import android.media.MediaMetadataRetriever
import java.io.File
import java.util.Locale

object MediaNames {
    val AUDIO_EXT = setOf(
        ".mp3", ".mp4", ".m4a", ".aac", ".ogg", ".oga", ".wav", ".flac",
        ".webm", ".opus", ".m4b", ".wma", ".aiff", ".aif", ".ape", ".wv", ".mpga",
    )

    fun isAudioExt(ext: String): Boolean = AUDIO_EXT.contains(ext.lowercase(Locale.US))

    fun safeMediaName(artist: String, title: String): String {
        val raw = "${artist.trim()} - ${title.trim()}".trim().ifBlank { "track" }
        var name = raw.replace(Regex("""[\\/:*?"<>|]"""), " ").replace(Regex("\\s+"), " ").trim()
        name = name.replace(Regex("[. ]+$"), "")
        if (name.length > 80) name = name.take(80).trim().replace(Regex("[. ]+$"), "")
        return name.ifBlank { "track" }
    }

    fun uniqueMediaStem(mediaDir: File, stem: String): String {
        if (!stemTaken(mediaDir, stem)) return stem
        for (n in 2 until 1000) {
            val candidate = "$stem ($n)"
            if (!stemTaken(mediaDir, candidate)) return candidate
        }
        return "$stem (${System.currentTimeMillis()})"
    }

    fun uniqueMediaPath(mediaDir: File, artist: String, title: String, ext: String): File {
        val stem = uniqueMediaStem(mediaDir, safeMediaName(artist, title))
        val suffix = if (ext.startsWith(".")) ext.lowercase(Locale.US) else ".${ext.lowercase(Locale.US)}"
        return File(mediaDir, "$stem$suffix")
    }

    fun findOutputFile(mediaDir: File, stem: String): File? {
        for (ext in AUDIO_EXT) {
            val f = File(mediaDir, "$stem$ext")
            if (f.isFile && f.length() > 0) return f
        }
        return null
    }

    private fun stemTaken(mediaDir: File, stem: String): Boolean =
        AUDIO_EXT.any { File(mediaDir, stem + it).exists() }

    fun extFromFileName(name: String): String? {
        val ext = "." + name.substringAfterLast('.', "").lowercase(Locale.US)
        return ext.takeIf { it.length > 1 && isAudioExt(it) }
    }

    fun extFromMime(mime: String?): String? {
        val type = mime?.substringBefore(';')?.trim()?.lowercase(Locale.US) ?: return null
        return when {
            type == "audio/mpeg" || type == "audio/mp3" -> ".mp3"
            type == "audio/mp4" || type == "audio/x-m4a" || type == "audio/aac" -> ".m4a"
            type == "audio/wav" || type == "audio/x-wav" || type == "audio/wave" -> ".wav"
            type == "audio/flac" || type == "audio/x-flac" -> ".flac"
            type == "audio/ogg" || type == "application/ogg" || type == "audio/vorbis" -> ".ogg"
            type == "audio/webm" || type == "video/webm" -> ".webm"
            type == "audio/opus" -> ".opus"
            type == "video/mp4" -> ".mp4"
            type == "audio/x-ms-wma" -> ".wma"
            type == "audio/aiff" || type == "audio/x-aiff" -> ".aiff"
            else -> null
        }
    }

    fun sniffAudioExt(file: File): String? {
        val buf = ByteArray(16)
        val n = file.inputStream().use { it.read(buf) }
        if (n < 4) return null
        fun at(i: Int) = buf[i].toInt() and 0xFF
        fun ascii(start: Int, len: Int) = buf.copyOfRange(start, start + len).toString(Charsets.US_ASCII)
        return when {
            ascii(0, 3) == "ID3" -> ".mp3"
            at(0) == 0xFF && at(1) and 0xE0 == 0xE0 -> ".mp3"
            ascii(0, 4) == "fLaC" -> ".flac"
            ascii(0, 4) == "OggS" -> ".ogg"
            ascii(0, 4) == "RIFF" && n >= 12 && ascii(8, 4) == "WAVE" -> ".wav"
            n >= 8 && ascii(4, 4) == "ftyp" -> ".m4a"
            at(0) == 0x1A && at(1) == 0x45 && at(2) == 0xDF && at(3) == 0xA3 -> ".webm"
            else -> null
        }
    }

    fun resolveAudioExt(fileName: String, mime: String?, file: File): String? =
        extFromFileName(fileName) ?: extFromMime(mime) ?: sniffAudioExt(file)

    fun mimeForExt(ext: String): String {
        val e = if (ext.startsWith(".")) ext.lowercase(Locale.US) else ".${ext.lowercase(Locale.US)}"
        return when (e) {
            ".mp3", ".mpga" -> "audio/mpeg"
            ".m4a", ".m4b", ".aac" -> "audio/mp4"
            ".mp4" -> "audio/mp4"
            ".wav" -> "audio/wav"
            ".flac" -> "audio/flac"
            ".ogg", ".oga" -> "audio/ogg"
            ".webm" -> "audio/webm"
            ".opus" -> "audio/opus"
            ".wma" -> "audio/x-ms-wma"
            ".aiff", ".aif" -> "audio/aiff"
            else -> "audio/mpeg"
        }
    }

    fun moveOrCopy(from: File, to: File) {
        if (from.absolutePath == to.absolutePath) return
        if (from.renameTo(to) && to.isFile) return
        from.copyTo(to, overwrite = true)
        from.delete()
        if (!to.isFile || to.length() == 0L) {
            error("Failed to move upload to ${to.path}")
        }
    }
}

object Tags {
    fun readFileTags(file: File, originalName: String? = null): FileTags {
        val filename = (originalName ?: file.name).substringBeforeLast('.')
        var title = ""
        var artist = ""
        var album = ""
        var durationSec: Int? = null
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(file.absolutePath)
            title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)?.trim().orEmpty()
            artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)?.trim().orEmpty()
                .ifBlank { retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)?.trim().orEmpty() }
            album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)?.trim().orEmpty()
            val dur = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            if (dur != null && dur > 0) durationSec = (dur / 1000L).toInt()
        } catch (_: Exception) {
        } finally {
            try { retriever.release() } catch (_: Exception) {}
        }
        return FileTags(
            title = title.ifBlank { filename }.ifBlank { "Unknown" },
            artist = artist.ifBlank { "Unknown" },
            album = album,
            filename = filename,
            durationSec = durationSec,
        )
    }
}

class MediaIndex(private val database: AppDatabase, private val paths: AppPaths) {
    fun upsert(row: MediaIndexRow) = database.withLock {
        execSQL(
            """
            INSERT INTO media_index (file_path, title, artist, album, filename, mtime, duration_sec)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
              title = excluded.title,
              artist = excluded.artist,
              album = excluded.album,
              filename = excluded.filename,
              mtime = excluded.mtime,
              duration_sec = excluded.duration_sec
            """.trimIndent(),
            arrayOf(row.filePath, row.title, row.artist, row.album, row.filename, row.mtime, row.durationSec),
        )
    }

    fun search(query: String, limit: Int = 8): List<MediaIndexRow> {
        if (query.trim().length < 2) return emptyList()
        return database.withLock {
            rawQuery(
                """
                SELECT file_path, title, artist, album, filename, mtime, duration_sec
                FROM media_index
                ORDER BY mtime DESC
                """.trimIndent(),
                null,
            ).use { c ->
                buildList {
                    while (c.moveToNext()) {
                        val row = c.toMediaRow()
                        if (AppDatabase.matchesFold(query, row.title, row.artist, row.album, row.filename)) {
                            add(row)
                            if (size >= limit) break
                        }
                    }
                }
            }
        }
    }

    fun list(query: String = "", limit: Int = 200): List<MediaIndexRow> {
        if (query.trim().length >= 2) return search(query, limit)
        return database.withLock {
            rawQuery(
                """
                SELECT file_path, title, artist, album, filename, mtime, duration_sec
                FROM media_index
                ORDER BY artist ASC, album ASC, title ASC
                LIMIT ?
                """.trimIndent(),
                arrayOf(limit.toString()),
            ).use { it.toMediaList() }
        }
    }

    fun indexFile(file: File, originalName: String? = null): MediaIndexRow? {
        if (!file.isFile) return null
        val tags = Tags.readFileTags(file, originalName)
        val row = MediaIndexRow(
            filePath = file.absolutePath,
            title = tags.title,
            artist = tags.artist,
            album = tags.album,
            filename = originalName?.substringBeforeLast('.') ?: tags.filename,
            mtime = file.lastModified().toDouble(),
            durationSec = tags.durationSec,
        )
        upsert(row)
        return row
    }

    fun scan() {
        paths.notifyFile(paths.media)
        val files = paths.listSharedAudio()
        val existing = database.withLock {
            rawQuery("SELECT file_path, mtime, duration_sec FROM media_index", null).use { c ->
                buildMap {
                    while (c.moveToNext()) {
                        put(File(c.str("file_path")).absolutePath, Triple(c.str("file_path"), c.doubleVal("mtime"), c.intOrNull("duration_sec")))
                    }
                }
            }
        }
        val keep = mutableSetOf<String>()
        for (file in files) {
            val resolved = file.absolutePath
            keep += resolved
            val prev = existing[resolved]
            if (prev != null && kotlin.math.abs(prev.second - file.lastModified().toDouble()) < 1 && (prev.third ?: 0) > 0) {
                continue
            }
            try {
                indexFile(file)
            } catch (_: Exception) {
            }
        }
        val stale = existing.filterKeys { it !in keep }
        if (stale.isNotEmpty()) {
            database.withLock {
                for ((_, row) in stale) {
                    execSQL("DELETE FROM media_index WHERE file_path = ?", arrayOf(row.first))
                }
            }
        }
    }
}

private fun android.database.Cursor.toMediaRow(): MediaIndexRow = MediaIndexRow(
    filePath = str("file_path"),
    title = str("title"),
    artist = str("artist"),
    album = str("album"),
    filename = str("filename"),
    mtime = doubleVal("mtime"),
    durationSec = intOrNull("duration_sec"),
)

private fun android.database.Cursor.toMediaList(): List<MediaIndexRow> = buildList {
    while (moveToNext()) add(toMediaRow())
}

fun Context.app() = applicationContext as MusicBoxApp
