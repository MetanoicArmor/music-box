package com.musicbox.host

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import java.io.File

class QueueRepository(
    private val database: AppDatabase,
    private val config: () -> AppConfig,
    private val onState: () -> Unit,
    private val isPlaying: () -> Boolean = { false },
) {
    private val db get() = database.db

    private fun <T> tx(block: SQLiteDatabase.() -> T): T = database.withLock(block)

    fun getOrCreateSession(sessionId: String?, ip: String): SessionInfo = tx {
        val now = System.currentTimeMillis()
        if (!sessionId.isNullOrBlank()) {
            rawQuery("SELECT id, color, emoji, banned FROM sessions WHERE id = ?", arrayOf(sessionId)).use { c ->
                if (c.moveToFirst()) {
                    execSQL("UPDATE sessions SET last_seen = ?, ip = ? WHERE id = ?", arrayOf(now, ip, sessionId))
                    return@tx SessionInfo(c.str("id"), c.str("color"), c.intVal("banned") == 1, ensureEmojiLocked(c.str("id"), c.strOrNull("emoji")))
                }
            }
        }
        val cutoff = (now - 5 * 60 * 1000).toString()
        rawQuery(
            "SELECT id, color, emoji, banned FROM sessions WHERE ip = ? AND banned = 0 AND last_seen > ? ORDER BY last_seen DESC LIMIT 1",
            arrayOf(ip, cutoff),
        ).use { c ->
            if (c.moveToFirst()) {
                val id = c.str("id")
                execSQL("UPDATE sessions SET last_seen = ? WHERE id = ?", arrayOf(now, id))
                return@tx SessionInfo(id, c.str("color"), c.intVal("banned") == 1, ensureEmojiLocked(id, c.strOrNull("emoji")))
            }
        }
        val id = AppDatabase.newId()
        val color = AppDatabase.SESSION_COLORS.random()
        val emoji = SessionEmoji.pickFree(takenEmojisLocked()) ?: SessionEmoji.POOL.first()
        val values = ContentValues().apply {
            put("id", id)
            put("ip", ip)
            put("color", color)
            put("emoji", emoji)
            put("banned", 0)
            put("last_seen", now)
        }
        insertOrThrow("sessions", null, values)
        SessionInfo(id, color, false, emoji)
    }

    private fun SQLiteDatabase.takenEmojisLocked(exceptId: String? = null): Set<String> {
        val cutoff = SessionEmoji.recentCutoff().toString()
        val sql = if (exceptId != null) {
            "SELECT emoji FROM sessions WHERE emoji IS NOT NULL AND emoji != '' AND last_seen > ? AND id != ?"
        } else {
            "SELECT emoji FROM sessions WHERE emoji IS NOT NULL AND emoji != '' AND last_seen > ?"
        }
        val args = if (exceptId != null) arrayOf(cutoff, exceptId) else arrayOf(cutoff)
        return rawQuery(sql, args).use { c ->
            buildSet {
                while (c.moveToNext()) add(c.str("emoji"))
            }
        }
    }

    private fun SQLiteDatabase.ensureEmojiLocked(id: String, current: String?): String {
        if (!current.isNullOrBlank()) return current
        val emoji = SessionEmoji.pickFree(takenEmojisLocked(id)) ?: SessionEmoji.POOL.first()
        update("sessions", ContentValues().apply { put("emoji", emoji) }, "id = ?", arrayOf(id))
        return emoji
    }

    fun getSessionEmoji(sessionId: String?): String? {
        if (sessionId.isNullOrBlank()) return null
        return tx {
            rawQuery("SELECT emoji FROM sessions WHERE id = ?", arrayOf(sessionId)).use { c ->
                if (!c.moveToFirst()) return@tx null
                ensureEmojiLocked(sessionId, c.strOrNull("emoji"))
            }
        }
    }

    fun cycleSessionEmoji(sessionId: String): String = tx {
        val current = rawQuery("SELECT emoji FROM sessions WHERE id = ?", arrayOf(sessionId)).use { c ->
            if (!c.moveToFirst()) throw HttpException(404, "sessionNotFound")
            c.strOrNull("emoji")
        }
        val next = SessionEmoji.nextFree(current, takenEmojisLocked(sessionId))
            ?: throw HttpException(409, SessionEmoji.TAKEN)
        update("sessions", ContentValues().apply { put("emoji", next) }, "id = ?", arrayOf(sessionId))
        next
    }

    fun isIpBanned(ip: String): Boolean = tx {
        rawQuery("SELECT COUNT(*) as c FROM sessions WHERE ip = ? AND banned = 1", arrayOf(ip)).use { c ->
            c.moveToFirst() && c.getInt(0) > 0
        }
    }

    fun checkVoteRateLimit(sessionId: String): Boolean = tx {
        val cfg = config()
        val cutoff = (System.currentTimeMillis() - cfg.voteRateWindowSec * 1000L).toString()
        rawQuery(
            "SELECT COUNT(*) as c FROM votes WHERE session_id = ? AND created_at > ?",
            arrayOf(sessionId, cutoff),
        ).use { c ->
            c.moveToFirst()
            c.getInt(0) < cfg.voteRateLimit
        }
    }

    fun addTrack(
        title: String,
        artist: String?,
        source: String,
        sourceRef: String?,
        filePath: String?,
        sessionId: String,
        durationSec: Int? = null,
    ): TrackRow = tx {
        val id = AppDatabase.newId()
        val now = System.currentTimeMillis()
        val art = artist?.ifBlank { null } ?: "Unknown"
        val duration = durationSec ?: durationFromMedia(filePath)
        val downloadStatus = when {
            !filePath.isNullOrBlank() -> "ready"
            source == "local" -> "ready"
            else -> "pending"
        }
        execSQL(
            """
            INSERT INTO tracks (id, title, artist, source, source_ref, file_path, added_by_session, vote_score, status, created_at, download_status, duration_sec)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'queued', ?, ?, ?)
            """.trimIndent(),
            arrayOf(id, title, art, source, sourceRef, filePath, sessionId, now, downloadStatus, duration),
        )
        getTrackByIdLocked(id)!!
    }

    fun mediaDuration(filePath: String?): Int? = tx { durationFromMedia(filePath) }

    private fun SQLiteDatabase.durationFromMedia(filePath: String?): Int? {
        if (filePath.isNullOrBlank()) return null
        val resolved = File(filePath).absolutePath
        rawQuery(
            "SELECT duration_sec FROM media_index WHERE file_path = ? OR file_path = ?",
            arrayOf(filePath, resolved),
        ).use { c ->
            if (c.moveToFirst() && !c.isNull(0)) return c.getInt(0)
        }
        return null
    }

    fun getTrackById(id: String): TrackRow? = tx { getTrackByIdLocked(id) }

    private fun SQLiteDatabase.getTrackByIdLocked(id: String): TrackRow? {
        rawQuery("SELECT * FROM tracks WHERE id = ?", arrayOf(id)).use { c ->
            return if (c.moveToFirst()) c.toTrackRow() else null
        }
    }

    fun getQueuedTracks(): List<TrackRow> = tx {
        rawQuery("SELECT * FROM tracks WHERE status = 'queued' ORDER BY vote_score DESC, created_at ASC", null)
            .use { it.toTrackList() }
    }

    fun getCurrentTrack(): TrackRow? = tx {
        rawQuery("SELECT * FROM tracks WHERE status = 'playing' LIMIT 1", null).use { c ->
            if (c.moveToFirst()) c.toTrackRow() else null
        }
    }

    fun getPlayedTracks(limit: Int = 50): List<TrackRow> = tx {
        rawQuery(
            "SELECT * FROM tracks WHERE status = 'played' ORDER BY COALESCE(played_at, created_at) DESC LIMIT ?",
            arrayOf(limit.toString()),
        ).use { it.toTrackList() }
    }

    fun searchPlayedTracks(query: String, limit: Int = 40): List<TrackRow> {
        if (query.trim().length < 2) return getPlayedTracks(limit)
        return searchTracksFolded(
            query = query,
            extraWhere = "t.status = 'played'",
            orderBy = "COALESCE(t.played_at, t.created_at) DESC",
            scanLimit = 500,
            resultLimit = limit,
        )
    }

    fun searchLocalTracks(query: String, limit: Int = 8): List<TrackRow> {
        if (query.trim().length < 2) return emptyList()
        return searchTracksFolded(
            query = query,
            extraWhere = "t.status != 'removed'",
            orderBy = "t.created_at DESC",
            scanLimit = 500,
            resultLimit = limit,
        )
    }

    private fun searchTracksFolded(
        query: String,
        extraWhere: String,
        orderBy: String,
        scanLimit: Int,
        resultLimit: Int,
    ): List<TrackRow> = tx {
        rawQuery(
            """
            SELECT t.*, IFNULL(m.title,'') AS idx_title, IFNULL(m.artist,'') AS idx_artist,
                   IFNULL(m.album,'') AS idx_album, IFNULL(m.filename,'') AS idx_filename
            FROM tracks t
            LEFT JOIN media_index m ON m.file_path = t.file_path
            WHERE $extraWhere
            ORDER BY $orderBy
            LIMIT ?
            """.trimIndent(),
            arrayOf(scanLimit.toString()),
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val row = c.toTrackRow()
                    if (AppDatabase.matchesFold(
                            query,
                            row.title,
                            row.artist,
                            c.str("idx_title"),
                            c.str("idx_artist"),
                            c.str("idx_album"),
                            c.str("idx_filename"),
                        )
                    ) {
                        add(row)
                        if (size >= resultLimit) break
                    }
                }
            }
        }
    }

    fun readdPlayedTrack(trackId: String, sessionId: String): TrackRow {
        val src = getTrackById(trackId) ?: throw HttpException(404, "trackNotFound")
        if (src.status == "removed") throw HttpException(400, "trackRemoved")
        val filePath = src.filePath?.takeIf { fileExists(it) }
        if (src.source == "local" && filePath == null) throw HttpException(400, "fileMissing")
        return addTrack(src.title, src.artist, src.source, src.sourceRef, filePath, sessionId, src.durationSec)
    }

    fun voteTrack(trackId: String, sessionId: String, direction: Int): TrackRow? = tx {
        val track = getTrackByIdLocked(trackId) ?: return@tx null
        if (track.status != "queued" && track.status != "playing") return@tx null
        rawQuery(
            "SELECT direction FROM votes WHERE track_id = ? AND session_id = ?",
            arrayOf(trackId, sessionId),
        ).use { c ->
            if (c.moveToFirst()) {
                val existing = c.getInt(0)
                if (existing == direction) return@tx track
                execSQL(
                    "UPDATE votes SET direction = ?, created_at = ? WHERE track_id = ? AND session_id = ?",
                    arrayOf(direction, System.currentTimeMillis(), trackId, sessionId),
                )
                execSQL("UPDATE tracks SET vote_score = vote_score + ? WHERE id = ?", arrayOf(direction * 2, trackId))
            } else {
                execSQL(
                    "INSERT INTO votes (track_id, session_id, direction, created_at) VALUES (?, ?, ?, ?)",
                    arrayOf(trackId, sessionId, direction, System.currentTimeMillis()),
                )
                execSQL("UPDATE tracks SET vote_score = vote_score + ? WHERE id = ?", arrayOf(direction, trackId))
            }
        }
        val updated = getTrackByIdLocked(trackId)!!
        if (updated.status == "queued" && updated.voteScore <= config().kickThreshold) {
            removeTrackLocked(trackId)
            return@tx null
        }
        updated
    }

    fun removeTrack(trackId: String) = tx { removeTrackLocked(trackId) }

    private fun SQLiteDatabase.removeTrackLocked(trackId: String) {
        execSQL("UPDATE tracks SET status = 'removed' WHERE id = ?", arrayOf(trackId))
        execSQL("DELETE FROM votes WHERE track_id = ?", arrayOf(trackId))
    }

    fun removeTracksByArtist(artist: String): Int = tx {
        rawQuery("SELECT id FROM tracks WHERE artist = ? AND status = 'queued'", arrayOf(artist)).use { c ->
            val ids = mutableListOf<String>()
            while (c.moveToNext()) ids += c.str("id")
            ids.forEach { removeTrackLocked(it) }
            ids.size
        }
    }

    fun clearQueue(): Int = tx {
        rawQuery("SELECT id FROM tracks WHERE status = 'queued'", null).use { c ->
            val ids = mutableListOf<String>()
            while (c.moveToNext()) ids += c.str("id")
            ids.forEach { removeTrackLocked(it) }
            ids.size
        }
    }

    fun clearHistory(): Int = tx {
        rawQuery("SELECT id FROM tracks WHERE status = 'played'", null).use { c ->
            val ids = mutableListOf<String>()
            while (c.moveToNext()) ids += c.str("id")
            ids.forEach { removeTrackLocked(it) }
            ids.size
        }
    }

    /** Not used at startup — queue persists across restarts. */
    fun resetToEmptySession(): Pair<Int, Boolean> = tx {
        var stopped = false
        rawQuery("SELECT id FROM tracks WHERE status = 'playing' LIMIT 1", null).use { c ->
            if (c.moveToFirst()) {
                execSQL(
                    "UPDATE tracks SET status = 'played', played_at = ? WHERE id = ?",
                    arrayOf(System.currentTimeMillis(), c.str("id")),
                )
                stopped = true
            }
        }
        rawQuery("SELECT id FROM tracks WHERE status = 'queued'", null).use { c ->
            val ids = mutableListOf<String>()
            while (c.moveToNext()) ids += c.str("id")
            ids.forEach { removeTrackLocked(it) }
            ids.size to stopped
        }
    }

    fun setTrackPlaying(trackId: String) = tx {
        val now = System.currentTimeMillis()
        execSQL("UPDATE tracks SET status = 'played', played_at = ? WHERE status = 'playing'", arrayOf(now))
        execSQL("UPDATE tracks SET status = 'playing' WHERE id = ?", arrayOf(trackId))
    }

    fun markCurrentPlayed() = tx {
        execSQL("UPDATE tracks SET status = 'played', played_at = ? WHERE status = 'playing'", arrayOf(System.currentTimeMillis()))
    }

    fun getNextTrack(): TrackRow? = tx {
        rawQuery(
            """
            SELECT * FROM tracks
            WHERE status = 'queued' AND download_status = 'ready' AND file_path IS NOT NULL
            ORDER BY vote_score DESC, created_at ASC
            LIMIT 1
            """.trimIndent(),
            null,
        ).use { if (it.moveToFirst()) it.toTrackRow() else null }
    }

    fun setTrackDownload(id: String, status: String, filePath: String? = null, error: String? = null, durationSec: Int? = null) = tx {
        execSQL(
            "UPDATE tracks SET download_status = ?, file_path = COALESCE(?, file_path), download_error = ?, duration_sec = COALESCE(?, duration_sec) WHERE id = ?",
            arrayOf(status, filePath, error, durationSec, id),
        )
    }

    fun setTrackDuration(id: String, durationSec: Int) {
        if (durationSec <= 0) return
        tx {
            execSQL(
                "UPDATE tracks SET duration_sec = ? WHERE id = ? AND (duration_sec IS NULL OR duration_sec = 0)",
                arrayOf(durationSec, id),
            )
        }
    }

    fun countDownvotes(trackId: String): Int = tx {
        rawQuery("SELECT COUNT(*) as c FROM votes WHERE track_id = ? AND direction = -1", arrayOf(trackId)).use { c ->
            c.moveToFirst()
            c.getInt(0)
        }
    }

    fun getDownloadQueue(): List<TrackRow> = tx {
        rawQuery(
            """
            SELECT * FROM tracks
            WHERE status IN ('queued', 'playing')
              AND download_status IN ('pending', 'downloading')
              AND source IN ('youtube', 'spotify')
            ORDER BY CASE WHEN status = 'playing' THEN 0 ELSE 1 END, vote_score DESC, created_at ASC
            """.trimIndent(),
            null,
        ).use { it.toTrackList() }
    }

    fun getPreviousTrack(excludeId: String?): TrackRow? = tx {
        if (excludeId != null) {
            rawQuery(
                "SELECT * FROM tracks WHERE status = 'played' AND id != ? ORDER BY COALESCE(played_at, created_at) DESC LIMIT 1",
                arrayOf(excludeId),
            ).use { if (it.moveToFirst()) it.toTrackRow() else null }
        } else {
            rawQuery(
                "SELECT * FROM tracks WHERE status = 'played' ORDER BY COALESCE(played_at, created_at) DESC LIMIT 1",
                null,
            ).use { if (it.moveToFirst()) it.toTrackRow() else null }
        }
    }

    fun requeueCurrentTrack(): TrackRow? = tx {
        val current = rawQuery("SELECT * FROM tracks WHERE status = 'playing' LIMIT 1", null).use {
            if (it.moveToFirst()) it.toTrackRow() else null
        } ?: return@tx null
        val maxScore = rawQuery("SELECT MAX(vote_score) as m FROM tracks WHERE status = 'queued'", null).use { c ->
            c.moveToFirst()
            if (c.isNull(0)) 0 else c.getInt(0)
        }
        execSQL("UPDATE tracks SET status = 'queued', vote_score = ? WHERE id = ?", arrayOf(maxScore + 1, current.id))
        current
    }

    fun getSessionColor(sessionId: String?): String? {
        if (sessionId.isNullOrBlank()) return null
        return tx {
            rawQuery("SELECT color FROM sessions WHERE id = ?", arrayOf(sessionId)).use { c ->
                if (c.moveToFirst()) c.str("color") else null
            }
        }
    }

    fun getSessionIp(sessionId: String?): String? {
        if (sessionId.isNullOrBlank()) return null
        return tx {
            rawQuery("SELECT ip FROM sessions WHERE id = ?", arrayOf(sessionId)).use { c ->
                if (c.moveToFirst()) c.str("ip") else null
            }
        }
    }

    fun enrich(track: TrackRow): TrackDto = track.toDto(
        getSessionColor(track.addedBySession),
        getSessionIp(track.addedBySession),
        getSessionEmoji(track.addedBySession),
    )

    fun getActiveUserCount(): Int = tx {
        val cutoff = (System.currentTimeMillis() - 5 * 60 * 1000).toString()
        rawQuery("SELECT COUNT(DISTINCT ip) as c FROM sessions WHERE last_seen > ? AND banned = 0", arrayOf(cutoff)).use { c ->
            c.moveToFirst()
            c.getInt(0)
        }
    }

    fun buildState(): AppStateDto {
        val current = getCurrentTrack()
        return AppStateDto(
            current = current?.let { enrich(it) },
            queue = getQueuedTracks().map { enrich(it) },
            history = getPlayedTracks(50).map { enrich(it) },
            activeUsers = getActiveUserCount(),
            eventMode = config().eventMode,
            playing = isPlaying(),
        )
    }

    fun notifyStateChange() {
        onState()
    }

    fun banSession(sessionId: String) = tx { execSQL("UPDATE sessions SET banned = 1 WHERE id = ?", arrayOf(sessionId)) }
    fun banIp(ip: String) = tx { execSQL("UPDATE sessions SET banned = 1 WHERE ip = ?", arrayOf(ip)) }
    fun unbanSession(sessionId: String) = tx { execSQL("UPDATE sessions SET banned = 0 WHERE id = ?", arrayOf(sessionId)) }
    fun unbanIp(ip: String) = tx { execSQL("UPDATE sessions SET banned = 0 WHERE ip = ?", arrayOf(ip)) }

    fun logAdminAction(action: String, details: String? = null) = tx {
        execSQL(
            "INSERT INTO admin_log (action, details, created_at) VALUES (?, ?, ?)",
            arrayOf(action, details, System.currentTimeMillis()),
        )
        rawQuery("SELECT COUNT(*) as c FROM admin_log", null).use { c ->
            c.moveToFirst()
            val total = c.getInt(0)
            if (total > 500) {
                execSQL(
                    "DELETE FROM admin_log WHERE id IN (SELECT id FROM admin_log ORDER BY created_at ASC LIMIT ?)",
                    arrayOf(total - 500),
                )
            }
        }
    }

    fun getAdminLog(limit: Int = 50): List<AdminLogEntryDto> = tx {
        rawQuery("SELECT action, details, created_at FROM admin_log ORDER BY created_at DESC LIMIT ?", arrayOf(limit.toString())).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(AdminLogEntryDto(c.str("action"), c.strOrNull("details"), c.longVal("created_at")))
                }
            }
        }
    }

    fun getUserVotes(sessionId: String): Map<String, Int> = tx {
        rawQuery("SELECT track_id, direction FROM votes WHERE session_id = ?", arrayOf(sessionId)).use { c ->
            buildMap {
                while (c.moveToNext()) put(c.str("track_id"), c.intVal("direction"))
            }
        }
    }
}

data class SessionInfo(val id: String, val color: String, val banned: Boolean, val emoji: String)

class HttpException(val statusCode: Int, override val message: String) : Exception(message)

private fun android.database.Cursor.toTrackList(): List<TrackRow> = buildList {
    while (moveToNext()) add(toTrackRow())
}
