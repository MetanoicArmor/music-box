package com.musicbox.host

import okhttp3.tls.HeldCertificate
import java.security.KeyStore

object TlsCert {
    private const val ALIAS = "musicbox"
    private val PASS = "musicbox".toCharArray()

    fun ensure(paths: AppPaths, lanIp: String): KeyStore {
        paths.ensureDirs()
        if (paths.tlsP12.isFile && paths.tlsMeta.isFile) {
            val meta = runCatching { paths.tlsMeta.readText() }.getOrDefault("")
            if (meta.contains("\"lanIp\":\"$lanIp\"")) {
                val ks = KeyStore.getInstance("PKCS12")
                paths.tlsP12.inputStream().use { ks.load(it, PASS) }
                return ks
            }
        }
        val builder = HeldCertificate.Builder()
            .commonName("Music Box")
            .addSubjectAlternativeName("localhost")
            .addSubjectAlternativeName("127.0.0.1")
            .validityInterval(0, 825L * 24 * 60 * 60 * 1000)
        if (lanIp != "127.0.0.1") builder.addSubjectAlternativeName(lanIp)
        val cert = builder.build()
        val ks = KeyStore.getInstance("PKCS12")
        ks.load(null, PASS)
        ks.setKeyEntry(ALIAS, cert.keyPair.private, PASS, arrayOf(cert.certificate))
        paths.tlsP12.outputStream().use { ks.store(it, PASS) }
        paths.tlsMeta.writeText("""{"lanIp":"$lanIp","createdAt":${System.currentTimeMillis()}}""")
        return ks
    }

    const val alias = ALIAS
    val password: CharArray get() = PASS
}

fun getLanIp(): String {
    val candidates = mutableListOf<String>()
    val ifaces = java.net.NetworkInterface.getNetworkInterfaces() ?: return "127.0.0.1"
    for (nif in ifaces) {
        if (!nif.isUp) continue
        for (addr in nif.inetAddresses) {
            if (addr is java.net.Inet4Address && !addr.isLoopbackAddress) {
                candidates += addr.hostAddress ?: continue
            }
        }
    }
    return candidates.find { it.startsWith("192.168.") }
        ?: candidates.find { it.startsWith("10.") }
        ?: candidates.find { Regex("""^172\.(1[6-9]|2\d|3[01])\.""").containsMatchIn(it) }
        ?: candidates.firstOrNull()
        ?: "127.0.0.1"
}

fun normalizeClientIp(ip: String): String {
    if (ip.isBlank()) return "unknown"
    if (ip == "::1" || ip == "0:0:0:0:0:0:0:1") return "127.0.0.1"
    if (ip.startsWith("::ffff:")) return ip.substring(7)
    return ip
}

fun getPublicUrl(port: Int, lanIp: String = getLanIp()): String = "https://$lanIp:$port"
