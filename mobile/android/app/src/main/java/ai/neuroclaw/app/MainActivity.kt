package ai.neuroclaw.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Setup and full-screen chat, plus user-controlled Android runtime and special-access settings.
 * Android requires the user to approve restricted capabilities in system UI; this app cannot silently grant them.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView

    private fun settingsButton(label: String, action: String, appSpecific: Boolean = false): Button =
        Button(this).apply {
            text = label
            setOnClickListener {
                val intent = Intent(action)
                if (appSpecific) intent.data = Uri.parse("package:$packageName")
                try {
                    startActivity(intent)
                } catch (_: Exception) {
                    status.text = "This settings page is unavailable on this Android version. Open Settings and search for: $label"
                }
            }
        }

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
        val webApp = Button(this).apply {
            text = "Open web app"
            setOnClickListener {
                if (settings.serverUrl.isEmpty()) status.text = "Enter your PC address and tap Save first."
                else startActivity(Intent(this@MainActivity, WebActivity::class.java))
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
        val grant = Button(this).apply {
            text = "Grant all runtime permissions"
            setOnClickListener {
                Permissions.requestAll(this@MainActivity)
                status.text = "Requesting declared runtime permissions. Answer the system dialogs; some permissions require separate Settings pages or special eligibility."
            }
        }
        val backgroundPermissions = Button(this).apply {
            text = "Request background location / sensor access"
            setOnClickListener {
                Permissions.requestBackground(this@MainActivity)
                status.text = "Requesting eligible background permissions separately. Android may require foreground permission first or a separate Settings approval."
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
        val bridge = Button(this).apply {
            text = "Agent bridge / Accessibility"
            setOnClickListener { startActivity(Intent(AndroidSettings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }
        val bridgeLan = Button(this).apply {
            text = if (settings.bridgeLan) "Bridge: Wi-Fi on" else "Bridge: this phone only"
            setOnClickListener {
                settings.bridgeLan = !settings.bridgeLan
                text = if (settings.bridgeLan) "Bridge: Wi-Fi on" else "Bridge: this phone only"
                status.text = "Turn the bridge off and on again in Accessibility settings for this to take effect."
            }
        }
        val stop = Button(this).apply {
            text = "Stop bubble"
            setOnClickListener { startService(Intent(this@MainActivity, OverlayService::class.java).setAction(OverlayService.ACTION_STOP)) }
        }

        val specialAccess = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        specialAccess.addView(TextView(this).apply { text = "\nAdvanced access (Android opens each system-controlled settings page):" })
        specialAccess.addView(settingsButton("All files access", "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION", true))
        specialAccess.addView(settingsButton("Modify system settings", "android.settings.action.MANAGE_WRITE_SETTINGS", true))
        specialAccess.addView(settingsButton("Usage access", "android.settings.USAGE_ACCESS_SETTINGS"))
        specialAccess.addView(settingsButton("Notification access", "android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
        specialAccess.addView(settingsButton("Unrestricted background data", "android.settings.IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS", true))
        specialAccess.addView(settingsButton("Ignore battery optimizations", "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", true))
        specialAccess.addView(settingsButton("Install unknown apps", "android.settings.MANAGE_UNKNOWN_APP_SOURCES", true))
        specialAccess.addView(settingsButton("Exact alarms / reminders", "android.settings.REQUEST_SCHEDULE_EXACT_ALARM", true))
        specialAccess.addView(settingsButton("Do Not Disturb access", "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS"))
        specialAccess.addView(settingsButton("App details / other controls", AndroidSettings.ACTION_APPLICATION_DETAILS_SETTINGS, true))
        specialAccess.addView(settingsButton("Picture-in-picture settings", "android.settings.PICTURE_IN_PICTURE_SETTINGS", true))
        specialAccess.addView(settingsButton("NFC settings", "android.settings.NFC_SETTINGS"))
        specialAccess.addView(settingsButton("Privacy settings", "android.settings.PRIVACY_SETTINGS"))
        specialAccess.addView(settingsButton("App permission settings", AndroidSettings.ACTION_APPLICATION_DETAILS_SETTINGS, true))
        specialAccess.addView(settingsButton("Screen capture consent", "android.settings.SETTINGS"))

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(url); addView(password)
            addView(LinearLayout(context).apply { addView(save); addView(webApp); addView(overlay) })
            addView(LinearLayout(context).apply { addView(start); addView(stop); addView(sync) })
            addView(grant)
            addView(backgroundPermissions)
            addView(LinearLayout(context).apply { addView(bridge); addView(bridgeLan) })
            addView(specialAccess)
            addView(status)
            addView(ChatPanel(context), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(ScrollView(this).apply { addView(content) })

        Permissions.requestAll(this)
        refreshStatus()
    }

    override fun onPause() {
        super.onPause()
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
        val missing = Permissions.missing(this)
        status.text = buildString {
            append(if (brain.settings.configured) "PC for syncing: ${brain.settings.serverUrl}" else "PC: not set (everything stays on the phone)")
            append("\nOver other apps: $overlay")
            append(if (missing.isEmpty()) "\nAll declared runtime permissions granted." else "\n${missing.size} declared runtime permission(s) not yet granted -- tap \"Grant all runtime permissions\".")
            append("\nSpecial access is managed separately by Android in the buttons above.")
            append("\nAgent bridge: port ${BridgeServer.PORT}, token ${brain.settings.bridgeToken} (turn on in Accessibility settings; set NEUROCLAW_PHONE_BRIDGE_TOKEN on the PC to this token)")
            append("\n${brain.status()}")
        }
    }
}