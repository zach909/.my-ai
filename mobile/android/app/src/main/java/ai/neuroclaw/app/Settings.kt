package ai.neuroclaw.app

import android.content.Context

/** Where NeuroClaw runs on your PC, and the password set in its Remote Access settings. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("neuroclaw", Context.MODE_PRIVATE)

    /** e.g. http://192.168.1.20:3000 -- the port the web app is served on. */
    var serverUrl: String
        get() = prefs.getString("serverUrl", "") ?: ""
        set(value) = prefs.edit().putString("serverUrl", value.trim().trimEnd('/')).apply()

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
