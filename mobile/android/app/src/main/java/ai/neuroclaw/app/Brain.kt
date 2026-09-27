package ai.neuroclaw.app

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * One place the app talks to NeuroClaw, on the PC or on the phone.
 *
 * - PC reachable: the full brain answers (POST /api/chat), and anything
 *   queued while offline is sent first.
 * - PC not reachable: the phone's own copy of the network answers (the same
 *   engine, run on the phone -- see PhoneNetwork), and the message is also
 *   queued for the PC -- clearly marked as offline.
 *
 * Captures work the same way: uploaded when the PC is reachable, kept on the
 * phone and uploaded later when it is not.
 *
 * Blocking: call off the main thread.
 */
class Brain(private val context: Context) {
    val settings = Settings(context)
    private val client = NeuroClient(settings)
    /** The full network on the phone: answers whenever the PC cannot. */
    val phone = PhoneNetwork(context).also { it.start() }
    private val history = ArrayList<Pair<String, String>>()

    private val queueFile get() = File(context.filesDir, "pending-messages.jsonl")
    val capturesDir: File get() = File(context.filesDir, "captures").apply { mkdirs() }
    private val pendingCapturesDir: File get() = File(context.filesDir, "captures/pending").apply { mkdirs() }

    data class Reply(val text: String, val offline: Boolean)

    fun send(message: String): Reply {
        return try {
            flushPending()
            val reply = client.chat(message, history)
            history.add("user" to message)
            history.add("ai" to reply)
            Reply(reply, offline = false)
        } catch (e: NeuroClient.ServerError) {
            // The PC answered but refused (e.g. wrong password): not an offline case.
            Reply("PC error: ${e.message}", offline = false)
        } catch (e: IOException) {
            // The PC is not reachable: the phone's own network answers, and
            // the message is also queued so the PC sees it later.
            queueMessage(message)
            val answer = runCatching { phone.chat(message) }
            answer.fold(
                onSuccess = { a ->
                    val memory = if (a.recalled.isEmpty()) "" else "\n(OneBrain recalls: ${a.recalled.joinToString(" ")})"
                    Reply("${a.reply}$memory\n[phone network, ${a.ms} ms; also queued for your PC]", offline = true)
                },
                onFailure = { err -> Reply("Offline, and the phone's network failed: ${err.message}. Your message is queued for your PC.", offline = true) },
            )
        }
    }

    /** A capture was taken: upload it now, or keep it to upload later. Returns true if it reached the PC. */
    fun capture(photo: File, note: String): Boolean {
        val takenAt = System.currentTimeMillis()
        return try {
            client.uploadCapture(photo.readBytes(), note, takenAt)
            photo.delete()
            flushPending()
            true
        } catch (e: IOException) {
            val kept = File(pendingCapturesDir, "$takenAt.jpg")
            photo.renameTo(kept)
            File(pendingCapturesDir, "$takenAt.json").writeText(JSONObject().put("note", note).put("capturedAt", takenAt).toString())
            false
        }
    }

    fun pendingCount(): Pair<Int, Int> {
        val messages = if (queueFile.exists()) queueFile.readLines().count { it.isNotBlank() } else 0
        val captures = pendingCapturesDir.listFiles { f -> f.name.endsWith(".jpg") }?.size ?: 0
        return messages to captures
    }

    private fun queueMessage(message: String) {
        queueFile.appendText(JSONObject().put("message", message).put("at", System.currentTimeMillis()).toString() + "\n")
    }

    /** Send everything queued while offline. Stops at the first failure and keeps the rest. */
    fun flushPending() {
        if (queueFile.exists()) {
            val remaining = queueFile.readLines().filter { it.isNotBlank() }.toMutableList()
            while (remaining.isNotEmpty()) {
                val msg = runCatching { JSONObject(remaining[0]).getString("message") }.getOrNull()
                if (msg != null) {
                    // Throws if the PC drops mid-flush; what is left stays queued.
                    val reply = client.chat("(sent while offline) $msg", history)
                    history.add("user" to msg)
                    history.add("ai" to reply)
                }
                remaining.removeAt(0)
                if (remaining.isEmpty()) queueFile.delete() else queueFile.writeText(remaining.joinToString("\n", postfix = "\n"))
            }
        }
        val photos = pendingCapturesDir.listFiles { f -> f.name.endsWith(".jpg") }?.sortedBy { it.name } ?: emptyList()
        for (photo in photos) {
            val meta = File(photo.path.removeSuffix(".jpg") + ".json")
            val info = runCatching { JSONObject(meta.readText()) }.getOrNull()
            client.uploadCapture(photo.readBytes(), info?.optString("note") ?: "", info?.optLong("capturedAt") ?: photo.lastModified())
            photo.delete()
            meta.delete()
        }
    }
}
