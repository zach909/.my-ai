package ai.neuroclaw.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The phone half of the agent's desktop layer.
 *
 * The PC-side DesktopControl (models && skills/core/desktop-control.ts) treats a
 * phone like any other place it can be pointed at: list the windows, take a
 * screenshot, type, tap. Android gives an app no way to do that across other
 * apps except an accessibility service, which the user must switch on
 * themselves in Settings -> Accessibility. Until they do, this does nothing
 * and the bridge port is closed.
 *
 * The line the desktop layer draws -- observe anything, drive only what is the
 * agent's own -- is drawn here too, and drawn in the app, not left to the PC:
 * typing, tapping and closing are refused for every window that is not
 * NeuroClaw's. (Screenshots and the window list are observation, and cover the
 * whole screen.)
 *
 * Not verified: this was written without an Android SDK to compile against or
 * a device to run on. Expect small build fixes the first time.
 */
class AgentBridgeService : AccessibilityService() {
    private var server: BridgeServer? = null
    private val executor = Executors.newSingleThreadExecutor()

    override fun onServiceConnected() {
        super.onServiceConnected()
        server = BridgeServer(this, Settings(this)).also { it.start() }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        stopBridge()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        stopBridge()
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun stopBridge() {
        server?.stop()
        server = null
    }

    /** One open window, as the bridge reports it. */
    data class Win(val id: Int, val title: String, val pkg: String, val bounds: Rect, val active: Boolean) {
        /** Only NeuroClaw's own windows are the agent's to drive. */
        fun owned(self: String): Boolean = pkg == self
    }

    fun listWindows(): List<Win> {
        val out = ArrayList<Win>()
        for (w in windows) {
            val root = w.root
            val pkg = root?.packageName?.toString() ?: ""
            val bounds = Rect()
            w.getBoundsInScreen(bounds)
            val title = w.title?.toString()?.takeIf { it.isNotEmpty() } ?: pkg
            out.add(Win(w.id, title, pkg, bounds, w.isActive))
            @Suppress("DEPRECATION") root?.recycle()
        }
        return out
    }

    fun findWindow(id: Int): Win? = listWindows().firstOrNull { it.id == id }

    /** PNG bytes of the whole screen, or null with [lastError] set. Needs Android 11. */
    @Volatile var lastError: String = ""

    fun screenshotPng(): ByteArray? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            lastError = "Taking a screenshot through accessibility needs Android 11 or newer."
            return null
        }
        lastError = ""
        val latch = CountDownLatch(1)
        var png: ByteArray? = null
        takeScreenshot(Display.DEFAULT_DISPLAY, executor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                try {
                    val hardware = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                    val copy = hardware?.copy(Bitmap.Config.ARGB_8888, false)
                    result.hardwareBuffer.close()
                    if (copy != null) {
                        val bytes = ByteArrayOutputStream()
                        copy.compress(Bitmap.CompressFormat.PNG, 100, bytes)
                        png = bytes.toByteArray()
                    }
                } finally {
                    latch.countDown()
                }
            }

            override fun onFailure(errorCode: Int) {
                lastError = "Android refused the screenshot (code $errorCode)."
                latch.countDown()
            }
        })
        if (!latch.await(10, TimeUnit.SECONDS)) lastError = "The screenshot timed out."
        if (png == null && lastError.isEmpty()) lastError = "The screenshot came back empty."
        return png
    }

    /** Append [text] to the focused text field of window [win]. Returns an error message, or null on success. */
    fun typeInto(win: Win, text: String): String? {
        val root = windows.firstOrNull { it.id == win.id }?.root ?: return "That window is no longer open."
        val field = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: return "No text field has focus in that window. Tap one first."
        // Never write into a password box, even NeuroClaw's own.
        if (field.isPassword) return "Refusing to type into a password field."
        val args = Bundle()
        args.putCharSequence(
            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
            (field.text?.toString() ?: "") + text,
        )
        return if (field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) null else "The text field did not accept the text."
    }

    /** Tap at ([x], [y]) in window [win]'s own coordinates. Returns an error message, or null on success. */
    fun tap(win: Win, x: Int, y: Int): String? {
        // A tap lands on whatever is on top at that spot. Only the foreground
        // window is known to be on top, so a background window is refused.
        if (!win.active) return "That window is not in the foreground. Bring NeuroClaw to the front first."
        val b = win.bounds
        if (x < 0 || y < 0 || x >= b.width() || y >= b.height()) {
            return "($x, $y) is outside that window, which is ${b.width()}x${b.height()}."
        }
        val path = Path()
        path.moveTo((b.left + x).toFloat(), (b.top + y).toFloat())
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .build()
        val latch = CountDownLatch(1)
        var done = false
        val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) { done = true; latch.countDown() }
            override fun onCancelled(gestureDescription: GestureDescription?) { latch.countDown() }
        }, null)
        if (!dispatched) return "Android did not accept the tap."
        latch.await(5, TimeUnit.SECONDS)
        return if (done) null else "The tap was cancelled."
    }

    /** "Close" on a phone is Back, and only for the foreground window. */
    fun back(win: Win): String? {
        if (!win.active) return "That window is not in the foreground."
        return if (performGlobalAction(GLOBAL_ACTION_BACK)) null else "Android did not accept Back."
    }

    fun launch(target: String): String? {
        val intent = packageManager.getLaunchIntentForPackage(target) ?: return "No app with the package name \"$target\" is installed."
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        return null
    }
}
