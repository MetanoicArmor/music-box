package com.musicbox.host

import kotlinx.serialization.Serializable

@Serializable
data class TrackDto(
    val id: String,
    val title: String,
    val artist: String,
    val source: String,
    val source_ref: String? = null,
    val file_path: String? = null,
    val added_by_session: String? = null,
    val vote_score: Int,
    val status: String,
    val created_at: Long,
    val played_at: Long? = null,
    val download_status: String? = "ready",
    val download_error: String? = null,
    val duration_sec: Int? = null,
    val sessionColor: String? = null,
    val sessionEmoji: String? = null,
    val addedByIp: String? = null,
)

@Serializable
data class AppStateDto(
    val current: TrackDto? = null,
    val queue: List<TrackDto> = emptyList(),
    val history: List<TrackDto> = emptyList(),
    val activeUsers: Int = 0,
    val eventMode: Boolean = false,
    val playing: Boolean = false,
)

@Serializable
data class StateResponse(
    val current: TrackDto? = null,
    val queue: List<TrackDto> = emptyList(),
    val history: List<TrackDto> = emptyList(),
    val activeUsers: Int = 0,
    val eventMode: Boolean = false,
    val playing: Boolean = false,
    val userVotes: Map<String, Int> = emptyMap(),
    val sessionId: String = "",
    val myEmoji: String = "",
)

@Serializable
data class WsEnvelope(
    val type: String,
    val payload: AppStateDto,
)

@Serializable
data class SearchSuggestionDto(
    val title: String,
    val artist: String,
    val source: String,
    val sourceRef: String,
    val thumbnail: String? = null,
    val duration_sec: Int? = null,
)

@Serializable
data class SearchResultsDto(
    val local: List<SearchSuggestionDto> = emptyList(),
    val youtube: List<SearchSuggestionDto> = emptyList(),
)

@Serializable
data class LibraryTrackDto(
    val title: String,
    val artist: String,
    val album: String,
    val source: String = "local",
    val sourceRef: String,
    val filename: String,
    val duration_sec: Int? = null,
)

@Serializable
data class ServerInfoDto(
    val url: String,
    val port: Int,
    val lanIp: String,
    val https: Boolean = true,
)

@Serializable
data class PlaybackStatusDto(
    val time: Double,
    val duration: Double,
    val paused: Boolean,
    val playing: Boolean,
)

@Serializable
data class AdminPlaybackDto(
    val status: PlaybackStatusDto? = null,
    val current: TrackDto? = null,
)

@Serializable
data class AdminLogEntryDto(
    val action: String,
    val details: String? = null,
    val created_at: Long,
)

@Serializable
data class ErrorDto(val error: String)

data class TrackRow(
    val id: String,
    val title: String,
    val artist: String,
    val source: String,
    val sourceRef: String?,
    val filePath: String?,
    val addedBySession: String?,
    val voteScore: Int,
    val status: String,
    val createdAt: Long,
    val playedAt: Long?,
    val downloadStatus: String,
    val downloadError: String?,
    val durationSec: Int?,
)

data class MediaIndexRow(
    val filePath: String,
    val title: String,
    val artist: String,
    val album: String,
    val filename: String,
    val mtime: Double,
    val durationSec: Int?,
)

data class FileTags(
    val title: String,
    val artist: String,
    val album: String,
    val filename: String,
    val durationSec: Int?,
)

data class ResolvedTrack(
    val title: String,
    val artist: String,
    val source: String,
    val sourceRef: String,
    val filePath: String? = null,
    val thumbnail: String? = null,
    val durationSec: Int? = null,
)

fun TrackRow.toDto(sessionColor: String? = null, addedByIp: String? = null, sessionEmoji: String? = null) = TrackDto(
    id = id,
    title = title,
    artist = artist,
    source = source,
    source_ref = sourceRef,
    file_path = filePath,
    added_by_session = addedBySession,
    vote_score = voteScore,
    status = status,
    created_at = createdAt,
    played_at = playedAt,
    download_status = downloadStatus,
    download_error = downloadError,
    duration_sec = durationSec,
    sessionColor = sessionColor,
    sessionEmoji = sessionEmoji,
    addedByIp = addedByIp,
)
