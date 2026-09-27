package ai.neuroclaw.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.MediaStore
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File

/**
 * Tap-to-capture: opens the system camera for exactly one photo, keeps it on
 * the phone for the PC (it goes over on the next sync), and closes. Nothing is
 * captured unless you tap -- no background recording.
 */
class CaptureActivity : Activity() {
    private lateinit var photo: File

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val brain = Shared.brain(this)
        photo = File(brain.capturesDir, "tmp-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(this, "$packageName.captures", photo)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQUEST)
        } catch (e: Exception) {
            Toast.makeText(this, "No camera app available", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    @Deprecated("Framework Activity result API; this app avoids the androidx activity dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST || resultCode != RESULT_OK || !photo.exists() || photo.length() == 0L) {
            photo.delete()
            finish()
            return
        }
        val note = intent.getStringExtra(EXTRA_NOTE) ?: ""
        val app = applicationContext
        Shared.background({ Shared.brain(app).capture(photo, note) }) {
            Toast.makeText(app, "Photo saved; it goes to your PC on the next sync", Toast.LENGTH_SHORT).show()
        }
        finish()
    }

    companion object {
        const val REQUEST = 7
        const val EXTRA_NOTE = "note"
    }
}
