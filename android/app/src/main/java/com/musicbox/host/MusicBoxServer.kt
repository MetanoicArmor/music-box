package com.musicbox.host

import android.content.Context
import io.ktor.http.ContentDisposition
import io.ktor.http.ContentType
import io.ktor.http.Cookie
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.PartData
import io.ktor.http.content.forEachPart
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.ApplicationEngine
import io.ktor.server.engine.embeddedServer
import io.ktor.server.http.content.LocalFileContent
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.partialcontent.PartialContent
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.header
import io.ktor.server.request.receiveMultipart
import io.ktor.server.request.receiveText
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.webSocket
import io.ktor.utils.io.core.readAvailable
import io.ktor.utils.io.jvm.javaio.toInputStream
import io.ktor.websocket.DefaultWebSocketSession
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet

private const val SESSION_COOKIE = "mb_session"
private const val ADMIN_COOKIE = "mb_admin"

class MusicBoxServer(
    private val context: Context,
    private val config: () -> AppConfig,
    private val queue: QueueRepository,
    private val player: PlaybackController,
    private val mediaIndex: MediaIndex,
    private val paths: AppPaths,
    private val downloader: TrackDownloader,
    private val setEventMode: (Boolean) -> Unit,
) {
    private fun cfg() = config()
    private val jsonMapper = Json { encodeDefaults = true; ignoreUnknownKeys = true }
    private val clients = CopyOnWriteArraySet<DefaultWebSocketSession>()
    private var engine: ApplicationEngine? = null
    var httpsEnabled: Boolean = true
        private set

    fun broadcastState() {
        val payload = queue.buildState()
        val text = jsonMapper.encodeToString(WsEnvelope.serializer(), WsEnvelope("state", payload))
        clients.forEach { session ->
            try {
                session.launch {
                    try {
                        session.send(Frame.Text(text))
                    } catch (_: Exception) {
                        clients.remove(session)
                    }
                }
            } catch (_: Exception) {
                clients.remove(session)
            }
        }
    }

    fun start() {
        // CIO on Android cannot do TLS — HTTPS throws asynchronously and crashes the process.
        httpsEnabled = false
        engine = embeddedServer(CIO, port = cfg().port, host = "0.0.0.0") {
            configure()
        }.start(wait = false)
        android.util.Log.i("MusicBox", "HTTP server listening on 0.0.0.0:${cfg().port}")
    }

    fun stop() {
        try {
            engine?.stop(500, 1000)
        } catch (_: Exception) {
        }
        engine = null
        clients.clear()
    }

    private fun io.ktor.server.application.Application.configure() {
        install(ContentNegotiation) { json(jsonMapper) }
        install(WebSockets)
        install(PartialContent)
        install(StatusPages) {
            exception<HttpException> { call, cause ->
                call.respond(HttpStatusCode.fromValue(cause.statusCode), call.apiErrorFrom(cause.message))
            }
            exception<Throwable> { call, cause ->
                android.util.Log.e("MusicBox", "route error", cause)
                call.respond(HttpStatusCode.InternalServerError, call.apiError("error"))
            }
        }
        routing {
            webSocket("/ws") {
                clients.add(this)
                send(Frame.Text(jsonMapper.encodeToString(WsEnvelope.serializer(), WsEnvelope("state", queue.buildState()))))
                try {
                    for (frame in incoming) {
                        if (frame is Frame.Text) frame.readText()
                    }
                } catch (_: ClosedReceiveChannelException) {
                } finally {
                    clients.remove(this)
                }
            }

            get("/api/info") {
                val lanIp = getLanIp()
                val url = if (httpsEnabled) getPublicUrl(cfg().port, lanIp) else "http://$lanIp:${cfg().port}"
                call.respond(ServerInfoDto(url, cfg().port, lanIp, httpsEnabled))
            }

            get("/api/state") {
                val session = requireSessionInfo(call) ?: return@get
                val state = queue.buildState()
                call.respond(
                    StateResponse(
                        current = state.current,
                        queue = state.queue,
                        history = state.history,
                        activeUsers = state.activeUsers,
                        eventMode = state.eventMode,
                        playing = state.playing,
                        userVotes = queue.getUserVotes(session.id),
                        sessionId = session.id,
                        myEmoji = session.emoji.ifBlank { "🙂" },
                    ),
                )
            }

            post("/api/session/avatar") {
                call.drainJsonBody()
                val session = requireSession(call) ?: return@post
                try {
                    val emoji = queue.cycleSessionEmoji(session)
                    queue.notifyStateChange()
                    call.respond(AvatarDto(emoji))
                } catch (err: HttpException) {
                    call.respond(HttpStatusCode.fromValue(err.statusCode), call.apiErrorFrom(err.message))
                }
            }

            post("/api/tracks") {
                val session = requireSession(call) ?: return@post
                if (cfg().eventMode) {
                    call.respond(HttpStatusCode.Forbidden, call.apiError("eventMode"))
                    return@post
                }
                val body = call.receiveJson()
                val filePath = body.str("filePath")
                if (!filePath.isNullOrBlank()) {
                    cfg().durationLimitError(queue.mediaDuration(filePath))?.let {
                        call.respond(HttpStatusCode.BadRequest, call.apiError("trackTooLong"))
                        return@post
                    }
                    val track = queue.addTrack(
                        title = body.str("title") ?: File(filePath).name,
                        artist = body.str("artist"),
                        source = "local",
                        sourceRef = null,
                        filePath = filePath,
                        sessionId = session,
                    )
                    queue.notifyStateChange()
                    player.startPlaybackIfIdle()
                    call.respond(track.toDto())
                    return@post
                }
                val source = body.str("source")
                val sourceRef = body.str("sourceRef")
                val title = body.str("title")
                if (!source.isNullOrBlank() && !sourceRef.isNullOrBlank() && !title.isNullOrBlank()) {
                    if (source == "local" && File(sourceRef).exists()) {
                        cfg().durationLimitError(queue.mediaDuration(sourceRef))?.let {
                            call.respond(HttpStatusCode.BadRequest, call.apiError("trackTooLong"))
                            return@post
                        }
                        val track = queue.addTrack(title, body.str("artist"), "local", null, sourceRef, session)
                        queue.notifyStateChange()
                        player.startPlaybackIfIdle()
                        call.respond(track.toDto())
                        return@post
                    }
                    if (source != "youtube" && source != "spotify") {
                        call.respond(HttpStatusCode.BadRequest, call.apiError("invalidSource"))
                        return@post
                    }
                    if (!Youtube.isOnline()) {
                        call.respond(HttpStatusCode.ServiceUnavailable, call.apiError("needInternet"))
                        return@post
                    }
                    var durationSec = body.int("duration_sec")
                    if (source == "youtube" && (durationSec == null || durationSec <= 0)) {
                        durationSec = runCatching { Youtube.resolveYouTubeUrl(sourceRef).durationSec }.getOrNull()
                    }
                    cfg().durationLimitError(durationSec)?.let {
                        call.respond(HttpStatusCode.BadRequest, call.apiError("trackTooLong"))
                        return@post
                    }
                    val track = queue.addTrack(title, body.str("artist"), source, sourceRef, null, session, durationSec)
                    queue.notifyStateChange()
                    downloader.kick()
                    call.respond(track.toDto())
                    return@post
                }
                val input = body.str("input")?.trim()
                if (input.isNullOrBlank()) {
                    call.respond(HttpStatusCode.BadRequest, call.apiError("inputRequired"))
                    return@post
                }
                val online = Youtube.isOnline()
                val isUrl = Regex("youtube\\.com|youtu\\.be|spotify\\.com").containsMatchIn(input)
                if ((isUrl || Youtube.detectSource(input) == "search") && !online) {
                    call.respond(HttpStatusCode.ServiceUnavailable, call.apiError("needInternetLinks"))
                    return@post
                }
                try {
                    val resolved = Youtube.resolveInput(input)
                    cfg().durationLimitError(resolved.durationSec)?.let {
                        call.respond(HttpStatusCode.BadRequest, call.apiError("trackTooLong"))
                        return@post
                    }
                    val track = queue.addTrack(
                        resolved.title, resolved.artist, resolved.source, resolved.sourceRef, null, session, resolved.durationSec,
                    )
                    queue.notifyStateChange()
                    downloader.kick()
                    call.respond(track.toDto())
                } catch (err: Exception) {
                    call.respond(HttpStatusCode.BadRequest, call.apiErrorFrom(err.message, "resolveFailed"))
                }
            }

            get("/api/history/search") {
                val session = requireSession(call) ?: return@get
                val q = call.request.queryParameters["q"].orEmpty().trim()
                val tracks = queue.searchPlayedTracks(q, 40).map { queue.enrich(it) }
                call.respond(HistorySearchDto(tracks))
            }

            post("/api/tracks/{id}/readd") {
                call.drainJsonBody()
                val session = requireSession(call) ?: return@post
                if (cfg().eventMode) {
                    call.respond(HttpStatusCode.Forbidden, call.apiError("eventMode"))
                    return@post
                }
                val id = call.parameters["id"] ?: return@post
                try {
                    val existing = queue.getTrackById(id)
                    cfg().durationLimitError(existing?.durationSec)?.let {
                        call.respond(HttpStatusCode.BadRequest, call.apiError("trackTooLong"))
                        return@post
                    }
                    val track = queue.readdPlayedTrack(id, session)
                    queue.notifyStateChange()
                    if (track.downloadStatus == "pending") downloader.kick()
                    else player.startPlaybackIfIdle()
                    call.respond(track.toDto())
                } catch (err: HttpException) {
                    call.respond(HttpStatusCode.fromValue(err.statusCode), call.apiErrorFrom(err.message))
                }
            }

            get("/api/library") {
                if (requireSession(call) == null) return@get
                mediaIndex.scan()
                val q = call.request.queryParameters["q"].orEmpty()
                val tracks = mediaIndex.list(q, 200).map {
                    LibraryTrackDto(it.title, it.artist, it.album, "local", it.filePath, it.filename, it.durationSec)
                }
                call.respond(LibraryDto(tracks, tracks.size))
            }

            get("/api/search") {
                if (requireSession(call) == null) return@get
                val q = call.request.queryParameters["q"].orEmpty().trim()
                if (q.length < 2) {
                    call.respond(SearchResultsDto())
                    return@get
                }
                val localFromTracks = queue.searchLocalTracks(q, 8)
                    .filter { if (it.source == "local") !it.filePath.isNullOrBlank() else !it.sourceRef.isNullOrBlank() }
                    .map {
                        SearchSuggestionDto(
                            it.title, it.artist, it.source,
                            (if (it.source == "local") it.filePath else it.sourceRef)!!,
                            null, it.durationSec,
                        )
                    }
                val localFromFiles = mediaIndex.search(q, 8).map {
                    SearchSuggestionDto(
                        it.title,
                        if (it.album.isNotBlank()) "${it.artist} · ${it.album}" else it.artist,
                        "local", it.filePath, null, it.durationSec,
                    )
                }
                val seen = mutableSetOf<String>()
                val local = (localFromTracks + localFromFiles).filter {
                    val key = "${it.source}:${it.sourceRef.lowercase()}"
                    seen.add(key)
                }.take(6)
                val youtube = if (Youtube.isOnline()) {
                    runCatching { Youtube.searchMany(q, 5).map { SearchSuggestionDto(it.title, it.artist, it.source, it.sourceRef, it.thumbnail, it.durationSec) } }.getOrDefault(emptyList())
                } else emptyList()
                call.respond(SearchResultsDto(local, youtube))
            }

            post("/api/tracks/{id}/vote") {
                val session = requireSession(call) ?: return@post
                if (!queue.checkVoteRateLimit(session)) {
                    call.respond(HttpStatusCode.TooManyRequests, call.apiError("tooManyVotes"))
                    return@post
                }
                val id = call.parameters["id"] ?: return@post
                val body = call.receiveJson()
                val direction = if (body.str("direction") == "down") -1 else 1
                val before = queue.getTrackById(id)
                val downBefore = if (before?.status == "playing") queue.countDownvotes(id) else 0
                val result = queue.voteTrack(id, session, direction)
                val downAfter = queue.countDownvotes(id)
                if (before?.status == "playing" && downAfter >= cfg().playingKickDislikes && downAfter > downBefore) {
                    player.skip()
                }
                queue.notifyStateChange()
                call.respond(VoteResultDto(result?.toDto()))
            }

            post("/api/upload") {
                val session = requireSession(call) ?: return@post
                if (cfg().eventMode) {
                    call.respond(HttpStatusCode.Forbidden, call.apiError("eventModeUploads"))
                    return@post
                }
                var saved: UploadResultDto? = null
                val multipart = call.receiveMultipart()
                multipart.forEachPart { part ->
                    try {
                        val payload = partPayload(part) ?: return@forEachPart
                        val name = partFileName(part)
                        val tmp = paths.newTempFile(".bin")
                        try {
                            tmp.outputStream().buffered().use { out -> copyUploadBytes(payload, out) }
                            if (tmp.length() > cfg().maxUploadMb.toLong() * 1024 * 1024) {
                                throw HttpException(400, "fileTooLarge")
                            }
                            if (tmp.length() == 0L) throw HttpException(400, "emptyUpload")
                            val ext = MediaNames.resolveAudioExt(name, part.contentType?.toString(), tmp)
                                ?: throw HttpException(400, "unsupportedType")
                            val tags = Tags.readFileTags(tmp, name)
                            cfg().durationLimitError(tags.durationSec)?.let { throw HttpException(400, it) }
                            val dest = paths.publishAudio(tmp, tags.artist, tags.title, ext, deleteSource = true)
                            mediaIndex.indexFile(dest, name)
                            paths.notifyFile(dest)
                            saved = UploadResultDto(tags.title, tags.artist, dest.absolutePath)
                        } catch (e: HttpException) {
                            tmp.delete()
                            throw e
                        } catch (e: Exception) {
                            tmp.delete()
                            throw e
                        }
                    } finally {
                        part.dispose()
                    }
                }
                val result = saved ?: throw HttpException(400, "noFile")
                call.respond(result)
            }

            get("/api/stream/{id}") {
                if (requireSession(call) == null) return@get
                val id = call.parameters["id"] ?: return@get
                val track = queue.getTrackById(id)
                val filePath = track?.filePath
                if (
                    track == null ||
                    filePath.isNullOrBlank() ||
                    track.status !in STREAMABLE_STATUSES ||
                    track.downloadStatus != "ready"
                ) {
                    call.respond(HttpStatusCode.NotFound, call.apiError("trackNotFound"))
                    return@get
                }
                val file = File(filePath)
                if (!file.isFile) {
                    call.respond(HttpStatusCode.NotFound, call.apiError("fileNotFound"))
                    return@get
                }
                val download = call.request.queryParameters["download"] == "1"
                if (download) {
                    val name = "${MediaNames.safeMediaName(track.artist, track.title)}.${file.extension.ifBlank { "bin" }}"
                    call.response.header(
                        HttpHeaders.ContentDisposition,
                        ContentDisposition.Attachment.withParameter(ContentDisposition.Parameters.FileName, name).toString(),
                    )
                }
                call.response.header(HttpHeaders.AcceptRanges, "bytes")
                call.respond(LocalFileContent(file, contentType = ContentType.parse(mimeFor(file.extension))))
            }

            post("/api/admin/login") {
                requireSession(call) ?: return@post
                val body = call.receiveJson()
                if (body.str("password") == cfg().adminPassword) {
                    call.setCookie(ADMIN_COOKIE, "1", 60 * 60 * 24)
                    queue.logAdminAction("login")
                    call.respond(OkDto())
                } else {
                    call.respond(HttpStatusCode.Unauthorized, call.apiError("wrongPassword"))
                }
            }

            post("/api/admin/logout") {
                call.drainJsonBody()
                call.response.cookies.append(Cookie(ADMIN_COOKIE, "", maxAge = 0, path = "/"))
                call.respond(OkDto())
            }

            get("/api/admin/check") {
                call.respond(AdminCheckDto(call.isAdmin()))
            }

            delete("/api/admin/tracks/{id}") {
                if (!requireAdmin(call)) return@delete
                val id = call.parameters["id"] ?: return@delete
                val track = queue.getTrackById(id)
                if (track == null) {
                    call.respond(HttpStatusCode.NotFound, call.apiError("trackNotFound"))
                    return@delete
                }
                queue.removeTrack(id)
                queue.logAdminAction("remove_track", "${track.artist} - ${track.title}")
                if (track.status == "playing") player.skip()
                queue.notifyStateChange()
                call.respond(OkDto())
            }

            delete("/api/admin/artists/{name}") {
                if (!requireAdmin(call)) return@delete
                val name = java.net.URLDecoder.decode(call.parameters["name"] ?: "", "UTF-8")
                val count = queue.removeTracksByArtist(name)
                queue.logAdminAction("remove_artist", name)
                queue.notifyStateChange()
                call.respond(RemovedDto(count))
            }

            post("/api/admin/ban") {
                if (!requireAdmin(call)) return@post
                val body = call.receiveJson()
                when {
                    !body.str("sessionId").isNullOrBlank() -> {
                        queue.banSession(body.str("sessionId")!!)
                        queue.logAdminAction("ban_session", body.str("sessionId"))
                    }
                    !body.str("ip").isNullOrBlank() -> {
                        queue.banIp(normalizeClientIp(body.str("ip")!!.trim()))
                        queue.logAdminAction("ban_ip", body.str("ip"))
                    }
                    else -> {
                        call.respond(HttpStatusCode.BadRequest, call.apiError("sessionOrIp"))
                        return@post
                    }
                }
                call.respond(OkDto())
            }

            post("/api/admin/unban") {
                if (!requireAdmin(call)) return@post
                val body = call.receiveJson()
                when {
                    !body.str("sessionId").isNullOrBlank() -> {
                        queue.unbanSession(body.str("sessionId")!!)
                        queue.logAdminAction("unban_session", body.str("sessionId"))
                    }
                    !body.str("ip").isNullOrBlank() -> {
                        queue.unbanIp(normalizeClientIp(body.str("ip")!!.trim()))
                        queue.logAdminAction("unban_ip", body.str("ip"))
                    }
                    else -> {
                        call.respond(HttpStatusCode.BadRequest, call.apiError("sessionOrIp"))
                        return@post
                    }
                }
                call.respond(OkDto())
            }

            post("/api/admin/skip") {
                call.drainJsonBody()
                if (!requireAdmin(call)) return@post
                player.skip()
                queue.logAdminAction("skip")
                queue.notifyStateChange()
                call.respond(OkDto())
            }

            post("/api/admin/previous") {
                call.drainJsonBody()
                if (!requireAdmin(call)) return@post
                try {
                    val ok = player.previous()
                    if (!ok) {
                        call.respond(HttpStatusCode.NotFound, call.apiError("noPrevious"))
                        return@post
                    }
                    queue.logAdminAction("previous")
                    queue.notifyStateChange()
                    call.respond(OkDto())
                } catch (err: Exception) {
                    call.respond(HttpStatusCode.ServiceUnavailable, call.apiErrorFrom(err.message, "previousFailed"))
                }
            }

            post("/api/admin/stop") {
                call.drainJsonBody()
                if (!requireAdmin(call)) return@post
                player.stopPlayback()
                queue.logAdminAction("stop")
                queue.notifyStateChange()
                call.respond(OkDto())
            }

            post("/api/admin/pause") {
                call.drainJsonBody()
                if (!requireAdmin(call)) return@post
                if (!player.pause()) {
                    call.respond(HttpStatusCode.ServiceUnavailable, call.apiError("playerNotReady"))
                    return@post
                }
                queue.logAdminAction("pause")
                queue.notifyStateChange()
                call.respond(OkDto())
            }

            post("/api/admin/resume") {
                call.drainJsonBody()
                if (!requireAdmin(call)) return@post
                if (!player.resume()) {
                    call.respond(HttpStatusCode.ServiceUnavailable, call.apiError("playerNotReady"))
                    return@post
                }
                queue.logAdminAction("resume")
                queue.notifyStateChange()
                call.respond(OkDto())
            }

            post("/api/admin/seek") {
                if (!requireAdmin(call)) return@post
                val body = call.receiveJson()
                val absolute = body.dbl("absolute")
                val seconds = body.dbl("seconds")
                when {
                    absolute != null -> {
                        player.seekTo(absolute)
                        queue.logAdminAction("seek", "absolute ${absolute}s")
                    }
                    seconds != null -> {
                        player.seekRelative(seconds)
                        queue.logAdminAction("seek", "relative ${seconds}s")
                    }
                    else -> {
                        call.respond(HttpStatusCode.BadRequest, call.apiError("seekRequired"))
                        return@post
                    }
                }
                call.respond(OkDto())
            }

            get("/api/admin/playback") {
                if (!requireAdmin(call)) return@get
                val current = queue.getCurrentTrack()
                call.respond(AdminPlaybackDto(player.getPlaybackStatus(), current?.let { queue.enrich(it) }))
            }

            post("/api/admin/clear-queue") {
                call.drainJsonBody()
                if (!requireAdmin(call)) return@post
                val count = queue.clearQueue()
                queue.logAdminAction("clear_queue", "$count tracks")
                queue.notifyStateChange()
                call.respond(RemovedDto(count))
            }

            post("/api/admin/clear-history") {
                call.drainJsonBody()
                if (!requireAdmin(call)) return@post
                val count = queue.clearHistory()
                queue.logAdminAction("clear_history", "$count tracks")
                queue.notifyStateChange()
                call.respond(RemovedDto(count))
            }

            post("/api/admin/event-mode") {
                if (!requireAdmin(call)) return@post
                val body = call.receiveJson()
                val enabled = body.bool("enabled") ?: !cfg().eventMode
                setEventMode(enabled)
                queue.logAdminAction("event_mode", if (enabled) "enabled" else "disabled")
                queue.notifyStateChange()
                call.respond(EventModeDto(enabled))
            }

            get("/api/admin/log") {
                if (!requireAdmin(call)) return@get
                call.respond(queue.getAdminLog())
            }

            get("/") { call.serveAsset("index.html") }
            get("/{path...}") {
                val rel = call.parameters.getAll("path")?.joinToString("/").orEmpty()
                if (rel.startsWith("api/") || rel == "ws" || rel.startsWith("ws/")) {
                    call.respond(HttpStatusCode.NotFound, call.apiError("notFound"))
                    return@get
                }
                if (!call.serveAsset(rel)) {
                    call.serveAsset("index.html")
                }
            }
        }
    }

    private suspend fun ApplicationCall.serveAsset(rel: String): Boolean {
        val clean = rel.trimStart('/').ifBlank { "index.html" }
        val assetPath = "www/$clean"
        return try {
            val bytes = context.assets.open(assetPath).use { it.readBytes() }
            val mime = mimeFor(clean.substringAfterLast('.', "html"))
            respondBytes(bytes, ContentType.parse(mime))
            true
        } catch (_: Exception) {
            false
        }
    }

    private suspend fun requireSession(call: ApplicationCall): String? = requireSessionInfo(call)?.id

    private suspend fun requireSessionInfo(call: ApplicationCall): SessionInfo? {
        val ip = normalizeClientIp(
            call.request.header("X-Forwarded-For")?.split(",")?.first()?.trim()
                ?: call.request.local.remoteHost,
        )
        if (queue.isIpBanned(ip)) {
            call.respond(HttpStatusCode.Forbidden, call.apiError("banned"))
            return null
        }
        val session = queue.getOrCreateSession(call.request.cookies[SESSION_COOKIE], ip)
        call.setCookie(SESSION_COOKIE, session.id, 60 * 60 * 24 * 30)
        if (session.banned) {
            call.respond(HttpStatusCode.Forbidden, call.apiError("banned"))
            return null
        }
        return session
    }

    private fun ApplicationCall.apiError(key: String): ErrorDto {
        val vars = if (key == "trackTooLong") mapOf("minutes" to cfg().maxTrackMinutes.toString()) else emptyMap()
        return ErrorDto(Errors.t(this, key, vars))
    }

    private fun ApplicationCall.apiErrorFrom(raw: String?, fallback: String = "error"): ErrorDto {
        val key = if (raw != null && Errors.has(raw)) raw else fallback
        return apiError(key)
    }

    private suspend fun requireAdmin(call: ApplicationCall): Boolean {
        if (!call.isAdmin()) {
            call.respond(HttpStatusCode.Unauthorized, call.apiError("adminRequired"))
            return false
        }
        return true
    }

    private fun ApplicationCall.isAdmin(): Boolean = request.cookies[ADMIN_COOKIE] == "1"

    private fun ApplicationCall.setCookie(name: String, value: String, maxAge: Int) {
        response.cookies.append(
            Cookie(
                name = name,
                value = value,
                maxAge = maxAge,
                path = "/",
                httpOnly = true,
                extensions = mapOf("SameSite" to "Lax"),
            ),
        )
    }

    private suspend fun ApplicationCall.drainJsonBody() {
        runCatching { receiveText() }
    }

    private suspend fun ApplicationCall.receiveJson(): JsonObject {
        val text = runCatching { receiveText() }.getOrDefault("")
        if (text.isBlank()) return JsonObject(emptyMap())
        return jsonMapper.parseToJsonElement(text).jsonObject
    }
}

