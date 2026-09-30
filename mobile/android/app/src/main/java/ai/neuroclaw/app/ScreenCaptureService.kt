package ai.neuroclaw.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Takes exactly one screenshot via MediaProjection and uploads it like a
 * tapped photo (Brain.capture). Android requires screen capture to run in a
 * foreground service of type mediaProjection (enforced from API 29, and the
 * service type itself from API 34) -- this service exists to satisfy that,
 * and it stops itself the instant the one frame is captured. Nothing records
 * continuously; each screenshot is a fresh user-consented grant.
 */
class ScreenCaptureService : Service() {
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val data = intent?.getParcelableExtra<Intent>(EXTRA_DATA)
        val note = intent?.getStringExtra(EXTRA_NOTE) ?: ""
        startInForeground()
        if (data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        capture(resultCode, data, note)
        return START_NOT_STICKY
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Screen capture", NotificationManager.IMPORTANCE_LOW))
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_bubble)
            .setContentTitle("Capturing your screen")
            .setContentText("One screenshot, for your PC's training data.")
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun capture(resultCode: Int, data: Intent, note: String) {
        val projectionManager = getSystemService(MediaProjectionManager::class.java)
        val proj = projectionManager.getMediaProjection(resultCode, data)
        projection = proj

        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.getRealMetrics(metrics)
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.densityDpi

        val imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader = imageReader
        imageReader.setOnImageAvailableListener({ r ->
            val image = r.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                val plane = image.planes[0]
                val rowPadding = plane.rowStride - plane.pixelStride * width
                val bitmap = Bitmap.createBitmap(width + rowPadding / plane.pixelStride, height, Bitmap.Config.ARGB_8888)
                bitmap.copyPixelsFromBuffer(plane.buffer)
                val cropped = if (rowPadding == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, width, height)
                val jpeg = ByteArrayOutputStream().also { cropped.compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()
                val file = File(Shared.brain(this).capturesDir, "screen-${System.currentTimeMillis()}.jpg")
                file.writeBytes(jpeg)
                Shared.brain(this).capture(file, note.ifBlank { "Screenshot" })
            } finally {
                image.close()
                teardown()
            }
        }, null)

        display = proj.createVirtualDisplay(
            "neuroclaw-screen", width, height, density,
            android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.surface, null, null,
        )
    }

    private fun teardown() {
        display?.release(); display = null
        reader?.close(); reader = null
        projection?.stop(); projection = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        teardown()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL = "screen-capture"
        const val NOTIFICATION_ID = 2
        private const val EXTRA_RESULT_CODE = "resultCode"
        private const val EXTRA_DATA = "data"
        private const val EXTRA_NOTE = "note"

        fun capture(context: Context, resultCode: Int, data: Intent, note: String) {
            val intent = Intent(context, ScreenCaptureService::class.java)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_DATA, data)
                .putExtra(EXTRA_NOTE, note)
            context.startForegroundService(intent)
        }
    }
}
