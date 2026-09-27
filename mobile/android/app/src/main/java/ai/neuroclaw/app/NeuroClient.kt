package ai.neuroclaw.app

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * NeuroClaw on your PC, over its own HTTP API: POST /api/chat for a reply,
 * POST /api/captures for a photo. Authenticates with HTTP Basic using the
 * Remote Access password, which the server accepts for API calls.
 *
 * Blocking: call it off the main thread.
 */
class NeuroClient(private val settings: Settings) {

    class ServerError(val status: Int, message: String) : IOException(message)

    /** One chat turn. `history` is earlier turns as (role, content), oldest first. */
    fun chat(message: String, history: List<Pair<String, String>>): String {
        val body = JSONObject()
            .put("message", message)
            .put("history", JSONArray().apply {
                history.takeLast(12).forEach { (role, content) -> put(JSONObject().put("role", role).put("content", content)) }
            })
        val reply = post("/api/chat", body)
        return reply.optString("response", "")
    }

    /** Upload one tapped capture as training data (stored on the PC under ~/.neuroclaw/captures). */
    fun uploadCapture(jpeg: ByteArray, note: String, capturedAt: Long) {
        val body = JSONObject()
            .put("image", Base64.encodeToString(jpeg, Base64.NO_WRAP))
            .put("mime", "image/jpeg")
            .put("note", note)
            .put("capturedAt", capturedAt)
        post("/api/captures", body)
    }

    private fun post(path: String, json: JSONObject): JSONObject {
        if (!settings.configured) throw IOException("No PC address set")
        val conn = URL(settings.serverUrl + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 4000
            conn.readTimeout = 120_000
            conn.doOutput = true
            // JSON only: the server refuses other content types (CSRF protection).
            conn.setRequestProperty("Content-Type", "application/json")
            if (settings.password.isNotEmpty()) {
                val token = Base64.encodeToString("neuroclaw:${settings.password}".toByteArray(), Base64.NO_WRAP)
                conn.setRequestProperty("Authorization", "Basic $token")
            }
            conn.outputStream.use { it.write(json.toString().toByteArray()) }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (status !in 200..299) {
                val error = runCatching { JSONObject(text).optString("error") }.getOrNull()
                throw ServerError(status, if (status == 401) "Wrong password for the PC" else (error?.ifEmpty { null } ?: "PC answered $status"))
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }
}
