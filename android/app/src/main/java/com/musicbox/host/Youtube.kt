package com.musicbox.host

import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class ExtractorHttp : Downloader() {
    private val client = OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .build()

    override fun execute(request: Request): Response {
        val builder = okhttp3.Request.Builder().url(request.url())
        builder.header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        for ((name, values) in request.headers()) {
            builder.removeHeader(name)
            for (value in values) builder.addHeader(name, value)
        }
        val bodyBytes = request.dataToSend()
        val method = request.httpMethod().uppercase()
        val body = if (bodyBytes != null) {
            bodyBytes.toRequestBody("application/octet-stream".toMediaTypeOrNull())
        } else if (method == "POST") {
            ByteArray(0).toRequestBody(null)
        } else {
            null
        }
        builder.method(method, body)
        client.newCall(builder.build()).execute().use { resp ->
            if (resp.code == 429) {
                throw ReCaptchaException("HTTP 429", request.url())
            }
            val headers = mutableMapOf<String, List<String>>()
            for ((name, values) in resp.headers.toMultimap()) {
                headers[name] = values
            }
            return Response(
                resp.code,
                resp.message,
                headers,
                resp.body?.string().orEmpty(),
                resp.request.url.toString(),
            )
        }
    }
}

object Youtube {
    private val inited = AtomicBoolean(false)
    private const val CHROME_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    private const val CHUNK_BYTES = 2L * 1024 * 1024
    private const val PARALLEL = 4

