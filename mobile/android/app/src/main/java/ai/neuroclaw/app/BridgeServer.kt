package ai.neuroclaw.app

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * The small HTTP API the PC's PhoneBackend (models && skills/core/desktop/
 * backends.ts) talks to. The contract is documented there; this is the other
 * end of it.
 *
 *   GET  /v1/info        what this phone can do
 *   GET  /v1/windows     [{id, title, pid, owned}]
 *   GET  /v1/screenshot  image/png
 *   POST /v1/type        {windowId, text}
 *   POST /v1/click       {windowId, x, y, button}
 *   POST /v1/close       {windowId}
 *   POST /v1/launch      {target}  (an installed app's package name)
 *
 * Plain java.net sockets: no web-server library. Every request needs the
 * bearer token from Settings; without it nothing else is reached. It listens
 * on this phone only, unless you turn on "reach from my PC over Wi-Fi".
 *
 * Ownership is enforced here as well as on the PC: typing, tapping and closing
 * are refused for any window that is not NeuroClaw's own, whatever the PC says.
 */
class BridgeServer(private val service: AgentBridgeService, private val settings: Settings) {
    @Volatile private var running = false
    private var socket: ServerSocket? = null
    private val pool = Executors.newFixedThreadPool(4)

    fun start() {
        running = true
        Thread({
            try {
                val bind = if (settings.bridgeLan) InetAddress.getByName("0.0.0.0") else InetAddress.getLoopbackAddress()
                val s = ServerSocket(PORT, 8, bind)
                socket = s
                while (running) {
                    val client = s.accept()
                    pool.execute { handle(client) }
                }
            } catch (_: Exception) {
                // Closed by stop(), or the port is taken: either way there is nothing to serve.
            }
        }, "agent-bridge").start()
    }

    fun stop() {
        running = false
        try { socket?.close() } catch (_: Exception) {}
        pool.shutdownNow()
    }

    private class Request(val method: String, val path: String, val auth: String, val body: ByteArray)

    private fun handle(client: Socket) {
        client.use {
            it.soTimeout = 5_000
            val response = try {
                val req = read(it.getInputStream()) ?: return
                route(req)
            } catch (e: Exception) {
                json(400, JSONObject().put("error", "Bad request: ${e.message}"))
            }
            val out = it.getOutputStream()
            out.write(("HTTP/1.1 ${response.status} ${if (response.status == 200) "OK" else "Error"}\r\n" +
                "Content-Type: ${response.type}\r\nContent-Length: ${response.body.size}\r\nConnection: close\r\n\r\n").toByteArray())
            out.write(response.body)
            out.flush()
        }
    }

    private fun read(input: InputStream): Request? {
        val line = readLine(input) ?: return null
        val parts = line.split(" ")
        if (parts.size < 2) return null
        var length = 0
        var auth = ""
        while (true) {
            val header = readLine(input) ?: return null
            if (header.isEmpty()) break
            val colon = header.indexOf(':')
            if (colon < 0) continue
            val name = header.substring(0, colon).trim().lowercase()
            val value = header.substring(colon + 1).trim()
            if (name == "content-length") length = value.toIntOrNull() ?: 0
            if (name == "authorization") auth = value
        }
        if (length < 0 || length > MAX_BODY) return null
        val body = ByteArray(length)
        var got = 0
        while (got < length) {
            val n = input.read(body, got, length - got)
            if (n < 0) return null
            got += n
        }
        return Request(parts[0], parts[1], auth, body)
    }

    private fun readLine(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        while (buf.size() < 8192) {
            val b = input.read()
            if (b < 0) return null
            if (b == '\n'.code) return buf.toString("UTF-8").trimEnd('\r')
            buf.write(b)
        }
        return null
    }

    private class Response(val status: Int, val type: String, val body: ByteArray)

    private fun json(status: Int, value: Any) = Response(status, "application/json", value.toString().toByteArray())
    private fun error(status: Int, message: String) = json(status, JSONObject().put("error", message))

    private fun route(req: Request): Response {
        // Constant-time, so the token cannot be guessed a byte at a time.
        val presented = req.auth.removePrefix("Bearer ").toByteArray()
        if (!MessageDigest.isEqual(presented, settings.bridgeToken.toByteArray())) return error(401, "Missing or wrong bridge token.")

        val body = if (req.body.isEmpty()) JSONObject() else JSONObject(String(req.body, Charsets.UTF_8))
        return when ("${req.method} ${req.path}") {
            "GET /v1/info" -> info()
            "GET /v1/windows" -> windows()
            "GET /v1/screenshot" -> {
                val png = service.screenshotPng()
                if (png != null) Response(200, "image/png", png) else error(500, service.lastError)
            }
            "POST /v1/type" -> withOwned(body) { win ->
                val text = body.optString("text", "")
                if (text.isEmpty() || text.length > 10_000) error(400, "text must be 1 to 10000 characters.")
                else done(service.typeInto(win, text))
            }
            "POST /v1/click" -> withOwned(body) { win ->
                if (body.optInt("button", 1) != 1) error(501, "Android taps are always the primary button; right and middle clicks do not exist.")
                else done(service.tap(win, body.optInt("x", -1), body.optInt("y", -1)))
            }
            "POST /v1/close" -> withOwned(body) { win -> done(service.back(win)) }
            "POST /v1/launch" -> done(service.launch(body.optString("target", "")))
            else -> error(404, "No such endpoint.")
        }
    }

    private fun done(problem: String?): Response =
        if (problem == null) json(200, JSONObject().put("ok", true)) else error(409, problem)

    /** Look the window up and refuse unless it is NeuroClaw's own. */
    private fun withOwned(body: JSONObject, action: (AgentBridgeService.Win) -> Response): Response {
        val id = body.optString("windowId", "").toIntOrNull() ?: return error(400, "windowId must be a window id from /v1/windows.")
        val win = service.findWindow(id) ?: return error(404, "No window with id $id.")
        if (!win.owned(service.packageName)) {
            return error(403, "That window belongs to another app. The agent can see it but not control it.")
        }
        return action(win)
    }

    private fun info(): Response {
        val features = JSONObject()
            .put("windows", true)
            .put("screenshot", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            .put("keyboard", true)
            .put("pointer", true)
            .put("moveResize", false)
            .put("settings", false)
            .put("launch", true)
        val notes = JSONArray()
            .put("Android: the agent can see every window and take screenshots, but can only type, tap and press Back in NeuroClaw's own windows.")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) notes.put("Screenshots need Android 11 or newer.")
        return json(200, JSONObject().put("platform", "android").put("features", features).put("notes", notes))
    }

    private fun windows(): Response {
        val rows = JSONArray()
        for (w in service.listWindows()) {
            rows.put(
                JSONObject()
                    .put("id", w.id.toString())
                    .put("title", w.title)
                    .put("pid", 0)
                    .put("host", "android")
                    .put("owned", w.owned(service.packageName)),
            )
        }
        return json(200, rows)
    }

    companion object {
        const val PORT = 7862
        private const val MAX_BODY = 64 * 1024
    }
}
