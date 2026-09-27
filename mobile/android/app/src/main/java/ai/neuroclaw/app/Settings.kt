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
}