    private val downloadClient: OkHttpClient = run {
        val dispatcher = Dispatcher().apply {
            maxRequests = 16
            maxRequestsPerHost = 8
        }
        OkHttpClient.Builder()
            .dispatcher(dispatcher)
            .connectionPool(ConnectionPool(8, 2, TimeUnit.MINUTES))
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.MINUTES)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val req = chain.request().newBuilder()
                    .header("User-Agent", CHROME_UA)
                    .header("Accept", "*/*")
                    .header("Accept-Encoding", "identity")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Origin", "https://www.youtube.com")
                    .header("Referer", "https://www.youtube.com/")
                    .build()
                chain.proceed(req)
            }
            .build()
    }

    fun init() {
        if (inited.compareAndSet(false, true)) {
            NewPipe.init(ExtractorHttp(), Localization("ru", "RU"), ContentCountry("RU"))
        }
    }

    fun searchMany(query: String, limit: Int): List<ResolvedTrack> {
        init()
        val count = limit.coerceIn(1, 8)
        val info = SearchInfo.getInfo(
            ServiceList.YouTube,
            ServiceList.YouTube.searchQHFactory.fromQuery(query),
        )
        val out = mutableListOf<ResolvedTrack>()
        for (item in info.relatedItems) {
            if (item !is StreamInfoItem) continue
            val url = item.url ?: continue
            val thumb = item.thumbnails.firstOrNull()?.url
            out += ResolvedTrack(
                title = item.name ?: query,
                artist = item.uploaderName ?: "Unknown",
                source = "youtube",
                sourceRef = url,
                thumbnail = thumb,
                durationSec = item.duration.takeIf { it > 0 }?.toInt(),
            )
            if (out.size >= count) break
        }
        return out
    }

    fun resolveYouTubeUrl(url: String): ResolvedTrack {
        init()
        val info = StreamInfo.getInfo(url)
        return ResolvedTrack(
            title = info.name ?: "Unknown",
            artist = info.uploaderName ?: "Unknown",
            source = "youtube",
            sourceRef = info.url ?: url,
            thumbnail = info.thumbnails.firstOrNull()?.url,
            durationSec = info.duration.takeIf { it > 0 }?.toInt(),
        )
    }

    fun resolveSpotifyUrl(url: String): ResolvedTrack {
        val match = Regex("spotify\\.com/track/([a-zA-Z0-9]+)").find(url)
            ?: throw IOException("Invalid Spotify URL")
        val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).build()
        val req = okhttp3.Request.Builder()
            .url("https://open.spotify.com/oembed?url=${java.net.URLEncoder.encode(url, "UTF-8")}")
            .build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("Spotify requires internet. Could not resolve track metadata.")
            val data = JSONObject(resp.body?.string().orEmpty())
            val titleRaw = data.optString("title", "Unknown Track")
            val parts = titleRaw.split(" - ")
            val artist = if (parts.size > 1) parts[0].trim() else "Unknown"
            val title = if (parts.size > 1) parts.drop(1).joinToString(" - ").trim() else titleRaw
            return ResolvedTrack(
                title = title,
                artist = artist,
                source = "spotify",
                sourceRef = url,
                thumbnail = data.optString("thumbnail_url").ifBlank { null },
            )
        }
    }

    fun detectSource(input: String): String = when {
        input.contains("youtube.com") || input.contains("youtu.be") -> "youtube"
        input.contains("spotify.com") -> "spotify"
        else -> "search"
    }

    fun resolveInput(input: String): ResolvedTrack = when (detectSource(input)) {
        "youtube" -> resolveYouTubeUrl(input)
        "spotify" -> resolveSpotifyUrl(input)
        else -> searchMany(input, 1).firstOrNull() ?: throw IOException("YouTube search returned no results")
    }

    fun isOnline(): Boolean {
        return try {
            val client = OkHttpClient.Builder().callTimeout(3, TimeUnit.SECONDS).build()
            client.newCall(okhttp3.Request.Builder().url("https://www.google.com/generate_204").build()).execute().use { true }
        } catch (_: Exception) {
            false
        }
    }

    fun downloadAudio(youtubeUrl: String, destStem: File, maxBytes: Long): File {
        init()
        val info = StreamInfo.getInfo(youtubeUrl)
        val stream = pickBestAudio(info)
        val ext = extFor(stream)
        val dest = File(destStem.parentFile, destStem.name + ext)
        android.util.Log.i(
            "MusicBox",
            "yt download ${stream.deliveryMethod} ${stream.format?.suffix} ${stream.averageBitrate}bps",
        )
        dest.parentFile?.mkdirs()
        try {
            downloadChunked(stream.content, dest, maxBytes)
        } catch (e: Exception) {
            android.util.Log.w("MusicBox", "chunked yt download failed, falling back to single stream", e)
            dest.delete()
            downloadSingle(stream.content, dest, maxBytes)
        }
        if (!dest.isFile || dest.length() == 0L) throw IOException("yt-dlp finished but output file is missing")
        return dest
    }

    private fun pickBestAudio(info: StreamInfo): AudioStream {
        val usable = info.audioStreams.filter { !it.content.isNullOrBlank() && it.isUrl }
            .filter {
                it.deliveryMethod == DeliveryMethod.DASH ||
                    it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP
            }
        val pool = usable.ifEmpty { info.audioStreams.filter { !it.content.isNullOrBlank() } }
        return pool.maxWithOrNull(compareBy<AudioStream> { formatRank(it) }.thenBy { it.averageBitrate })
            ?: throw IOException("No audio stream")
    }

    private fun formatRank(stream: AudioStream): Int {
        val suffix = stream.format?.suffix?.lowercase().orEmpty()
        val codec = stream.codec?.lowercase().orEmpty()
        return when {
            suffix == "m4a" || suffix == "mp4" || codec.contains("mp4a") -> 4
            suffix == "webm" || suffix == "opus" || codec.contains("opus") -> 3
            stream.deliveryMethod == DeliveryMethod.DASH -> 2
            else -> 1
        }
    }

    private fun extFor(stream: AudioStream): String = when (stream.format?.suffix?.lowercase()) {
        "m4a", "mp4" -> ".m4a"
        "webm" -> ".webm"
        "opus" -> ".opus"
        "mp3" -> ".mp3"
        else -> if (stream.codec?.contains("opus", ignoreCase = true) == true) ".webm" else ".m4a"
    }

    private fun downloadChunked(url: String, dest: File, maxBytes: Long) {
        val total = probeContentLength(url)
        if (total == null || total <= CHUNK_BYTES) {
            downloadSingle(url, dest, maxBytes)
            return
        }
        if (total > maxBytes) throw IOException("File exceeds maxUploadMb")
        val ranges = ArrayList<LongRange>()
        var start = 0L
        while (start < total) {
            val end = minOf(start + CHUNK_BYTES - 1, total - 1)
            ranges += start..end
            start = end + 1
        }
        RandomAccessFile(dest, "rw").use { raf ->
            raf.setLength(total)
            val error = AtomicReference<Exception?>(null)
            val pool = Executors.newFixedThreadPool(minOf(PARALLEL, ranges.size))
            try {
                val jobs = ranges.map { range ->
                    pool.submit {
                        if (error.get() != null) return@submit
                        try {
                            downloadRange(url, range.first, range.last, raf)
                        } catch (e: Exception) {
                            error.compareAndSet(null, e)
                        }
                    }
                }
                jobs.forEach { it.get() }
            } finally {
                pool.shutdownNow()
            }
            error.get()?.let { throw it }
        }
        if (dest.length() != total) throw IOException("incomplete download ${dest.length()} != $total")
    }

    private fun probeContentLength(url: String): Long? {
        val req = okhttp3.Request.Builder().url(url).header("Range", "bytes=0-0").build()
        downloadClient.newCall(req).execute().use { resp ->
            val total = resp.header("Content-Range")?.substringAfter('/')?.toLongOrNull()
            if (total != null && total > 1) return total
            if (resp.code == 200) {
                val len = resp.body?.contentLength()?.takeIf { it > 0 }
                    ?: resp.header("Content-Length")?.toLongOrNull()
                return len?.takeIf { it > 0 }
            }
        }
        return null
    }

    private fun downloadRange(
        url: String,
        from: Long,
        to: Long,
        raf: RandomAccessFile,
    ) {
        var last: Exception? = null
        repeat(4) { attempt ->
            try {
                val req = okhttp3.Request.Builder().url(url).header("Range", "bytes=$from-$to").build()
                downloadClient.newCall(req).execute().use { resp ->
                    if (resp.code == 200 && from != 0L) throw IOException("server ignored Range")
                    if (resp.code != 206 && resp.code != 200) {
                        throw IOException("HTTP ${resp.code} for range $from-$to")
                    }
                    val body = resp.body ?: throw IOException("empty range body")
                    val buf = ByteArray(64 * 1024)
                    var offset = from
                    body.byteStream().use { input ->
                        while (true) {
                            val n = input.read(buf)
                            if (n <= 0) break
                            synchronized(raf) {
                                raf.seek(offset)
                                raf.write(buf, 0, n)
                            }
                            offset += n
                        }
                    }
                    if (offset < to + 1) throw IOException("short range $offset..$to")
                }
                return
            } catch (e: Exception) {
                last = e
                Thread.sleep(250L * (attempt + 1))
            }
        }
        throw last ?: IOException("range $from-$to failed")
    }

    private fun downloadSingle(url: String, dest: File, maxBytes: Long) {
        val req = okhttp3.Request.Builder().url(url).header("Range", "bytes=0-").build()
        downloadClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful && resp.code != 206) throw IOException("Download HTTP ${resp.code}")
            val body = resp.body ?: throw IOException("Empty body")
            var written = 0L
            dest.outputStream().use { out ->
                body.byteStream().use { input ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n <= 0) break
                        written += n
                        if (written > maxBytes) {
                            dest.delete()
                            throw IOException("File exceeds maxUploadMb")
                        }
                        out.write(buf, 0, n)
                    }
                }
            }
        }
    }
}