@kotlinx.serialization.Serializable
data class OkDto(val ok: Boolean = true)

@kotlinx.serialization.Serializable
data class AvatarDto(val emoji: String)

@kotlinx.serialization.Serializable
data class RemovedDto(val removed: Int)

@kotlinx.serialization.Serializable
data class EventModeDto(val eventMode: Boolean)

@kotlinx.serialization.Serializable
data class AdminCheckDto(val isAdmin: Boolean)

@kotlinx.serialization.Serializable
data class UploadResultDto(val title: String, val artist: String, val filePath: String)

@kotlinx.serialization.Serializable
data class HistorySearchDto(val tracks: List<TrackDto>)

@kotlinx.serialization.Serializable
data class LibraryDto(val tracks: List<LibraryTrackDto>, val total: Int)

@kotlinx.serialization.Serializable
data class VoteResultDto(val track: TrackDto?)

private fun partPayload(part: PartData): Any? = when (part) {
    is PartData.FileItem -> part.provider()
    is PartData.BinaryItem -> part.provider()
    is PartData.BinaryChannelItem -> part.provider()
    else -> null
}

private fun partFileName(part: PartData): String {
    val fromFile = (part as? PartData.FileItem)?.originalFileName
    val fromHeader = part.contentDisposition?.parameter("filename")
        ?: part.contentDisposition?.parameter("filename*")
    return listOf(fromFile, fromHeader).firstOrNull { !it.isNullOrBlank() }?.trim('"') ?: "upload"
}

