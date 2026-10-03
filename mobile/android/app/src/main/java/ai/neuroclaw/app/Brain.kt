package ai.neuroclaw.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.text.DateFormat
import java.util.Date

/**
 * Offline-first NeuroClaw.
 *
 * The phone's own copy of the network (PhoneNetwork: the PC's engine, run on
 * the phone) answers every message, with or without a connection. The PC is
 * for syncing, whenever it is reachable:
 *
 *   phone -> PC  conversations (the PC's learning agent trains on them),
 *                photos (training data), yes/no examples taught on the phone;
 *   PC -> phone  the PC's OneBrain when it is newer, and its yes/no knowledge.
 *
 * Sync runs in the background after each message or photo and from the Sync
 * button; nothing waits on it.
 */
class Brain(private val context: Context) {
    val settings = Settings(context)
    private val client = NeuroClient(settings)
    val phone = PhoneNetwork(context).also { it.start() }
    private val prefs = context.getSharedPreferences("neuroclaw-sync", Context.MODE_PRIVATE)

    private val turnsFile get() = File(context.filesDir, "unsynced-turns.jsonl")
    val capturesDir: File get() = File(context.filesDir, "captures").apply { mkdirs() }
    private val pendingCapturesDir: File get() = File(context.filesDir, "captures/pending").apply { mkdirs() }
    private val syncLock = Any()

    data class Reply(val text: String, val ms: Long)

    /** Answer on the phone, then sync in the background. */
    fun send(message: String): Reply {
        val answer = runCatching { phone.chat(message) }
        val reply = answer.fold(
            onSuccess = { a ->
                val memory = if (a.recalled.isEmpty()) "" else "\n(OneBrain recalls: ${a.recalled.joinToString(" ")})"
                Reply("${a.reply}$memory", a.ms)
            },
            onFailure = { err -> Reply("The phone's network failed: ${err.message}", 0) },
        )
        turnsFile.appendText(
            JSONObject().put("message", message).put("reply", reply.text).put("at", System.currentTimeMillis()).toString() + "\n",
        )
        syncInBackground()
        return reply
    }

    /** Keep a tapped photo for the PC and sync. */
    fun capture(photo: File, note: String) {
        val takenAt = System.currentTimeMillis()
        photo.renameTo(File(pendingCapturesDir, "$takenAt.jpg"))
        File(pendingCapturesDir, "$takenAt.json").writeText(JSONObject().put("note", note).put("capturedAt", takenAt).toString())
        syncInBackground()
    }

    fun syncInBackground() {
        if (!settings.configured) return
        Thread { runCatching { sync() } }.start()
    }

    /** One sync with the PC. Returns what happened, in words. */
    fun sync(): String = synchronized(syncLock) {
        if (!settings.configured) return "No PC address set: everything stays on the phone."
        try {
            val lines = if (turnsFile.exists()) turnsFile.readLines().filter { it.isNotBlank() } else emptyList()
            val turns = JSONArray().apply { lines.forEach { runCatching { put(JSONObject(it)) } } }
            val out = phone.syncOut(clear = false)
            val response = client.sync(turns, out.optJSONArray("teach") ?: JSONArray(), out.optLong("oneBrainVersion"))

            // The PC has them now.
            if (lines.isNotEmpty()) {
                val now = if (turnsFile.exists()) turnsFile.readLines().filter { it.isNotBlank() } else emptyList()
                val added = now.drop(lines.size)
                if (added.isEmpty()) turnsFile.delete() else turnsFile.writeText(added.joinToString("\n", postfix = "\n"))
            }
            phone.syncOut(clear = true)

            val oneBrain = response.optJSONObject("oneBrain")
            val newModel = oneBrain?.optString("model")?.takeIf { it.isNotEmpty() }
            if (newModel != null) phone.saveOneBrain(newModel)
            phone.syncIn(newModel, response.optJSONObject("yesNo")?.toString())

            var photos = 0
            val files = pendingCapturesDir.listFiles { f -> f.name.endsWith(".jpg") }?.sortedBy { it.name } ?: emptyList()
            for (photo in files) {
                val meta = File(photo.path.removeSuffix(".jpg") + ".json")
                val info = runCatching { JSONObject(meta.readText()) }.getOrNull()
                client.uploadCapture(photo.readBytes(), info?.optString("note") ?: "", info?.optLong("capturedAt") ?: photo.lastModified())
                photo.delete(); meta.delete()
                photos++
            }
            prefs.edit().putLong("lastSync", System.currentTimeMillis()).apply()
            buildString {
                append("Synced: ${lines.size} conversation turn(s), $photos photo(s) sent")
                if (newModel != null) append("; got the PC's newer OneBrain")
                append(".")
            }
        } catch (e: NeuroClient.ServerError) {
            "PC refused the sync: ${e.message}"
        } catch (e: IOException) {
            "PC not reachable; everything stays on the phone until it is."
        }
    }

    fun status(): String {
        val turns = if (turnsFile.exists()) turnsFile.readLines().count { it.isNotBlank() } else 0
        val photos = pendingCapturesDir.listFiles { f -> f.name.endsWith(".jpg") }?.size ?: 0
        val last = prefs.getLong("lastSync", 0L)
        val when_ = if (last == 0L) "never" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(last))
        return "Last synced with PC: $when_. Waiting to sync: $turns turn(s), $photos photo(s)."
    }
}
