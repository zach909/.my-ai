package ai.neuroclaw.app

import android.content.Context

/**
 * What was typed in the address box, made into an address: "192.168.1.20:7861" gets its http://, spaces and a
 * trailing slash go. An empty box stays empty. (Without this a missing scheme made every page fail to load and
 * the buttons looked dead.)
 */
fun normalizeServerUrl(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return ""
    val withScheme = if (trimmed.contains("://")) trimmed else "http://$trimmed"
    return withScheme.trimEnd('/')
}

/** Where NeuroClaw runs on your PC, and the password set in its Remote Access settings. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("neuroclaw", Context.MODE_PRIVATE)

    /** e.g. http://192.168.1.20:7861 -- the port the NeuroClaw server (and its web app) is on. */
    var serverUrl: String
        get() = prefs.getString("serverUrl", "") ?: ""
        set(value) = prefs.edit().putString("serverUrl", normalizeServerUrl(value)).apply()

    var password: String
        get() = prefs.getString("password", "") ?: ""
        set(value) = prefs.edit().putString("password", value).apply()

    val configured: Boolean get() = serverUrl.isNotEmpty()

    /**
     * The secret the PC must present to the agent bridge (BridgeServer.kt).
     * Made once, from the system's secure random source, and shown in the app
     * so you can paste it into NEUROCLAW_PHONE_BRIDGE_TOKEN.
     */
    val bridgeToken: String
        get() {
            val existing = prefs.getString("bridgeToken", null)
            if (!existing.isNullOrEmpty()) return existing
            val bytes = ByteArray(16)
            java.security.SecureRandom().nextBytes(bytes)
            val made = bytes.joinToString("") { "%02x".format(it) }
            prefs.edit().putString("bridgeToken", made).apply()
            return made
        }

    /** Whether the bridge listens on Wi-Fi (for a PC) rather than only on this phone. Off by default. */
    var bridgeLan: Boolean
        get() = prefs.getBoolean("bridgeLan", false)
        set(value) = prefs.edit().putBoolean("bridgeLan", value).apply()
}