private fun copyUploadBytes(raw: Any?, out: java.io.OutputStream) {
    when (raw) {
        null -> error("Empty upload part")
        is java.io.InputStream -> raw.use { it.copyTo(out) }
        is ByteArray -> out.write(raw)
        is java.nio.ByteBuffer -> {
            val bytes = ByteArray(raw.remaining())
            raw.get(bytes)
            out.write(bytes)
        }
        is io.ktor.utils.io.ByteReadChannel -> raw.toInputStream().use { it.copyTo(out) }
        is io.ktor.utils.io.core.Input -> copyKtorInput(raw, out)
        else -> {
            val stream = unwrapInputStream(raw)
            if (stream != null) {
                stream.use { it.copyTo(out) }
            } else {
                error("Unsupported upload part: ${raw.javaClass.name}")
            }
        }
    }
}

private fun unwrapInputStream(raw: Any): java.io.InputStream? {
    val field = raw.javaClass.declaredFields.firstOrNull {
        java.io.InputStream::class.java.isAssignableFrom(it.type)
    } ?: return null
    field.isAccessible = true
    return field.get(raw) as? java.io.InputStream
}

private fun copyKtorInput(input: io.ktor.utils.io.core.Input, out: java.io.OutputStream) {
    val buf = ByteArray(64 * 1024)
    try {
        while (!input.endOfInput) {
            val n = input.readAvailable(buf, 0, buf.size)
            if (n <= 0) break
            out.write(buf, 0, n)
        }
        out.flush()
    } finally {
        input.close()
    }
}

