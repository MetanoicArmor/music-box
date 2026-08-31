package com.musicbox.host

object SessionEmoji {
    const val TAKEN = "avatarTaken"
    private const val RECENT_MS = 24L * 60 * 60 * 1000

    val POOL = listOf(
        "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
        "😊", "😇", "🙂", "😉", "😌", "😍", "🥰", "😘",
        "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭",
        "🤫", "🤔", "🤨", "😏", "😒", "🙄", "😬", "😴",
        "🤤", "🤠", "🥳", "😎", "🤓", "🧐", "😺", "😸",
        "😹", "😻", "😼", "😽", "🐶", "🐱", "🐭", "🐹",
        "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
        "🐷", "🐸", "🐵", "🦄", "🐙", "🦋", "🌸", "⭐",
    )

    fun recentCutoff(now: Long = System.currentTimeMillis()): Long = now - RECENT_MS

    fun pickFree(taken: Set<String>): String? {
        val free = POOL.filter { it !in taken }
        if (free.isEmpty()) return null
        return free.random()
    }

    fun nextFree(current: String?, taken: Set<String>): String? {
        val start = POOL.indexOf(current).coerceAtLeast(0)
        for (i in 1..POOL.size) {
            val candidate = POOL[(start + i) % POOL.size]
            if (candidate != current && candidate !in taken) return candidate
        }
        return null
    }
}
