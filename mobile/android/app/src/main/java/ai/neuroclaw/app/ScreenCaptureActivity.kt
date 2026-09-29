package ai.neuroclaw.app

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.widget.Toast

/**
 * "Screen control so I can see stuff": transparent activity that asks the
 * system's screen-capture consent (a fresh grant every time -- Android does
 * not let this be remembered), then hands the granted Intent to
 * ScreenCaptureService, which takes one screenshot and uploads it as a
 * capture, tagged "screenshot" so it is training data like a tapped photo.
 *
 * Reachable from the main screen's Screen button and the floating bubble's
 * panel, exactly like CaptureActivity is for the camera.
 */
class ScreenCaptureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val manager = getSystemService(MediaProjectionManager::class.java)
        @Suppress("DEPRECATION")
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST)
    }

    @Deprecated("Framework Activity result API; this app avoids the androidx activity dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST && resultCode == RESULT_OK && data != null) {
            ScreenCaptureService.capture(this, resultCode, data, intent.getStringExtra(EXTRA_NOTE) ?: "")
        } else {
            Toast.makeText(this, "Screen capture was not allowed", Toast.LENGTH_SHORT).show()
        }
        finish()
    }

    companion object {
        const val REQUEST = 9
        const val EXTRA_NOTE = "note"
    }
}
