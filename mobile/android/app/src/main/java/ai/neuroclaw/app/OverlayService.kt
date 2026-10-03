package ai.neuroclaw.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.ImageView
import kotlin.math.abs

/**
 * The floating bubble, drawn over whatever app is open, so NeuroClaw is one
 * tap away like any phone assistant. Tap it to open the chat panel; drag it
 * to move it. Needs "Display over other apps" (granted from the main screen).
 * Runs as a foreground service with a notification, so it is always visible
 * that the bubble is on, and "Stop" in the notification turns it off.
 */
class OverlayService : Service() {
    private lateinit var windows: WindowManager
    private var bubble: ImageView? = null
    private var panel: ChatPanel? = null
    private var panelShown = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startInForeground()
        if (bubble == null) showBubble()
        return START_STICKY
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Assistant bubble", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(
            this, 0, Intent(this, OverlayService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_bubble)
            .setContentTitle("NeuroClaw bubble is on")
            .setContentText("Tap the bubble to talk. Nothing is recorded unless you tap Photo.")
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun showBubble() {
        windows = getSystemService(WindowManager::class.java)
        val size = (56 * resources.displayMetrics.density).toInt()
        val params = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START; x = 0; y = 300 }
        val view = ImageView(this).apply { setImageResource(R.drawable.ic_bubble) }
        var startX = 0; var startY = 0; var touchX = 0f; var touchY = 0f; var moved = false
        view.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { startX = params.x; startY = params.y; touchX = e.rawX; touchY = e.rawY; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - touchX).toInt(); val dy = (e.rawY - touchY).toInt()
                    if (abs(dx) > 10 || abs(dy) > 10) moved = true
                    params.x = startX + dx; params.y = startY + dy
                    windows.updateViewLayout(view, params); true
                }
                MotionEvent.ACTION_UP -> { if (!moved) togglePanel(); true }
                else -> false
            }
        }
        windows.addView(view, params)
        bubble = view
    }

    private fun togglePanel() {
        if (panelShown) {
            windows.removeView(panel)
            panelShown = false
            return
        }
        val metrics = resources.displayMetrics
        val params = WindowManager.LayoutParams(
            (metrics.widthPixels * 0.92).toInt(), (metrics.heightPixels * 0.6).toInt(),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // Focusable, so the keyboard can type into it.
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = (24 * metrics.density).toInt()
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        // Kept between openings, so closing the panel does not lose the conversation.
        val view = panel ?: ChatPanel(this) { togglePanel() }.also { panel = it }
        windows.addView(view, params)
        panelShown = true
    }

    override fun onDestroy() {
        val brain = Shared.brain(this)
        Shared.io.execute { brain.phone.save() }
        if (panelShown) panel?.let { windows.removeView(it) }
        bubble?.let { windows.removeView(it) }
        panel = null; bubble = null
        super.onDestroy()
    }

    companion object {
        const val CHANNEL = "bubble"
        const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "ai.neuroclaw.app.STOP"
    }
}
