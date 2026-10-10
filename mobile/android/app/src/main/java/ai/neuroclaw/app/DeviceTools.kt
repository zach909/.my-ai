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
        add("search_contacts", "Search contacts by name; returns names and available phone/email fields.", Manifest.permission.READ_CONTACTS)
        add("list_contacts", "List a bounded page of contacts.", Manifest.permission.READ_CONTACTS)
        add("list_calendar_events", "Read upcoming calendar events.", Manifest.permission.READ_CALENDAR)
        add("create_calendar_event", "Open Android's calendar event editor with the supplied title and times.", Manifest.permission.WRITE_CALENDAR)
        add("get_location", "Read the most recent available device location.", Manifest.permission.ACCESS_COARSE_LOCATION)
        add("list_photos", "List recent image metadata from shared media.", Manifest.permission.READ_MEDIA_IMAGES)
        add("list_call_log", "Read a bounded page of recent call-log entries.", Manifest.permission.READ_CALL_LOG)
        add("dial_number", "Open the phone dialer with a number prefilled; user confirms the call.", Manifest.permission.CALL_PHONE)
        add("compose_sms", "Open an SMS composer with recipient and message prefilled; user sends it.", Manifest.permission.SEND_SMS)
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
                "search_contacts" -> contacts(args.optString("query", ""), 0, 50)
                "list_contacts" -> contacts("", args.optInt("offset", 0), bounded(args.optInt("limit", 20), 1, 50))
                "list_calendar_events" -> calendarEvents(bounded(args.optInt("limit", 20), 1, 100))
                "create_calendar_event" -> createCalendarEvent(args)
                "get_location" -> getLocation()
                "list_photos" -> listPhotos(bounded(args.optInt("limit", 20), 1, 100))
                "list_call_log" -> callLog(bounded(args.optInt("limit", 20), 1, 50))
                "dial_number" -> dial(args.optString("number", ""))
                "compose_sms" -> composeSms(args.optString("number", ""), args.optString("message", ""))
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

    private fun permissionStatus(): JSONObject {
        val all = JSONArray()
        for (p in Permissions.ALL) all.put(JSONObject().put("permission", p).put("granted", granted(p)))
        return ok(JSONObject().put("permissions", all).put("count", all.length()))
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
