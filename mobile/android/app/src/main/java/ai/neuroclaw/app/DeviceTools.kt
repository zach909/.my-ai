package ai.neuroclaw.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import android.telephony.TelephonyManager
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.accounts.AccountManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Native, permission-aware tools exposed to the local agent through BridgeServer.
 * Tools never bypass Android permission prompts. Sensitive write actions open a
 * user-facing Android composer/insert screen instead of silently sending or calling.
 */
class DeviceTools(private val context: Context) {
    private val appContext = context.applicationContext

    fun catalog(): JSONArray {
        val rows = JSONArray()
        fun add(name: String, description: String, permission: String? = null) {
            rows.put(JSONObject().put("name", name).put("description", description)
                .put("permission", permission ?: JSONObject.NULL))
        }
        add("device_info", "Read Android version, device model, locale, and app version.")
        add("permission_status", "List declared runtime permissions and whether each is granted.")
        add("permission_audit", "Audit every permission declared in this installed app: grant state, protection level when available, and runtime/special-access classification.")
        add("permission_catalog", "Enumerate Android permission constants available in this app compile SDK, including undeclared and privileged permissions, with declaration/grant/protection status.")
        add("check_permission", "Check the grant state of one permission declared by this app.", "permission name supplied as an argument")
        add("open_permission_settings", "Open this app's settings so the user can grant or revoke permissions.")
        add("open_exact_alarm_settings", "Open the app's exact-alarm permission settings.")
        add("open_unknown_app_settings", "Open the app's install-unknown-apps setting.")
        add("open_dnd_settings", "Open Do Not Disturb policy access settings.")
        add("open_nfc_settings", "Open Android NFC settings.")
        add("open_privacy_settings", "Open Android privacy settings.")
        add("special_access_status", "Report app-specific special access that Android exposes through settings.")
        add("network_status", "Read current network type and whether Android reports internet connectivity.")
        add("list_accounts", "List account types and names visible to this app.", Manifest.permission.GET_ACCOUNTS)
        add("sensor_status", "List available device sensor types and names.")
        add("open_voice_recognition", "Open Android speech recognition UI; the user starts and controls listening.")
        add("open_notification_settings", "Open Android notification settings for this app.")
        add("open_accessibility_settings", "Open Android Accessibility settings; enabling a service requires the user.")
        add("open_usage_settings", "Open Android usage-access settings.")
        add("open_all_files_settings", "Open Android all-files-access settings for this app.")
        add("open_battery_settings", "Open Android battery optimization settings for this app.")
        add("open_overlay_settings", "Open Android display-over-other-apps settings for this app.")
        add("open_wifi_settings", "Open Android Wi-Fi settings; the OS controls radio changes.")
        add("open_bluetooth_settings", "Open Android Bluetooth settings; the OS controls radio changes.")
        add("search_contacts", "Search contacts by name; returns names and available phone fields.", Manifest.permission.READ_CONTACTS)
        add("list_contacts", "List a bounded page of contacts.", Manifest.permission.READ_CONTACTS)
        add("list_calendar_events", "Read upcoming calendar events.", Manifest.permission.READ_CALENDAR)
        add("create_calendar_event", "Open Android's calendar event editor with the supplied title and times; the user saves it.")
        add("get_location", "Read the most recent available device location.", Manifest.permission.ACCESS_COARSE_LOCATION)
        add("list_photos", "List recent image metadata from shared media.", Manifest.permission.READ_MEDIA_IMAGES)
        add("list_videos", "List recent video metadata from shared media.", Manifest.permission.READ_MEDIA_VIDEO)
        add("list_audio", "List recent audio metadata from shared media.", Manifest.permission.READ_MEDIA_AUDIO)
        add("compose_email", "Open an email composer with recipient, subject, and body prefilled; user sends it.")
        add("list_call_log", "Read a bounded page of recent call-log entries.", Manifest.permission.READ_CALL_LOG)
        add("dial_number", "Open the phone dialer with a number prefilled; user confirms the call.")
        add("compose_sms", "Open an SMS composer with recipient and message prefilled; user sends it.")
        add("list_installed_apps", "List launchable apps installed for the current Android user.")
        add("launch_app", "Open an installed app by package name.")
        add("bluetooth_status", "Read Bluetooth availability and enabled state.", Manifest.permission.BLUETOOTH_CONNECT)
        add("open_camera", "Open the app's camera capture flow; user controls capture.", Manifest.permission.CAMERA)
        add("open_screen_capture", "Open Android's screen-capture consent flow; user must approve each capture.")
        add("open_app_settings", "Open this app's Android settings for permissions and special access.")
        return rows
    }

