package com.musicbox.host

import android.content.Context
import android.content.ContextWrapper
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import androidx.activity.ComponentActivity
import androidx.core.content.edit
import java.util.Locale

object HostLocale {
    const val PREF_KEY = "mb_lang"
    private const val PREFS = "musicbox"

    fun current(context: Context): String {
        val stored = prefs(context).getString(PREF_KEY, null)
        if (stored == "ru" || stored == "en") return stored
        val lang = systemLanguage(context)
        return if (lang.startsWith("en", ignoreCase = true)) "en" else "ru"
    }

    fun wrap(base: Context): Context {
        val locale = Locale(current(base))
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        if (Build.VERSION.SDK_INT >= 24) {
            config.setLocales(LocaleList(locale))
        }
        return base.createConfigurationContext(config)
    }

    fun findActivity(context: Context): ComponentActivity? {
        var current: Context? = context
        while (current is ContextWrapper) {
            if (current is ComponentActivity) return current
            current = current.baseContext
        }
        return null
    }

    fun set(activity: ComponentActivity, lang: String) {
        prefs(activity).edit { putString(PREF_KEY, lang) }
        val locale = Locale(lang)
        Locale.setDefault(locale)
        val app = activity.application
        val config = Configuration(app.resources.configuration)
        config.setLocale(locale)
        if (Build.VERSION.SDK_INT >= 24) {
            config.setLocales(LocaleList(locale))
        }
        @Suppress("DEPRECATION")
        app.resources.updateConfiguration(config, app.resources.displayMetrics)
        activity.recreate()
    }

    private fun systemLanguage(context: Context): String {
        val config = context.resources.configuration
        return if (Build.VERSION.SDK_INT >= 24) {
            config.locales[0].language
        } else {
            @Suppress("DEPRECATION")
            config.locale.language
        }
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
