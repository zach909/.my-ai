package ai.neuroclaw.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Setup and a full-screen chat. NeuroClaw runs on the phone; the PC address
 * and password are only for syncing. Also the "display over other apps"
 * permission, the floating bubble, and Sync now.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val brain = Shared.brain(this)
        val settings = brain.settings
        val pad = (16 * resources.displayMetrics.density).toInt()

        val url = EditText(this).apply {
            hint = "PC address, e.g. http://192.168.1.20:3000"
            setText(settings.serverUrl)
            inputType = InputType.TYPE_TEXT_VARIATION_URI
        }
        val password = EditText(this).apply {
            hint = "Remote Access password (blank if none)"
            setText(settings.password)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        status = TextView(this)
        val save = Button(this).apply {
            text = "Save"
            setOnClickListener {
                settings.serverUrl = url.text.toString()
                settings.password = password.text.toString()
                refreshStatus()
                brain.syncInBackground()
            }
        }
        val overlay = Button(this).apply {
            text = "Allow over other apps"
            setOnClickListener {
                startActivity(Intent(AndroidSettings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }
        }
        val start = Button(this).apply {
            text = "Start bubble"
            setOnClickListener {
                if (!AndroidSettings.canDrawOverlays(this@MainActivity)) {
                    status.text = "First tap \"Allow over other apps\" and turn it on for NeuroClaw."
                    return@setOnClickListener
                }
                startForegroundService(Intent(this@MainActivity, OverlayService::class.java))
                moveTaskToBack(true)
            }
        }
        val sync = Button(this).apply {
            text = "Sync now"
            setOnClickListener {
                status.text = "Syncing with your PC..."
                Shared.background({ Shared.brain(this@MainActivity).sync() }) { result ->
                    refreshStatus()
                    status.text = "$result\n${status.text}"
                }
            }
        }
        val stop = Button(this).apply {
            text = "Stop bubble"
            setOnClickListener { startService(Intent(this@MainActivity, OverlayService::class.java).setAction(OverlayService.ACTION_STOP)) }
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(url); addView(password)
            addView(LinearLayout(context).apply { addView(save); addView(overlay) })
            addView(LinearLayout(context).apply { addView(start); addView(stop); addView(sync) })
            addView(status)
            addView(ChatPanel(context), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        })

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        refreshStatus()
    }

    override fun onPause() {
        super.onPause()
        // Keep what the phone's network learned for the next launch.
        val brain = Shared.brain(this)
        Shared.io.execute { brain.phone.save() }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        val brain = Shared.brain(this)
        val overlay = if (AndroidSettings.canDrawOverlays(this)) "allowed" else "not allowed yet"
        status.text = buildString {
            append(if (brain.settings.configured) "PC for syncing: ${brain.settings.serverUrl}" else "PC: not set (everything stays on the phone)")
            append("\nOver other apps: $overlay")
            append("\n${brain.status()}")
        }
    }
}