    fun execute(name: String, args: JSONObject = JSONObject()): JSONObject {
        return try {
            when (name) {
                "device_info" -> deviceInfo()
                "permission_status" -> permissionStatus()
                "permission_audit" -> permissionAudit()
                "permission_catalog" -> permissionCatalog()
                "check_permission" -> checkPermission(args.optString("permission", ""))
                "open_permission_settings" -> openSystemSettings("app")
                "open_exact_alarm_settings" -> openSystemSettings("alarms")
                "open_unknown_app_settings" -> openSystemSettings("unknown_apps")
                "open_dnd_settings" -> openSystemSettings("dnd")
                "open_nfc_settings" -> openSystemSettings("nfc")
                "open_privacy_settings" -> openSystemSettings("privacy")
                "special_access_status" -> specialAccessStatus()
                "network_status" -> networkStatus()
                "list_accounts" -> listAccounts()
                "sensor_status" -> sensorStatus()
                "open_voice_recognition" -> openVoiceRecognition()
                "open_notification_settings" -> openSystemSettings("notification")
                "open_accessibility_settings" -> openSystemSettings("accessibility")
                "open_usage_settings" -> openSystemSettings("usage")
                "open_all_files_settings" -> openSystemSettings("files")
                "open_battery_settings" -> openSystemSettings("battery")
                "open_overlay_settings" -> openSystemSettings("overlay")
                "open_wifi_settings" -> openSystemSettings("wifi")
                "open_bluetooth_settings" -> openSystemSettings("bluetooth")
                "search_contacts" -> contacts(args.optString("query", ""), 0, 50)
                "list_contacts" -> contacts("", args.optInt("offset", 0), bounded(args.optInt("limit", 20), 1, 50))
                "list_calendar_events" -> calendarEvents(bounded(args.optInt("limit", 20), 1, 100))
                "create_calendar_event" -> createCalendarEvent(args)
                "get_location" -> getLocation()
                "list_photos" -> listMedia(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaStore.Images.Media.DISPLAY_NAME, mediaPermission("image"), bounded(args.optInt("limit", 20), 1, 100), "photos")
                "list_videos" -> listMedia(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.DISPLAY_NAME, mediaPermission("video"), bounded(args.optInt("limit", 20), 1, 100), "videos")
                "list_audio" -> listMedia(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, MediaStore.Audio.Media.DISPLAY_NAME, mediaPermission("audio"), bounded(args.optInt("limit", 20), 1, 100), "audio")
                "list_call_log" -> callLog(bounded(args.optInt("limit", 20), 1, 50))
                "dial_number" -> dial(args.optString("number", ""))
                "compose_sms" -> composeSms(args.optString("number", ""), args.optString("message", ""))
                "compose_email" -> composeEmail(args.optString("to", ""), args.optString("subject", ""), args.optString("body", ""))
                "list_installed_apps" -> listApps()
                "launch_app" -> launchApp(args.optString("package", ""))
                "bluetooth_status" -> bluetoothStatus()
                "open_camera" -> openCapture(false, args.optString("note", ""))
                "open_screen_capture" -> openCapture(true, args.optString("note", ""))
                "open_app_settings" -> {
                    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    ok(JSONObject().put("opened", "app_settings"))
                }
                else -> JSONObject().put("ok", false).put("error", "Unknown tool: $name")
            }
        } catch (e: SecurityException) {
            JSONObject().put("ok", false).put("error", "Permission denied for $name. Grant the requested permission in Android Settings.").put("permission_error", true)
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "Tool failed")
        }
    }

    private fun ok(value: JSONObject) = JSONObject().put("ok", true).put("value", value)

    private fun granted(permission: String): Boolean =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun requirePermission(permission: String) {
        if (!granted(permission)) throw SecurityException(permission)
    }

    private fun bounded(value: Int, min: Int, max: Int) = value.coerceIn(min, max)


    private fun networkStatus(): JSONObject {
        val manager = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = manager.activeNetwork
        val caps = if (network != null) manager.getNetworkCapabilities(network) else null
        return ok(JSONObject()
            .put("connected", caps != null)
            .put("internet", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true)
            .put("validated", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
            .put("wifi", caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
            .put("cellular", caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true)
            .put("ethernet", caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true))
    }

    @Suppress("DEPRECATION")
    private fun listAccounts(): JSONObject {
        requirePermission(Manifest.permission.GET_ACCOUNTS)
        val rows = JSONArray()
        for (account in AccountManager.get(appContext).accounts.take(100)) {
            rows.put(JSONObject().put("name", account.name).put("type", account.type))
        }
        return ok(JSONObject().put("accounts", rows).put("returned", rows.length()))
    }

    private fun sensorStatus(): JSONObject {
        val manager = appContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val rows = JSONArray()
        for (sensor in manager.getSensorList(Sensor.TYPE_ALL).take(100)) {
            rows.put(JSONObject().put("name", sensor.name).put("vendor", sensor.vendor)
                .put("type", sensor.type).put("wake_up", sensor.isWakeUpSensor))
        }
        return ok(JSONObject().put("sensors", rows).put("returned", rows.length()))
    }

    private fun openVoiceRecognition(): JSONObject {
        val intent = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(appContext.packageManager) == null)
            return JSONObject().put("ok", false).put("error", "No speech recognition activity is installed.")
        context.startActivity(intent)
        return ok(JSONObject().put("opened", "speech_recognition").put("user_controls_listening", true))
    }

    private fun openSystemSettings(which: String): JSONObject {
        val action = when (which) {
            "notification" -> Settings.ACTION_APP_NOTIFICATION_SETTINGS
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "usage" -> Settings.ACTION_USAGE_ACCESS_SETTINGS
            "files" -> if (Build.VERSION.SDK_INT >= 30) Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION else Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            "battery" -> if (Build.VERSION.SDK_INT >= 23) Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS else Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            "overlay" -> if (Build.VERSION.SDK_INT >= 23) Settings.ACTION_MANAGE_OVERLAY_PERMISSION else Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "alarms" -> if (Build.VERSION.SDK_INT >= 31) Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM else Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            "unknown_apps" -> if (Build.VERSION.SDK_INT >= 26) Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES else Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            "dnd" -> Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS
            "nfc" -> Settings.ACTION_NFC_SETTINGS
            "privacy" -> Settings.ACTION_PRIVACY_SETTINGS
            "app" -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            else -> return JSONObject().put("ok", false).put("error", "Unknown settings page")
        }
        val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (which in setOf("notification", "files", "battery", "overlay", "alarms", "unknown_apps", "app")) intent.data = Uri.parse("package:${context.packageName}")
        context.startActivity(intent)
        return ok(JSONObject().put("opened_settings", which))
    }

    private fun deviceInfo(): JSONObject {
        val version = try { context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown" } catch (_: Exception) { "unknown" }
        return ok(JSONObject()
            .put("platform", "Android")
            .put("release", Build.VERSION.RELEASE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL)
            .put("locale", Locale.getDefault().toLanguageTag())
            .put("app_version", version))
    }


    private fun permissionAudit(): JSONObject {
        val rows = JSONArray()
        val pm = appContext.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 33)
            android.content.pm.PackageManager.PackageInfoFlags.of(android.content.pm.PackageManager.GET_PERMISSIONS.toLong())
        else null
        @Suppress("DEPRECATION")
        val info = if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(appContext.packageName, flags!!)
            else pm.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.GET_PERMISSIONS)
        val declared = info.requestedPermissions ?: emptyArray()
        for (permission in declared.distinct().sorted()) {
            val granted = pm.checkPermission(permission, appContext.packageName) == PackageManager.PERMISSION_GRANTED
            var protection = "unknown"
            try {
                @Suppress("DEPRECATION")
                val pi = pm.getPermissionInfo(permission, 0)
                protection = when (pi.protectionLevel and android.content.pm.PermissionInfo.PROTECTION_MASK_BASE) {
                    android.content.pm.PermissionInfo.PROTECTION_DANGEROUS -> "dangerous_runtime"
                    android.content.pm.PermissionInfo.PROTECTION_NORMAL -> "normal_install"
                    android.content.pm.PermissionInfo.PROTECTION_SIGNATURE -> "signature_or_privileged"
                    else -> "special_or_other"
                }
            } catch (_: Exception) { }
            rows.put(JSONObject().put("permission", permission).put("granted", granted).put("protection", protection))
        }
        return ok(JSONObject().put("permissions", rows).put("count", rows.length())
            .put("note", "This lists permissions declared by this app, not every permission in Android or permissions granted to other apps."))
    }

    /**
     * Enumerates the permission constants shipped in the compile SDK's Manifest.permission.
     * This is broader than the app manifest audit, but cannot enumerate OEM/custom permissions
     * or permissions introduced by a newer SDK than the one used to compile this app.
     */
    private fun permissionCatalog(): JSONObject {
        val declared = try {
            val flags = if (Build.VERSION.SDK_INT >= 33)
                android.content.pm.PackageManager.PackageInfoFlags.of(android.content.pm.PackageManager.GET_PERMISSIONS.toLong())
            else null
            @Suppress("DEPRECATION")
            val info = if (Build.VERSION.SDK_INT >= 33)
                appContext.packageManager.getPackageInfo(appContext.packageName, flags!!)
            else appContext.packageManager.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.GET_PERMISSIONS)
            info.requestedPermissions.orEmpty().toSet()
        } catch (_: Exception) { emptySet<String>() }
        val rows = JSONArray()
        var declaredCount = 0
        var grantedCount = 0
        var unavailableCount = 0
        val fields = Manifest.permission::class.java.fields
            .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && it.type == String::class.java }
            .sortedBy { it.name }
        for (field in fields) {
            val permission = try { field.get(null) as? String } catch (_: Exception) { null } ?: continue
            val isDeclared = permission in declared
            val granted = appContext.packageManager.checkPermission(permission, appContext.packageName) == PackageManager.PERMISSION_GRANTED
            var protection = "unknown_or_not_defined_on_this_device"
            try {
                @Suppress("DEPRECATION")
                val pi = appContext.packageManager.getPermissionInfo(permission, 0)
                protection = when (pi.protectionLevel and android.content.pm.PermissionInfo.PROTECTION_MASK_BASE) {
                    android.content.pm.PermissionInfo.PROTECTION_DANGEROUS -> "dangerous_runtime"
                    android.content.pm.PermissionInfo.PROTECTION_NORMAL -> "normal"
                    android.content.pm.PermissionInfo.PROTECTION_SIGNATURE -> "signature_or_privileged"
                    else -> "special_or_other"
                }
            } catch (_: Exception) { unavailableCount++ }
            if (isDeclared) declaredCount++
            if (isDeclared && granted) grantedCount++
            rows.put(JSONObject()
                .put("constant", field.name)
                .put("permission", permission)
                .put("declared_by_app", isDeclared)
                .put("granted_to_app", isDeclared && granted)
                .put("protection", protection))
        }
        return ok(JSONObject()
            .put("permissions", rows)
            .put("count", rows.length())
            .put("declared_count", declaredCount)
            .put("declared_and_granted_count", grantedCount)
            .put("not_resolved_by_package_manager", unavailableCount)
            .put("device_api_level", Build.VERSION.SDK_INT)
            .put("note", "This catalog enumerates Manifest.permission constants in the SDK used to compile this app. It does not include OEM/vendor custom permissions, newer SDK constants unavailable at compile time, or prove a permission is obtainable. Signature, privileged, role, restricted, and special-access permissions have additional OS rules."))
    }

    private fun checkPermission(permission: String): JSONObject {
        if (!permission.startsWith("android.permission.") || permission.length > 180)
            return JSONObject().put("ok", false).put("error", "Supply a fully qualified android.permission.* name.")
        val declared = try {
            val pi = if (Build.VERSION.SDK_INT >= 33)
                appContext.packageManager.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(android.content.pm.PackageManager.GET_PERMISSIONS.toLong()))
            else {
                @Suppress("DEPRECATION")
                appContext.packageManager.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.GET_PERMISSIONS)
            }
            pi.requestedPermissions?.contains(permission) == true
        } catch (_: Exception) { false }
        if (!declared) return ok(JSONObject().put("permission", permission).put("declared", false).put("granted", false))
        return ok(JSONObject().put("permission", permission).put("declared", true)
            .put("granted", appContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED))
    }

    private fun permissionStatus(): JSONObject {
        val all = JSONArray()
        val pm = appContext.packageManager
        @Suppress("DEPRECATION")
        val info = if (Build.VERSION.SDK_INT >= 33)
            pm.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(android.content.pm.PackageManager.GET_PERMISSIONS.toLong()))
        else pm.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.GET_PERMISSIONS)
        for (p in info.requestedPermissions.orEmpty().distinct().sorted()) {
            all.put(JSONObject().put("permission", p).put("granted", pm.checkPermission(p, appContext.packageName) == PackageManager.PERMISSION_GRANTED))
        }
        return ok(JSONObject().put("permissions", all).put("count", all.length())
            .put("runtime_requestable", Permissions.ALL.size)
            .put("note", "Lists every permission declared by this app; special and privileged permissions may not be grantable to ordinary apps."))
    }

    private fun contacts(query: String, offset: Int, limit: Int): JSONObject {
        requirePermission(Manifest.permission.READ_CONTACTS)
        val rows = JSONArray()
        val projection = arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME, ContactsContract.Contacts.HAS_PHONE_NUMBER)
        val selection = if (query.isBlank()) null else "${ContactsContract.Contacts.DISPLAY_NAME} LIKE ?"
        val selectionArgs = if (query.isBlank()) null else arrayOf("%$query%")
        appContext.contentResolver.query(ContactsContract.Contacts.CONTENT_URI, projection, selection, selectionArgs,
            "${ContactsContract.Contacts.DISPLAY_NAME} ASC")?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(ContactsContract.Contacts._ID)
            val nameCol = cursor.getColumnIndexOrThrow(ContactsContract.Contacts.DISPLAY_NAME)
            val phoneCol = cursor.getColumnIndexOrThrow(ContactsContract.Contacts.HAS_PHONE_NUMBER)
            var skipped = 0
            while (cursor.moveToNext() && rows.length() < limit) {
                if (skipped++ < offset) continue
                val id = cursor.getString(idCol)
                val item = JSONObject().put("id", id).put("name", cursor.getString(nameCol) ?: "")
                if (cursor.getInt(phoneCol) > 0) {
                    val phones = JSONArray()
                    appContext.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
                        "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID}=?", arrayOf(id), null)?.use { pc ->
                        while (pc.moveToNext()) phones.put(pc.getString(0))
                    }
                    item.put("phones", phones)
                }
                rows.put(item)
            }
        }
        return ok(JSONObject().put("contacts", rows).put("returned", rows.length()))
    }

    private fun calendarEvents(limit: Int): JSONObject {
        requirePermission(Manifest.permission.READ_CALENDAR)
        val rows = JSONArray()
        val now = System.currentTimeMillis()
        appContext.contentResolver.query(CalendarContract.Instances.CONTENT_URI,
            arrayOf(CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END, CalendarContract.Instances.EVENT_LOCATION),
            "${CalendarContract.Instances.END}>=?", arrayOf(now.toString()), "${CalendarContract.Instances.BEGIN} ASC")?.use { c ->
            while (c.moveToNext() && rows.length() < limit) {
                rows.put(JSONObject().put("title", c.getString(0) ?: "")
                    .put("begin_ms", c.getLong(1)).put("end_ms", c.getLong(2))
                    .put("location", c.getString(3) ?: ""))
            }
        }
        return ok(JSONObject().put("events", rows).put("returned", rows.length()))
    }

    private fun createCalendarEvent(args: JSONObject): JSONObject {
        val title = args.optString("title", "").trim()
        if (title.isEmpty()) return JSONObject().put("ok", false).put("error", "title is required")
        val intent = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, args.optLong("begin_ms", System.currentTimeMillis()))
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, args.optLong("end_ms", System.currentTimeMillis() + 3600000))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val location = args.optString("location", "")
        if (location.isNotBlank()) intent.putExtra(CalendarContract.Events.EVENT_LOCATION, location)
        context.startActivity(intent)
        return ok(JSONObject().put("opened", "calendar_editor").put("requires_user_save", true))
    }

    private fun getLocation(): JSONObject {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION))
            throw SecurityException(Manifest.permission.ACCESS_COARSE_LOCATION)
        val manager = appContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = manager.getProviders(true)
        var best: Location? = null
        for (provider in providers) {
            try {
                val candidate = manager.getLastKnownLocation(provider)
                if (candidate != null && (best == null || candidate.time > best!!.time)) best = candidate
            } catch (_: SecurityException) {}
        }
        val l = best ?: return ok(JSONObject().put("available", false).put("reason", "No cached location; enable Location and try again."))
        return ok(JSONObject().put("available", true).put("latitude", l.latitude).put("longitude", l.longitude)
            .put("accuracy_m", l.accuracy.toDouble()).put("timestamp_ms", l.time))
    }


    private fun specialAccessStatus(): JSONObject {
        val out = JSONObject()
            .put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(appContext))
            .put("modify_system_settings", Build.VERSION.SDK_INT < 23 || Settings.System.canWrite(appContext))
            .put("notifications_post", Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS))
        if (Build.VERSION.SDK_INT >= 30) out.put("all_files", android.os.Environment.isExternalStorageManager())
        if (Build.VERSION.SDK_INT >= 23) {
            val power = appContext.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            out.put("ignoring_battery_optimizations", power.isIgnoringBatteryOptimizations(appContext.packageName))
        }
        return ok(out)
    }

    private fun mediaPermission(kind: String): String =
        if (Build.VERSION.SDK_INT >= 33) when (kind) {
            "video" -> Manifest.permission.READ_MEDIA_VIDEO
            "audio" -> Manifest.permission.READ_MEDIA_AUDIO
            else -> Manifest.permission.READ_MEDIA_IMAGES
        } else Manifest.permission.READ_EXTERNAL_STORAGE

    private fun listMedia(uri: Uri, nameColumn: String, permission: String, limit: Int, key: String): JSONObject {
        requirePermission(permission)
        val rows = JSONArray()
        val dateColumn = when (key) {
            "videos" -> MediaStore.Video.Media.DATE_ADDED
            "audio" -> MediaStore.Audio.Media.DATE_ADDED
            else -> MediaStore.Images.Media.DATE_ADDED
        }
        appContext.contentResolver.query(uri, arrayOf(nameColumn, dateColumn), null, null, "$dateColumn DESC")?.use { cursor ->
            while (cursor.moveToNext() && rows.length() < limit) {
                rows.put(JSONObject().put("name", cursor.getString(0) ?: "").put("added_seconds", cursor.getLong(1)))
            }
        }
        return ok(JSONObject().put(key, rows).put("returned", rows.length()))
    }

    private fun composeEmail(to: String, subject: String, body: String): JSONObject {
        if (to.length > 500 || subject.length > 500 || body.length > 10000)
            return JSONObject().put("ok", false).put("error", "Email fields are too long")
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(to)))
            .putExtra(Intent.EXTRA_SUBJECT, subject)
            .putExtra(Intent.EXTRA_TEXT, body)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return ok(JSONObject().put("opened", "email_composer").put("requires_user_send", true))
    }

    private fun listPhotos(limit: Int): JSONObject {
        val imagePermission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE
        requirePermission(imagePermission)
        val rows = JSONArray()
        appContext.contentResolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.SIZE),
            null, null, "${MediaStore.Images.Media.DATE_ADDED} DESC")?.use { c ->
            while (c.moveToNext() && rows.length() < limit)
                rows.put(JSONObject().put("name", c.getString(0) ?: "").put("added_seconds", c.getLong(1)).put("size_bytes", c.getLong(2)))
        }
        return ok(JSONObject().put("photos", rows).put("returned", rows.length()))
    }

    private fun callLog(limit: Int): JSONObject {
        requirePermission(Manifest.permission.READ_CALL_LOG)
        val rows = JSONArray()
        appContext.contentResolver.query(CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
            null, null, "${CallLog.Calls.DATE} DESC")?.use { c ->
            while (c.moveToNext() && rows.length() < limit)
                rows.put(JSONObject().put("number", c.getString(0) ?: "").put("type", c.getInt(1))
                    .put("date_ms", c.getLong(2)).put("duration_seconds", c.getLong(3)))
        }
        return ok(JSONObject().put("calls", rows).put("returned", rows.length()))
    }

    private fun dial(number: String): JSONObject {
        if (number.isBlank() || number.length > 80) return JSONObject().put("ok", false).put("error", "A valid number is required")
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return ok(JSONObject().put("opened", "dialer").put("requires_user_confirmation", true))
    }

    private fun composeSms(number: String, message: String): JSONObject {
        if (number.isBlank() || message.isBlank()) return JSONObject().put("ok", false).put("error", "number and message are required")
        if (message.length > 5000) return JSONObject().put("ok", false).put("error", "message is too long")
        context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(number)))
            .putExtra("sms_body", message).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return ok(JSONObject().put("opened", "sms_composer").put("requires_user_send", true))
    }

    @Suppress("DEPRECATION")
    private fun listApps(): JSONObject {
        val rows = JSONArray()
        val pm = appContext.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val matches = if (Build.VERSION.SDK_INT >= 33) pm.queryIntentActivities(intent, android.content.pm.PackageManager.ResolveInfoFlags.of(0))
            else pm.queryIntentActivities(intent, 0)
        for (r in matches.take(200)) rows.put(JSONObject().put("package", r.activityInfo.packageName).put("label", r.loadLabel(pm).toString()))
        return ok(JSONObject().put("apps", rows).put("returned", rows.length()))
    }

    private fun launchApp(packageName: String): JSONObject {
        if (packageName.isBlank() || packageName.length > 255) return JSONObject().put("ok", false).put("error", "package is required")
        val intent = appContext.packageManager.getLaunchIntentForPackage(packageName)
            ?: return JSONObject().put("ok", false).put("error", "No launchable app found for package")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return ok(JSONObject().put("launched", packageName))
    }

    private fun bluetoothStatus(): JSONObject {
        val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            ?: return ok(JSONObject().put("available", false))
        val adapter: BluetoothAdapter? = manager.adapter
        if (adapter == null) return ok(JSONObject().put("available", false))
        if (Build.VERSION.SDK_INT >= 31) requirePermission(Manifest.permission.BLUETOOTH_CONNECT)
        return ok(JSONObject().put("available", true).put("enabled", adapter.isEnabled))
    }

    private fun openCapture(screen: Boolean, note: String): JSONObject {
        val target = if (screen) ScreenCaptureActivity::class.java else CaptureActivity::class.java
        context.startActivity(Intent(context, target)
            .putExtra(if (screen) ScreenCaptureActivity.EXTRA_NOTE else CaptureActivity.EXTRA_NOTE, note)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return ok(JSONObject().put("opened", if (screen) "screen_capture_consent" else "camera_capture"))
    }
}
