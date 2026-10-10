package ai.neuroclaw.app

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build

/**
 * Collects the app's requestable dangerous permissions, while Android keeps
 * system-only/signature permissions and special access under system control.
 * Permissions are declared in AndroidManifest.xml; this list controls runtime
 * requests only. A declaration never means the permission has been granted.
 */
object Permissions {
    /** Every dangerous permission this app declares, that a normal install can be granted. */
    val ALL: Array<String> = buildList {
        add(Manifest.permission.RECORD_AUDIO) // voice-to-text
        add(Manifest.permission.CAMERA)
        add(Manifest.permission.READ_CONTACTS); add(Manifest.permission.WRITE_CONTACTS)
        add(Manifest.permission.ACCESS_MEDIA_LOCATION)
        add(Manifest.permission.READ_CALENDAR); add(Manifest.permission.WRITE_CALENDAR)
        add(Manifest.permission.READ_CALL_LOG); add(Manifest.permission.WRITE_CALL_LOG)
        add(Manifest.permission.READ_PHONE_STATE); add(Manifest.permission.CALL_PHONE)
        if (Build.VERSION.SDK_INT >= 26) add(Manifest.permission.ANSWER_PHONE_CALLS)
        if (Build.VERSION.SDK_INT >= 26) add(Manifest.permission.READ_PHONE_NUMBERS)
        if (Build.VERSION.SDK_INT >= 29) add(Manifest.permission.ACCEPT_HANDOVER)
        add(Manifest.permission.READ_SMS); add(Manifest.permission.SEND_SMS); add(Manifest.permission.RECEIVE_SMS)
        add(Manifest.permission.RECEIVE_MMS); add(Manifest.permission.RECEIVE_WAP_PUSH)
        add(Manifest.permission.PROCESS_OUTGOING_CALLS)
        add(Manifest.permission.ACCESS_FINE_LOCATION); add(Manifest.permission.ACCESS_COARSE_LOCATION)
        add(Manifest.permission.GET_ACCOUNTS)
        if (Build.VERSION.SDK_INT >= 29) add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        if (Build.VERSION.SDK_INT >= 29) add(Manifest.permission.ACTIVITY_RECOGNITION)
        if (Build.VERSION.SDK_INT >= 31) { add(Manifest.permission.BLUETOOTH_CONNECT); add(Manifest.permission.BLUETOOTH_SCAN); add(Manifest.permission.BLUETOOTH_ADVERTISE) }
        if (Build.VERSION.SDK_INT >= 33) {
            add(Manifest.permission.READ_MEDIA_IMAGES); add(Manifest.permission.READ_MEDIA_VIDEO); add(Manifest.permission.READ_MEDIA_AUDIO)
            if (Build.VERSION.SDK_INT >= 34) add(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            add(Manifest.permission.POST_NOTIFICATIONS)
            add(Manifest.permission.NEARBY_WIFI_DEVICES)
        } else {
            add(Manifest.permission.READ_EXTERNAL_STORAGE); add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
        add(Manifest.permission.BODY_SENSORS)
        if (Build.VERSION.SDK_INT >= 34) add(Manifest.permission.BODY_SENSORS_BACKGROUND)
    }.distinct().toTypedArray()

    /** Android requires background location and background body sensors to be requested separately. */
    val BACKGROUND: Set<String> = buildSet {
        if (Build.VERSION.SDK_INT >= 29) add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        if (Build.VERSION.SDK_INT >= 34) add(Manifest.permission.BODY_SENSORS_BACKGROUND)
    }

    /**
     * Discover dangerous permissions from the installed device's permission
     * registry rather than relying only on a compile-SDK hard-coded list.
     * This automatically includes dangerous permissions added by the OS/OEM
     * when they are declared in this app's manifest. Unknown, signature-only,
     * and normal permissions are not sent to the runtime permission dialog.
     */
    fun missing(activity: Activity): List<String> {
        val pm = activity.packageManager
        val requestable = declared(activity).filter { permission ->
            try {
                @Suppress("DEPRECATION")
                val info = pm.getPermissionInfo(permission, 0)
                (info.protectionLevel and android.content.pm.PermissionInfo.PROTECTION_MASK_BASE) ==
                    android.content.pm.PermissionInfo.PROTECTION_DANGEROUS
            } catch (_: Exception) {
                false
            }
        }
        val candidates = if (requestable.isNotEmpty()) requestable else ALL.toList()
        return candidates.distinct().filter {
            activity.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
    }

    /** Ask for every one not already granted, in a single system dialog batch. */
    fun requestAll(activity: Activity, requestCode: Int = 100) {
        val need = missing(activity).filterNot { it in BACKGROUND }
        if (need.isNotEmpty()) activity.requestPermissions(need.toTypedArray(), requestCode)
    }

    /** Every permission declared in this app's installed manifest, including normal and special access. */
    fun declared(activity: Activity): List<String> {
        val info = if (Build.VERSION.SDK_INT >= 33) {
            activity.packageManager.getPackageInfo(activity.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
        } else {
            @Suppress("DEPRECATION")
            activity.packageManager.getPackageInfo(activity.packageName, PackageManager.GET_PERMISSIONS)
        }
        return info.requestedPermissions?.toList().orEmpty().distinct().sorted()
    }

    fun requestBackgroundLocation(activity: Activity, requestCode: Int = 101) {
        val p = Manifest.permission.ACCESS_BACKGROUND_LOCATION
        if (Build.VERSION.SDK_INT >= 29 && !has(activity, p)) activity.requestPermissions(arrayOf(p), requestCode)
    }

    fun requestBackgroundSensors(activity: Activity, requestCode: Int = 102) {
        val p = Manifest.permission.BODY_SENSORS_BACKGROUND
        if (Build.VERSION.SDK_INT >= 34 && !has(activity, p)) activity.requestPermissions(arrayOf(p), requestCode)
    }

    fun has(activity: Activity, permission: String): Boolean =
        activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
}
