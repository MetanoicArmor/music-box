package com.musicbox.host

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.text.Normalizer
import java.util.Locale
import java.util.UUID

class AppDatabase(context: Context, private val paths: AppPaths) {
    private val lock = Any()
    val db: SQLiteDatabase

    init {
        paths.ensureDirs()
        db = SQLiteDatabase.openOrCreateDatabase(paths.db, null)
        db.enableWriteAheadLogging()
        db.execSQL("PRAGMA foreign_keys = ON")
        val schema = context.assets.open("schema.sql").bufferedReader().use { it.readText() }
        execScript(schema)
        migrate()
    }

    private fun migrate() {
        val cols = db.rawQuery("PRAGMA table_info(sessions)", null).use { c ->
            buildList {
                val nameIdx = c.getColumnIndex("name")
                while (c.moveToNext()) add(c.getString(nameIdx))
            }
        }
        if (!cols.contains("emoji")) {
            db.execSQL("ALTER TABLE sessions ADD COLUMN emoji TEXT")
        }
    }

    private fun execScript(sql: String) {
        sql.split(';')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .forEach { db.execSQL(it) }
    }

    fun <T> withLock(block: SQLiteDatabase.() -> T): T = synchronized(lock) { db.block() }

    fun close() {
        synchronized(lock) { db.close() }
    }

    companion object {
        val SESSION_COLORS = listOf(
            "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
            "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
        )

        fun foldSearch(value: String?): String {
            val raw = value ?: ""
            return Normalizer.normalize(raw, Normalizer.Form.NFC)
                .lowercase(Locale("ru"))
                .replace('ё', 'е')
        }

        fun foldLike(query: String): String = "%${foldSearch(query.trim())}%"

        fun matchesFold(query: String, vararg fields: String?): Boolean {
            val needle = foldSearch(query.trim())
            if (needle.isEmpty()) return false
            val hay = foldSearch(fields.joinToString(" ") { it.orEmpty() })
            return hay.contains(needle)
        }

        fun newId(): String = UUID.randomUUID().toString()
    }
}

fun Cursor.str(col: String): String = getString(getColumnIndexOrThrow(col)) ?: ""

fun Cursor.strOrNull(col: String): String? {
    val i = getColumnIndexOrThrow(col)
    return if (isNull(i)) null else getString(i)
}

fun Cursor.longVal(col: String): Long {
    val i = getColumnIndexOrThrow(col)
    return if (isNull(i)) 0L else getLong(i)
}

fun Cursor.longOrNull(col: String): Long? {
    val i = getColumnIndexOrThrow(col)
    return if (isNull(i)) null else getLong(i)
}

fun Cursor.intVal(col: String): Int {
    val i = getColumnIndexOrThrow(col)
    return if (isNull(i)) 0 else getInt(i)
}

fun Cursor.intOrNull(col: String): Int? {
    val i = getColumnIndexOrThrow(col)
    return if (isNull(i)) null else getInt(i)
}

fun Cursor.doubleVal(col: String): Double {
    val i = getColumnIndexOrThrow(col)
    return if (isNull(i)) 0.0 else getDouble(i)
}

fun Cursor.toTrackRow(): TrackRow = TrackRow(
    id = str("id"),
    title = str("title"),
    artist = str("artist"),
    source = str("source"),
    sourceRef = strOrNull("source_ref"),
    filePath = strOrNull("file_path"),
    addedBySession = strOrNull("added_by_session"),
    voteScore = intVal("vote_score"),
    status = str("status"),
    createdAt = longVal("created_at"),
    playedAt = longOrNull("played_at"),
    downloadStatus = str("download_status"),
    downloadError = strOrNull("download_error"),
    durationSec = intOrNull("duration_sec"),
)

fun fileExists(path: String?): Boolean = !path.isNullOrBlank() && File(path).isFile