class TrackDownloader(
    private val queue: QueueRepository,
    private val paths: AppPaths,
    private val mediaIndex: MediaIndex,
    private val config: () -> AppConfig,
    private val startPlaybackIfIdle: suspend () -> Unit,
) {
    @Volatile private var running = false

    fun kick() {
        if (running) return
        Thread({
            running = true
            try {
                processQueue()
            } finally {
                running = false
            }
        }, "mb-download").start()
    }

    private fun processQueue() {
        while (true) {
            val next = queue.getDownloadQueue().firstOrNull() ?: break
            val latest = queue.getTrackById(next.id) ?: continue
            if (latest.status == "removed") continue
            if (latest.downloadStatus == "ready" && !latest.filePath.isNullOrBlank()) continue

            queue.setTrackDownload(latest.id, "downloading")
            queue.notifyStateChange()

            var lastError = "downloadFailed"
            var ok = false
            repeat(3) { attempt ->
                if (ok) return@repeat
                try {
                    val file = downloadOnce(latest)
                    val still = queue.getTrackById(latest.id)
                    if (still == null || still.status == "removed") {
                        file.delete()
                        ok = true
                        return@repeat
                    }
                    val tags = Tags.readFileTags(file, file.name)
                    config().durationLimitError(tags.durationSec)?.let {
                        file.delete()
                        lastError = it
                        return@repeat
                    }
                    queue.setTrackDownload(latest.id, "ready", file.absolutePath, null, tags.durationSec)
                    mediaIndex.indexFile(file, file.name)
                    paths.notifyFile(file)
                    queue.notifyStateChange()
                    kotlinx.coroutines.runBlocking { startPlaybackIfIdle() }
                    ok = true
                } catch (err: Exception) {
                    lastError = "downloadFailed"
                    android.util.Log.w("MusicBox", "download attempt ${attempt + 1}/3 failed: ${err.message}")
                }
            }
            if (!ok) {
                queue.setTrackDownload(latest.id, "failed", error = lastError.take(400))
                queue.notifyStateChange()
            }
        }
    }

    private fun downloadOnce(track: TrackRow): File {
        val url = when (track.source) {
            "youtube" -> track.sourceRef ?: throw IOException("No YouTube URL")
            "spotify" -> Youtube.searchMany("${track.artist} ${track.title}", 1).firstOrNull()?.sourceRef
                ?: throw IOException("YouTube search returned no results")
            else -> throw IOException("Cannot download source: ${track.source}")
        }
        val stem = "dl-${java.util.UUID.randomUUID()}"
        val destStem = File(paths.tempDir, stem)
        val maxBytes = config().maxUploadMb.toLong() * 1024L * 1024L
        val downloaded = Youtube.downloadAudio(url, destStem, maxBytes)
        return paths.publishAudio(
            downloaded,
            track.artist,
            track.title,
            ".${downloaded.extension}",
            deleteSource = true,
        )
    }
}
