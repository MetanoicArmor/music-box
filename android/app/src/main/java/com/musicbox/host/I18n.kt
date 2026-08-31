package com.musicbox.host

import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.header

object Errors {
    enum class Lang { RU, EN }

    fun langFrom(header: String?): Lang {
        val first = header?.split(",")?.firstOrNull()?.trim()?.lowercase().orEmpty()
        return if (first.startsWith("en")) Lang.EN else Lang.RU
    }

    fun t(lang: Lang, key: String, vars: Map<String, String> = emptyMap()): String {
        val template = catalog(lang)[key] ?: catalog(Lang.RU)[key] ?: key
        return vars.entries.fold(template) { acc, (name, value) -> acc.replace("{$name}", value) }
    }

    fun t(call: ApplicationCall, key: String, vars: Map<String, String> = emptyMap()): String =
        t(langFrom(call.request.header("Accept-Language")), key, vars)

    fun has(key: String): Boolean = key in catalog(Lang.RU)

    fun localize(call: ApplicationCall, raw: String?, fallback: String = "error", minutes: Int = 10): String {
        val key = raw?.takeIf { has(it) } ?: fallback
        val vars = if (key == "trackTooLong") mapOf("minutes" to minutes.toString()) else emptyMap()
        return t(call, key, vars)
    }

    private fun catalog(lang: Lang): Map<String, String> = if (lang == Lang.EN) EN else RU

    private val RU = mapOf(
        "banned" to "Вы забанены",
        "trackTooLong" to "Трек длиннее {minutes} мин",
        "avatarTaken" to "этот аватар уже занят",
        "eventMode" to "Добавление треков отключено в event mode",
        "eventModeUploads" to "Загрузки отключены в event mode",
        "playerNotReady" to "Плеер не готов",
        "noPrevious" to "Нет предыдущего трека в истории",
        "previousFailed" to "Не удалось включить предыдущий трек",
        "wrongPassword" to "Неверный пароль",
        "tooManyVotes" to "Слишком много голосов, подождите",
        "fileTooLarge" to "Файл слишком большой",
        "emptyUpload" to "Пустой файл",
        "unsupportedType" to "Неподдерживаемый тип файла",
        "noFile" to "Файл не загружен",
        "trackNotFound" to "Трек не найден",
        "fileNotFound" to "Файл не найден",
        "sessionNotFound" to "Сессия не найдена",
        "trackRemoved" to "Трек удалён",
        "fileMissing" to "Файл отсутствует",
        "invalidSource" to "source должен быть youtube или spotify",
        "needInternet" to "Для YouTube/Spotify нужен интернет",
        "needInternetLinks" to "Для ссылок YouTube/Spotify нужен интернет",
        "inputRequired" to "Нужен input или filePath",
        "resolveFailed" to "Не удалось распознать трек",
        "sessionOrIp" to "Нужен sessionId или ip",
        "seekRequired" to "Нужен seconds или absolute",
        "notFound" to "Не найдено",
        "adminRequired" to "Нужен доступ администратора",
        "invalidRange" to "Некорректный диапазон",
        "error" to "Ошибка",
        "downloadFailed" to "ошибка скачивания",
    )

    private val EN = mapOf(
        "banned" to "You are banned",
        "trackTooLong" to "Track is longer than {minutes} min",
        "avatarTaken" to "this avatar is taken",
        "eventMode" to "Adding tracks is disabled in event mode",
        "eventModeUploads" to "Uploads disabled in event mode",
        "playerNotReady" to "Player is not ready",
        "noPrevious" to "No previous track in history",
        "previousFailed" to "Could not play the previous track",
        "wrongPassword" to "Wrong password",
        "tooManyVotes" to "Too many votes, slow down",
        "fileTooLarge" to "File too large",
        "emptyUpload" to "Empty upload",
        "unsupportedType" to "Unsupported file type",
        "noFile" to "No file uploaded",
        "trackNotFound" to "Track not found",
        "fileNotFound" to "File not found",
        "sessionNotFound" to "Session not found",
        "trackRemoved" to "Track removed",
        "fileMissing" to "File missing",
        "invalidSource" to "source must be youtube or spotify",
        "needInternet" to "Internet required for YouTube/Spotify",
        "needInternetLinks" to "Internet required for YouTube/Spotify links",
        "inputRequired" to "input or filePath required",
        "resolveFailed" to "Failed to resolve track",
        "sessionOrIp" to "sessionId or ip required",
        "seekRequired" to "seconds or absolute required",
        "notFound" to "Not found",
        "adminRequired" to "Admin access required",
        "invalidRange" to "Invalid range",
        "error" to "Error",
        "downloadFailed" to "download failed",
    )
}

fun ApplicationCall.err(key: String, vars: Map<String, String> = emptyMap()) = Errors.t(this, key, vars)
