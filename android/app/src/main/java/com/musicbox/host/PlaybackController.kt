package com.musicbox.host

import android.content.Context
import android.net.Uri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

class PlaybackController(
    context: Context,
    private val queue: QueueRepository,
    private val scope: CoroutineScope,
) {
    private val main = Dispatchers.Main.immediate
    private val navMutex = Mutex()
    @Volatile private var blockAutoAdvance = false
    @Volatile var playing = false
        private set
    @Volatile private var paused = false

    val exo: ExoPlayer = ExoPlayer.Builder(context.applicationContext)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        .build()

    init {
        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED && !blockAutoAdvance) {
                    playing = false
                    queue.markCurrentPlayed()
                    queue.notifyStateChange()
                    scope.launch { playNext() }
                }
            }
        })
    }

    fun isPlayable(track: TrackRow): Boolean =
        track.downloadStatus == "ready" && fileExists(track.filePath)

    suspend fun playTrack(track: TrackRow): Boolean = withContext(main) {
        if (!isPlayable(track)) {
            if (track.downloadStatus == "ready") {
                queue.setTrackDownload(track.id, "failed", error = "fileMissing")
            }
            return@withContext false
        }
        val file = File(track.filePath!!)
        exo.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
        exo.prepare()
        exo.playWhenReady = true
        exo.play()
        queue.setTrackPlaying(track.id)
        playing = true
        paused = false
        val dur = exo.duration
        if ((track.durationSec ?: 0) <= 0 && dur > 0 && dur != C.TIME_UNSET) {
            queue.setTrackDuration(track.id, (dur / 1000L).toInt())
        }
        queue.notifyStateChange()
        true
    }

    suspend fun playNext() {
        val next = queue.getNextTrack()
        if (next != null) {
            if (!playTrack(next)) queue.notifyStateChange()
        } else {
            withContext(main) { exo.stop() }
            queue.notifyStateChange()
        }
    }

    suspend fun startPlaybackIfIdle() {
        if (playing || paused) return
        val current = queue.getCurrentTrack()
        if (current != null) {
            if (!isPlayable(current)) return
            playTrack(current)
            return
        }
        playNext()
    }

    suspend fun skip() = navMutex.withLock {
        val next = queue.getNextTrack()
        val playable = next?.takeIf { isPlayable(it) }
        withManualNavigation {
            queue.markCurrentPlayed()
            playing = false
            if (playable != null) {
                if (!playTrack(playable)) {
                    withContext(main) { exo.stop() }
                    queue.notifyStateChange()
                }
            } else {
                withContext(main) { exo.stop() }
                queue.notifyStateChange()
            }
        }
    }

    suspend fun previous(): Boolean {
        val current = queue.getCurrentTrack()
        val prev = queue.getPreviousTrack(current?.id) ?: return false
        if (!isPlayable(prev)) return false
        navMutex.withLock {
            withManualNavigation {
                queue.requeueCurrentTrack()
                playing = false
                playTrack(prev)
            }
        }
        return true
    }

    suspend fun stopPlayback() = navMutex.withLock {
        withManualNavigation {
            withContext(main) { exo.stop() }
            queue.markCurrentPlayed()
            playing = false
            queue.notifyStateChange()
        }
    }

    fun isPlaybackActive(): Boolean = playing && !paused

    suspend fun pause(): Boolean = withContext(main) {
        if (queue.getCurrentTrack() == null) return@withContext false
        exo.pause()
        paused = true
        true
    }

    suspend fun resume(): Boolean = withContext(main) {
        if (queue.getCurrentTrack() == null) return@withContext false
        exo.play()
        paused = false
        true
    }

    suspend fun seekRelative(seconds: Double) = withContext(main) {
        exo.seekTo((exo.currentPosition + (seconds * 1000).toLong()).coerceAtLeast(0))
    }

    suspend fun seekTo(seconds: Double) = withContext(main) {
        exo.seekTo((seconds * 1000).toLong().coerceAtLeast(0))
    }

    suspend fun getPlaybackStatus(): PlaybackStatusDto? = withContext(main) {
        if (queue.getCurrentTrack() == null) return@withContext null
        val durationMs = exo.duration.let { if (it == C.TIME_UNSET) 0L else it }
        PlaybackStatusDto(
            time = exo.currentPosition / 1000.0,
            duration = durationMs / 1000.0,
            paused = !exo.isPlaying,
            playing = playing || exo.isPlaying,
        )
    }

    fun release() {
        exo.release()
    }

    private suspend fun withManualNavigation(block: suspend () -> Unit) {
        blockAutoAdvance = true
        try {
            block()
            delay(200)
        } finally {
            blockAutoAdvance = false
        }
    }
}