private fun JsonObject.str(key: String): String? =
    runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull()

private fun JsonObject.int(key: String): Int? =
    runCatching { this[key]?.jsonPrimitive?.intOrNull }.getOrNull()
        ?: runCatching { this[key]?.jsonPrimitive?.contentOrNull?.toIntOrNull() }.getOrNull()
        ?: runCatching { this[key]?.jsonPrimitive?.doubleOrNull?.toInt() }.getOrNull()

private fun JsonObject.dbl(key: String): Double? =
    runCatching { this[key]?.jsonPrimitive?.doubleOrNull }.getOrNull()
        ?: runCatching { this[key]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() }.getOrNull()

private fun JsonObject.bool(key: String): Boolean? =
    runCatching { this[key]?.jsonPrimitive?.booleanOrNull }.getOrNull()

private fun mimeFor(ext: String): String = when (ext.lowercase()) {
    "html", "htm" -> "text/html; charset=utf-8"
    "js", "mjs" -> "text/javascript; charset=utf-8"
    "css" -> "text/css; charset=utf-8"
    "json" -> "application/json"
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "svg" -> "image/svg+xml"
    "woff2" -> "font/woff2"
    "woff" -> "font/woff"
    "mp3" -> "audio/mpeg"
    "mp4" -> "video/mp4"
    "m4a" -> "audio/mp4"
    "ogg" -> "audio/ogg"
    "wav" -> "audio/wav"
    "flac" -> "audio/flac"
    "webm" -> "audio/webm"
    "opus" -> "audio/ogg"
    else -> "application/octet-stream"
}

private val STREAMABLE_STATUSES = setOf("queued", "playing", "played")
