package ai.neuroclaw.app

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * NeuroClaw's full network, running on the phone: the PC's own engine
 * (mobile/brain, bundled into assets/neuroclaw-brain.js), executed in a hidden
 * WebView -- the phone's own fast JavaScript engine -- rather than rewritten
 * in Kotlin. Same code on the PC, Android and iPhone.
 *
 * The mesh (with OneBrain grafted in), the Zip Loop with its send neurons,
 * net-skill routing and yes/no questions all run here. What it learns is
 * saved to the app's files when the app goes to the background and restored
 * on the next launch.
 *
 * Calls block until the network answers: use them off the main thread.
 */
class PhoneNetwork(private val context: Context) {
    private var web: WebView? = null
    private val ready = CountDownLatch(1)
    private val nextId = AtomicInteger(1)
    private val pending = ConcurrentHashMap<Int, Pair<CountDownLatch, Array<String?>>>()
    private val stateFile get() = File(context.filesDir, "phone-network-state.json")

    /** Start the network. Call once, from any thread; it builds the WebView on the main thread. */
    @SuppressLint("SetJavaScriptEnabled")
    fun start() {
        Shared.main.post {
            val view = WebView(context.applicationContext)
            view.settings.javaScriptEnabled = true
            view.addJavascriptInterface(Bridge(), "NativeBridge")
            view.webViewClient = object : WebViewClient() {
                override fun onPageFinished(v: WebView, url: String?) {
                    // The model and saved state are read here, passed in as JS string literals.
                    Shared.io.execute {
                        val model = runCatching { context.assets.open("onebrain/model.json").bufferedReader().use { it.readText() } }.getOrNull()
                        val saved = runCatching { stateFile.takeIf { it.exists() }?.readText() }.getOrNull()
                        val script = "NeuroClawBrain.init(${quote(model)}, ${quote(saved)})"
                        Shared.main.post { v.evaluateJavascript(script) { ready.countDown() } }
                    }
                }
            }
            view.loadDataWithBaseURL(
                "file:///android_asset/",
                "<!doctype html><html><body><script src=\"neuroclaw-brain.js\"></script></body></html>",
                "text/html", "utf-8", null,
            )
            web = view
        }
    }

    data class Answer(val reply: String, val trained: Boolean, val recalled: List<String>, val ms: Long)

    /** One message through the phone's network (Zip Loop in, Zip Loop out). */
    fun chat(text: String, timeoutSeconds: Long = 120): Answer {
        val value = call("NeuroClawBrain.chat(${quote(text)})", timeoutSeconds, async = true)
        val recalled = value.optJSONArray("recalled")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
        return Answer(value.optString("reply"), value.optBoolean("trained"), recalled, value.optLong("ms"))
    }

    fun stats(): JSONObject = call("NeuroClawBrain.stats()", 10, async = false)

    /** Save what the network has learned. Call when the app goes to the background. */
    fun save() {
        runCatching {
            val state = callRaw("NeuroClawBrain.exportState()", 30, async = false)
            val json = JSONObject(state)
            if (json.optBoolean("ok")) stateFile.writeText(json.getString("value"))
        }
    }

    private fun call(expression: String, timeoutSeconds: Long, async: Boolean): JSONObject {
        val json = JSONObject(callRaw(expression, timeoutSeconds, async))
        if (!json.optBoolean("ok")) throw IllegalStateException(json.optString("error", "phone network error"))
        return json.optJSONObject("value") ?: JSONObject()
    }

    /** Evaluate `expression` (a string, or a Promise of one) and wait for the result. */
    private fun callRaw(expression: String, timeoutSeconds: Long, async: Boolean): String {
        if (!ready.await(60, TimeUnit.SECONDS)) throw IllegalStateException("The phone's network did not start")
        val id = nextId.getAndIncrement()
        val latch = CountDownLatch(1)
        val slot = arrayOfNulls<String>(1)
        pending[id] = latch to slot
        val script = if (async) {
            "Promise.resolve($expression).then(function(r){NativeBridge.result($id, r)})"
        } else {
            "NativeBridge.result($id, $expression)"
        }
        Shared.main.post { web?.evaluateJavascript(script, null) }
        try {
            if (!latch.await(timeoutSeconds, TimeUnit.SECONDS)) throw IllegalStateException("The phone's network took too long")
            return slot[0] ?: throw IllegalStateException("No answer from the phone's network")
        } finally {
            pending.remove(id)
        }
    }

    private inner class Bridge {
        @JavascriptInterface
        fun result(id: Int, value: String?) {
            pending[id]?.let { (latch, slot) -> slot[0] = value; latch.countDown() }
        }
    }

    private fun quote(text: String?): String = if (text == null) "undefined" else JSONObject.quote(text)
}
