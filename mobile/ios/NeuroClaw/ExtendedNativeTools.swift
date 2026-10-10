import AVFoundation
import AppTrackingTransparency
import CoreBluetooth
import CoreLocation
import CoreMotion
import CoreTelephony
import Contacts
import EventKit
import Foundation
import HealthKit
import HomeKit
import Intents
import LocalAuthentication
import MediaPlayer
import Photos
import Speech
import UIKit
import UniformTypeIdentifiers
import UserNotifications

/// Expanded public-API tools. iOS intentionally does not expose some system data/actions;
/// those tools return an explicit platform limitation instead of pretending they worked.
enum ExtendedNativeTools {
    static let definitions: [[String: Any]] = [
        tool("location.get_status", "Read location authorization and service availability."),
        tool("location.get_last_known", "Read a fresh location fix; prompts for When In Use permission if needed."),
        tool("photos.list_recent", "List metadata for recent photos visible to the app."),
        tool("camera.get_status", "Read camera authorization status."),
        tool("microphone.get_status", "Read microphone authorization status."),
        tool("speech.get_status", "Read speech-recognition authorization status."),
        tool("motion.get_status", "Read motion activity availability and authorization."),
        tool("motion.get_steps", "Read steps from CMPedometer for a date range; requires motion permission."),
        tool("health.get_status", "Read HealthKit availability and authorization request readiness."),
        tool("health.get_steps", "Read step count from HealthKit for an ISO-8601 date range."),
        tool("music.get_status", "Read Apple Music authorization status."),
        tool("music.search_library", "Search the device media library by title or artist."),
        tool("music.play_item", "Ask the system music player to play a library item by persistent ID."),
        tool("bluetooth.get_status", "Read Bluetooth manager state."),
        tool("bluetooth.scan", "Scan nearby Bluetooth Low Energy peripherals for a limited duration."),
        tool("cellular.get_status", "Read iOS cellular-data restriction state; cannot change it."),
        tool("background.get_status", "Read Background App Refresh status."),
        tool("tracking.get_status", "Read App Tracking Transparency authorization status."),
        tool("tracking.request_authorization", "Show the system tracking authorization prompt."),
        tool("auth.authenticate", "Authenticate with device passcode or biometrics."),
        tool("siri.get_status", "Read Siri authorization where the public API exposes it."),
        tool("files.pick", "Open the iOS document picker; requires a foreground UI interaction."),
        tool("files.get_access_model", "Explain iOS file sandbox and document-picker access."),
        tool("local_network.get_status", "Report whether the agent bridge is configured for LAN access."),
        tool("focus.get_status", "Return the public-API limitation for reading the user's Focus mode."),
        tool("phone.get_capabilities", "Report supported phone-call integration limits."),
        tool("messages.get_capabilities", "Report SMS/iMessage integration limits."),
        tool("email.get_capabilities", "Report email integration limits."),
        tool("call_history.get_capabilities", "Report call-history access limits."),
        tool("screen_recording.get_capabilities", "Report screen/system-audio capture limits."),
        tool("accessibility.get_capabilities", "Report cross-app accessibility control limits."),
        tool("accounts.get_capabilities", "Report account-information access limits."),
        tool("photos.get_status", "Read Photos library authorization status."),
        tool("photos.save", "Save an image only through an explicit user-facing flow."),
        tool("camera.capture_photo", "Capture a photo using a foreground camera interface."),
        tool("microphone.record", "Record audio through a foreground, user-visible recording interface."),
        tool("microphone.stop_recording", "Stop an active in-app recording session."),
        tool("voice_activation.get_status", "Report voice activation and speech recognition availability."),
        tool("contacts.create", "Create a contact after explicit user confirmation."),
        tool("contacts.update", "Update a contact after explicit user confirmation."),
        tool("calendar.create_event", "Create a calendar event after explicit user confirmation."),
        tool("calendar.update_event", "Update a calendar event after explicit user confirmation."),
        tool("calendar.delete_event", "Delete a calendar event after explicit user confirmation."),
        tool("reminders.create", "Create a reminder after explicit user confirmation."),
        tool("reminders.complete", "Mark a reminder completed after explicit user confirmation."),
        tool("reminders.delete", "Delete a reminder after explicit user confirmation."),
        tool("files.read_selected", "Read a user-selected document using a security-scoped URL."),
        tool("files.export", "Export a file through a user-facing share or document picker."),
        tool("network.local_discovery", "Discover local-network services only after iOS permission."),
        tool("nearby.start_session", "Start a Nearby Interaction session where supported."),
        tool("nearby.stop_session", "Stop an active Nearby Interaction session."),
        tool("homekit.get_status", "Report HomeKit entitlement and authorization readiness."),
        tool("homekit.list_homes", "List HomeKit homes after capability setup and authorization."),
        tool("homekit.list_accessories", "List HomeKit accessories after capability setup and authorization."),
        tool("homekit.control_accessory", "Control a HomeKit accessory with explicit confirmation."),
        tool("notifications.get_status", "Read notification authorization settings."),
        tool("voice_activation.request", "Explain user-driven Siri/Shortcuts setup for voice activation."),
        tool("capabilities.catalog", "List supported iOS tool coverage and system-enforced limitations."),
        tool("permissions.request_all", "Request each permission category that iOS lets this app request; some require separate user flows or Apple entitlements."),
        tool("permissions.request_location", "Request location access."),
        tool("permissions.request_contacts", "Request Contacts access."),
        tool("permissions.request_calendar", "Request Calendar access."),
        tool("permissions.request_reminders", "Request Reminders access."),
        tool("permissions.request_photos", "Request Photos library read and write access."),
        tool("permissions.request_photos_add_only", "Request add-only Photos library access without reading the library."),
        tool("permissions.request_microphone", "Request microphone access."),
        tool("permissions.request_camera", "Request camera access."),
        tool("permissions.request_speech", "Request speech recognition access."),
        tool("permissions.request_motion", "Request motion and fitness access."),
        tool("permissions.request_music", "Request media library / Apple Music access."),
        tool("permissions.request_notifications", "Request notification authorization; critical alerts still require Apple's entitlement."),
        tool("permissions.request_tracking", "Request App Tracking Transparency authorization."),
        tool("permissions.request_bluetooth", "Trigger Bluetooth authorization through the public API."),
        tool("permissions.request_health", "Request HealthKit step-count access; HealthKit entitlement is required."),
        tool("permissions.request_homekit", "Request HomeKit authorization; HomeKit entitlement and eligible signing are required."),
        tool("permissions.request_siri", "Request Siri authorization for App Intents / Shortcuts."),
        tool("permissions.request_biometrics", "Prompt for Face ID / Touch ID authentication."),
        tool("permissions.catalog", "Return an inventory of requestable iOS permissions, user-controlled settings, entitlement-gated capabilities, and platform-blocked access."),
        tool("nearby.get_capabilities", "Report Nearby Interaction support and its entitlement/session requirements."),
        tool("nfc.get_capabilities", "Report NFC reader availability and required entitlements."),
        tool("critical_alerts.get_capabilities", "Report critical notification alert restrictions."),
        tool("research_sensors.get_capabilities", "Report research sensor data restrictions and entitlement requirements.")
    ]

    private static func tool(_ name: String, _ description: String) -> [String: Any] {
        let properties: [String: Any]
        let required: [String]
        switch name {
        case "motion.get_steps", "health.get_steps", "calendar.list_events":
            properties = ["start": ["type": "string", "description": "ISO-8601 start date"], "end": ["type": "string", "description": "ISO-8601 end date"]]
            required = ["start", "end"]
        case "music.search_library", "contacts.search":
            properties = ["query": ["type": "string", "description": "Search text"]]
            required = ["query"]
        case "music.play_item":
            properties = ["persistent_id": ["type": "number", "description": "Media-library persistent ID"]]
            required = ["persistent_id"]
        case "photos.save":
            properties = ["image_base64": ["type": "string", "description": "Base64-encoded JPEG or PNG image data"], "filename": ["type": "string"]]
            required = ["image_base64"]
        case "contacts.create":
            properties = ["given_name": ["type": "string"], "family_name": ["type": "string"], "phone": ["type": "string"], "email": ["type": "string"]]
            required = ["given_name"]
        case "contacts.update":
            properties = ["identifier": ["type": "string"], "given_name": ["type": "string"], "family_name": ["type": "string"], "phone": ["type": "string"], "email": ["type": "string"]]
            required = ["identifier"]
        case "calendar.create_event":
            properties = ["title": ["type": "string"], "start": ["type": "string"], "end": ["type": "string"], "notes": ["type": "string"], "location": ["type": "string"]]
            required = ["title", "start", "end"]
        case "calendar.update_event":
            properties = ["identifier": ["type": "string"], "title": ["type": "string"], "start": ["type": "string"], "end": ["type": "string"], "notes": ["type": "string"], "location": ["type": "string"]]
            required = ["identifier"]
        case "calendar.delete_event", "reminders.complete", "reminders.delete":
            properties = ["identifier": ["type": "string"]]
            required = ["identifier"]
        case "reminders.create":
            properties = ["title": ["type": "string"], "due": ["type": "string"], "notes": ["type": "string"]]
            required = ["title"]
        case "bluetooth.scan":
            properties = ["seconds": ["type": "number", "minimum": 1, "maximum": 10]]
            required = []
        case "files.export":
            properties = ["filename": ["type": "string"], "data_base64": ["type": "string"]]
            required = ["data_base64"]
        default:
            properties = [:]
            required = []
        }
        var schema: [String: Any] = ["type": "object", "properties": properties, "additionalProperties": false]
        if !required.isEmpty { schema["required"] = required }
        return ["name": name, "description": description, "input_schema": schema]
    }

    static func invoke(name: String, arguments: [String: Any]) async -> (Int, [String: Any]) {
        switch name {
        case "location.get_status":
            let manager = CLLocationManager()
            return (200, ["authorization": locationLabel(manager.authorizationStatus), "services_enabled": CLLocationManager.locationServicesEnabled(), "accuracy": manager.accuracyAuthorization == .fullAccuracy ? "full" : "reduced"])
        case "location.get_last_known":
            return await LocationTool.read()
        case "photos.list_recent":
            return await listRecentPhotos()
        case "camera.get_status":
            return (200, ["authorization": AVCaptureDevice.authorizationStatus(for: .video).rawValue])
        case "microphone.get_status":
            return (200, ["authorization": AVAudioSession.sharedInstance().recordPermission.rawValue])
        case "speech.get_status":
            return (200, ["authorization": SFSpeechRecognizer.authorizationStatus().rawValue, "available": SFSpeechRecognizer(locale: Locale.current)?.isAvailable ?? false])
        case "motion.get_status":
            return (200, ["activity_available": CMMotionActivityManager.isActivityAvailable(), "pedometer_available": CMPedometer.isStepCountingAvailable(), "authorization": CMMotionActivityManager.authorizationStatus().rawValue])
        case "motion.get_steps":
            guard let start = dateArg(arguments["start"]), let end = dateArg(arguments["end"]), end > start else { return (400, ["error": "start and end must be ISO-8601 dates, with end after start"]) }
            return await MotionTool.steps(start: start, end: end)
        case "health.get_status":
            return (200, ["available": HKHealthStore.isHealthDataAvailable(), "note": "iOS does not reveal whether read permission was granted; a query is required to test access."])
        case "health.get_steps":
            guard let start = dateArg(arguments["start"]), let end = dateArg(arguments["end"]), end > start else { return (400, ["error": "start and end must be ISO-8601 dates, with end after start"]) }
            return await HealthTool.steps(start: start, end: end)
        case "music.get_status":
            return (200, ["authorization": MPMediaLibrary.authorizationStatus().rawValue])
        case "music.search_library":
            guard let query = arguments["query"] as? String, !query.isEmpty else { return (400, ["error": "query is required"]) }
            return await searchMusic(query)
        case "music.play_item":
            guard let id = arguments["persistent_id"] as? NSNumber else { return (400, ["error": "persistent_id is required"]) }
            return await playMusic(id: MPMediaEntityPersistentID(id.uint64Value))
        case "bluetooth.get_status":
            return (200, ["state": BluetoothStatus.shared.stateLabel])
        case "bluetooth.scan":
            return await BluetoothStatus.shared.scan(seconds: min(max((arguments["seconds"] as? NSNumber)?.doubleValue ?? 5, 1), 10))
        case "cellular.get_status":
            let state = CTCellularData().restrictedState
            return (200, ["state": state == .restricted ? "restricted" : state == .notRestricted ? "allowed" : "unknown"])
        case "background.get_status":
            let status = await MainActor.run { UIApplication.shared.backgroundRefreshStatus }
            return (200, ["state": status == .available ? "available" : status == .denied ? "denied" : status == .restricted ? "restricted" : "unknown"])
        case "tracking.get_status":
            return (200, ["authorization": ATTrackingManager.trackingAuthorizationStatus.rawValue])
        case "tracking.request_authorization":
            let status = await ATTrackingManager.requestTrackingAuthorization()
            return (200, ["authorization": status.rawValue, "note": "Only relevant if the app actually performs tracking as defined by Apple."])
        case "auth.authenticate":
            let context = LAContext()
            var error: NSError?
            guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return (409, ["error": error?.localizedDescription ?? "device_authentication_unavailable"]) }
            do {
                let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Confirm your identity before NeuroClaw performs this action.")
                return (200, ["authenticated": ok])
            } catch {
                return (403, ["authenticated": false, "error": error.localizedDescription])
            }
        case "siri.get_status":
            return (200, ["note": "Use App Intents and Shortcuts for Siri integration. iOS does not provide a general Siri permission status API for arbitrary app automation."])
        case "files.pick", "files.read_selected":
            return await DocumentPickerFlow.pickFile()
        case "files.get_access_model":
            return (200, ["model": "sandboxed", "supported": ["UIDocumentPickerViewController", "security-scoped URLs", "app container"], "not_supported": "Unrestricted filesystem access"])
        case "local_network.get_status":
            return (200, ["bridge_lan_enabled": UserDefaults.standard.bool(forKey: "bridgeLan"), "note": "Local network access is governed by iOS privacy prompts and app configuration."])
        case "focus.get_status":
            return (200, ["supported": false, "reason": "Public iOS APIs do not expose the current personal Focus mode to ordinary apps."])
        case "phone.get_capabilities":
            return limitation("iOS does not provide general call control or unrestricted call-state access. Use tel: URLs to let the user initiate a call.")
        case "messages.get_capabilities":
            return limitation("iOS does not let third-party apps read iMessage/SMS inboxes or send messages silently. Use an explicit MessageUI compose sheet.")
        case "email.get_capabilities":
            return limitation("iOS does not grant general mailbox access. Use an explicit mail compose sheet or a user-authorized provider integration.")
        case "call_history.get_capabilities":
            return limitation("Third-party iOS apps cannot read the system call history.")
        case "screen_recording.get_capabilities":
            return limitation("ScreenCaptureKit is not a general iPhone cross-app capture API. ReplayKit recording requires system/user-visible recording flows and cannot secretly capture other apps.")
        case "accessibility.get_capabilities":
            return limitation("iOS does not expose macOS-style Accessibility permission or arbitrary cross-app UI automation to ordinary apps.")
        case "accounts.get_capabilities":
            return limitation("iOS does not expose a universal list of device accounts, passwords, or account credentials to apps.")
        case "capabilities.catalog":
            return (200, ["implemented_tools": NativeToolRegistry.definitions.compactMap { $0["name"] as? String } + definitions.compactMap { $0["name"] as? String }, "platform_limits": ["No unrestricted filesystem access", "No reading SMS/iMessage, call history, or arbitrary email inboxes", "No arbitrary cross-app screen capture or tap injection", "No changing system permissions or settings on behalf of the user", "Background execution is scheduled and system-controlled", "HealthKit/HomeKit require valid entitlements and user authorization"]])
        case "permissions.request_all":
            let statuses = await Permissions.requestAll()
            return (200, ["requested": statuses.map { ["id": $0.id, "label": $0.label, "result": $0.result] }, "note": "iOS may suppress repeat prompts, require foreground UI, or require separate entitlement approval. Some settings cannot be requested by apps."])
        case "permissions.request_location":
            return (200, ["permission": "location", "result": await Permissions.requestLocation()])
        case "permissions.request_contacts":
            return (200, ["permission": "contacts", "result": await Permissions.requestContacts()])
        case "permissions.request_calendar":
            return (200, ["permission": "calendar", "result": await Permissions.requestCalendar()])
        case "permissions.request_reminders":
            return (200, ["permission": "reminders", "result": await Permissions.requestReminders()])
        case "permissions.request_photos":
            return (200, ["permission": "photos_read_write", "result": await Permissions.requestPhotos()])
        case "permissions.request_photos_add_only":
            let status = await withCheckedContinuation { continuation in
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { value in continuation.resume(returning: value) }
            }
            return (200, ["permission": "photos_add_only", "authorization": status.rawValue])
        case "permissions.request_microphone":
            return (200, ["permission": "microphone", "result": await Permissions.requestMicrophone()])
        case "permissions.request_camera":
            return (200, ["permission": "camera", "result": await Permissions.requestCamera()])
        case "permissions.request_speech":
            return (200, ["permission": "speech_recognition", "result": await Permissions.requestSpeechRecognition()])
        case "permissions.request_motion":
            return (200, ["permission": "motion_fitness", "result": await Permissions.requestMotion()])
        case "permissions.request_music":
            return (200, ["permission": "media_library", "result": await Permissions.requestAppleMusic()])
        case "permissions.request_notifications":
            return (200, ["permission": "notifications", "result": await Permissions.requestNotifications()])
        case "permissions.request_tracking":
            return (200, ["permission": "app_tracking_transparency", "result": await Permissions.requestTracking()])
        case "permissions.request_bluetooth":
            return (200, ["permission": "bluetooth", "result": await Permissions.requestBluetooth()])
        case "permissions.request_health":
            return (200, ["permission": "healthkit", "result": await Permissions.requestHealth()])
        case "permissions.request_homekit":
            return (200, ["permission": "homekit", "result": await Permissions.requestHomeKit()])
        case "permissions.request_siri":
            return (200, ["permission": "siri", "result": await Permissions.requestSiri()])
        case "permissions.request_biometrics":
            return (200, ["permission": "biometrics", "result": await Permissions.requestBiometrics()])
        case "permissions.catalog":
            return (200, ["requestable": ["location_when_in_use", "location_always", "contacts", "calendar", "reminders", "photos_read_write", "photos_add_only", "camera", "microphone", "speech_recognition", "motion_fitness", "healthkit_data_types", "media_library", "bluetooth", "local_network", "notifications", "app_tracking_transparency", "siri_authorization", "face_id_or_touch_id_authentication", "homekit"], "settings_only_or_system_managed": ["Background App Refresh", "Cellular data access restrictions", "per-app Local Network toggle", "notification presentation settings", "system permission changes in Settings"], "requires_entitlement_or_special_approval": ["HealthKit", "HomeKit", "critical alerts", "Nearby Interaction", "NFC reader sessions", "clinical health records", "research sensor access"], "not_available_to_ordinary_third_party_apps": ["SMS/iMessage inbox access", "system call history", "general mailbox access without provider authorization", "passwords and arbitrary device accounts", "reading current Focus mode", "unrestricted filesystem access", "arbitrary cross-app UI control or silent screen capture"], "note": "iOS has no single grant-all permission. Each authorization is separate, user-controlled, and constrained by API, entitlement, device, and App Store policy."])
        case "nearby.get_capabilities":
            return limitation("Nearby Interaction needs supported hardware, a valid Nearby Interaction entitlement, discovery-token exchange, and a foreground session. There is no standalone permission prompt to grant from this bridge.")
        case "nfc.get_capabilities":
            return limitation("NFC reader sessions require supported hardware, the matching NFC capability/entitlement, and a foreground reader session. iOS does not offer general-purpose NFC access.")
        case "critical_alerts.get_capabilities":
            return limitation("Critical notifications require Apple's special critical-alert entitlement and user authorization. A normal notification permission grant cannot enable them.")
        case "research_sensors.get_capabilities":
            return limitation("Research sensor and clinical data access is restricted to eligible programs, entitlements, APIs, and approvals. Ordinary apps cannot unlock it by requesting a generic permission.")
        case "photos.get_status":
            return (200, ["authorization": PHPhotoLibrary.authorizationStatus(for: .readWrite).rawValue])
        case "notifications.get_status":
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            return (200, ["authorization": settings.authorizationStatus.rawValue, "alerts": settings.alertSetting.rawValue, "sounds": settings.soundSetting.rawValue, "badges": settings.badgeSetting.rawValue])
        case "voice_activation.get_status", "voice_activation.request":
            return (200, ["speech_authorization": SFSpeechRecognizer.authorizationStatus().rawValue, "siri_setup": "Use App Intents and Shortcuts; apps cannot enable always-listening activation themselves."])
        case "photos.save":
            return await savePhoto(arguments)
        case "files.export":
            return await DocumentPickerFlow.exportFile(arguments)
        case "camera.capture_photo":
            return await CameraCaptureFlow.capturePhoto()
        case "microphone.record":
            return await AudioRecordingFlow.shared.start()
        case "microphone.stop_recording":
            return await AudioRecordingFlow.shared.stop()
        case "contacts.create":
            return await createContact(arguments)
        case "contacts.update":
            return await updateContact(arguments)
        case "calendar.create_event":
            return await saveCalendarEvent(arguments, identifier: nil)
        case "calendar.update_event":
            return await saveCalendarEvent(arguments, identifier: arguments["identifier"] as? String)
        case "calendar.delete_event":
            return await deleteCalendarEvent(arguments)
        case "reminders.create":
            return await saveReminder(arguments)
        case "reminders.complete":
            return await completeReminder(arguments)
        case "reminders.delete":
            return await deleteReminder(arguments)
        case "homekit.get_status", "homekit.list_homes", "homekit.list_accessories", "homekit.control_accessory":
            return (501, ["error": "homekit_requires_foreground_setup", "detail": "HomeKit requires the entitlement and an app-owned manager lifecycle. No accessory was changed."])
        case "network.local_discovery", "nearby.start_session", "nearby.stop_session":
            return (409, ["error": "foreground_or_capability_flow_required", "detail": "This operation requires a foreground UIKit flow, a configured entitlement, or a supported user-selected resource. No device data was changed."])
        default:
            return (404, ["error": "unknown_extended_tool", "name": name])
        }
    }



    private static func savePhoto(_ a: [String: Any]) async -> (Int, [String: Any]) {
        guard let encoded = a["image_base64"] as? String, let data = Data(base64Encoded: encoded), let image = UIImage(data: data) else {
            return (400, ["error": "valid_base64_image_required"])
        }
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        if status == .denied || status == .restricted { return (403, ["error": "photos_add_permission_denied", "status": status.rawValue]) }
        if status == .notDetermined {
            let granted = await withCheckedContinuation { c in
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { value in c.resume(returning: value == .authorized || value == .limited) }
            }
            guard granted else { return (403, ["error": "photos_add_permission_denied"]) }
        }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetChangeRequest.creationRequestForAsset(from: image)
                request.creationDate = Date()
            }
            return (200, ["ok": true, "saved": true, "format": data.starts(with: [0x89, 0x50, 0x4E, 0x47]) ? "png" : "image"])
        } catch { return (500, ["error": "photo_save_failed", "detail": error.localizedDescription]) }
    }

    private static func contactsStoreWithAccess() async -> CNContactStore? {
        let store = CNContactStore()
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .authorized { return store }
        guard status == .notDetermined else { return nil }
        let granted = await withCheckedContinuation { c in store.requestAccess(for: .contacts) { ok, _ in c.resume(returning: ok) } }
        return granted ? store : nil
    }

    private static func createContact(_ a: [String: Any]) async -> (Int, [String: Any]) {
        guard let given = a["given_name"] as? String, !given.isEmpty else { return (400, ["error": "given_name_required"]) }
        guard let store = await contactsStoreWithAccess() else { return (403, ["error": "contacts_permission_denied"]) }
        let c = CNMutableContact(); c.givenName = given; c.familyName = a["family_name"] as? String ?? ""
        if let p = a["phone"] as? String, !p.isEmpty { c.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: p))] }
        if let e = a["email"] as? String, !e.isEmpty { c.emailAddresses = [CNLabeledValue(label: CNLabelHome, value: e as NSString)] }
        let req = CNSaveRequest(); req.add(c, toContainerWithIdentifier: nil)
        do { try store.execute(req); return (200, ["ok": true, "identifier": c.identifier]) }
        catch { return (500, ["error": "contact_create_failed", "detail": error.localizedDescription]) }
    }

    private static func updateContact(_ a: [String: Any]) async -> (Int, [String: Any]) {
        guard let id = a["identifier"] as? String, !id.isEmpty else { return (400, ["error": "identifier_required"]) }
        guard let store = await contactsStoreWithAccess() else { return (403, ["error": "contacts_permission_denied"]) }
        do {
            let original = try store.unifiedContact(withIdentifier: id, keysToFetch: [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey] as [CNKeyDescriptor])
            let c = original.mutableCopy() as! CNMutableContact
            if let v = a["given_name"] as? String { c.givenName = v }
            if let v = a["family_name"] as? String { c.familyName = v }
            if let v = a["phone"] as? String { c.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: v))] }
            if let v = a["email"] as? String { c.emailAddresses = [CNLabeledValue(label: CNLabelHome, value: v as NSString)] }
            let req = CNSaveRequest(); req.update(c); try store.execute(req)
            return (200, ["ok": true, "identifier": id])
        } catch { return (500, ["error": "contact_update_failed", "detail": error.localizedDescription]) }
    }

    private static func eventStoreWithAccess(_ kind: EKEntityType) async -> EKEventStore? {
        let store = EKEventStore()
        let status = EKEventStore.authorizationStatus(for: kind)
        if status == .authorized { return store }
        if #available(iOS 17.0, *) {
            if status == .fullAccess || (kind == .event && status == .writeOnly) { return store }
        }
        guard status == .notDetermined else { return nil }
        let granted = await withCheckedContinuation { c in store.requestAccess(to: kind) { ok, _ in c.resume(returning: ok) } }
        return granted ? store : nil
    }

    private static func saveCalendarEvent(_ a: [String: Any], identifier: String?) async -> (Int, [String: Any]) {
        guard let store = await eventStoreWithAccess(.event) else { return (403, ["error": "calendar_permission_denied"]) }
        let event: EKEvent
        if let id = identifier {
            guard let found = store.event(withIdentifier: id) else { return (404, ["error": "event_not_found"]) }
            event = found
        } else {
            guard let title = a["title"] as? String, !title.isEmpty, dateArg(a["start"]) != nil, dateArg(a["end"]) != nil else { return (400, ["error": "title_and_valid_start_end_required"]) }
            event = EKEvent(eventStore: store); event.calendar = store.defaultCalendarForNewEvents
        }
        if let v = a["title"] as? String { event.title = v }
        if let v = dateArg(a["start"]) { event.startDate = v }
        if let v = dateArg(a["end"]) { event.endDate = v }
        if let v = a["notes"] as? String { event.notes = v }
        if let v = a["location"] as? String { event.location = v }
        guard let start = event.startDate, let end = event.endDate, end > start else { return (400, ["error": "end_must_be_after_start"]) }
        do { try store.save(event, span: .thisEvent); return (200, ["ok": true, "identifier": event.eventIdentifier ?? ""]) }
        catch { return (500, ["error": "calendar_save_failed", "detail": error.localizedDescription]) }
    }

    private static func deleteCalendarEvent(_ a: [String: Any]) async -> (Int, [String: Any]) {
        guard let id = a["identifier"] as? String, !id.isEmpty else { return (400, ["error": "identifier_required"]) }
        guard let store = await eventStoreWithAccess(.event) else { return (403, ["error": "calendar_permission_denied"]) }
        guard let event = store.event(withIdentifier: id) else { return (404, ["error": "event_not_found"]) }
        do { try store.remove(event, span: .thisEvent); return (200, ["ok": true, "identifier": id]) }
        catch { return (500, ["error": "calendar_delete_failed", "detail": error.localizedDescription]) }
    }

    private static func saveReminder(_ a: [String: Any]) async -> (Int, [String: Any]) {
        guard let title = a["title"] as? String, !title.isEmpty else { return (400, ["error": "title_required"]) }
        guard let store = await eventStoreWithAccess(.reminder) else { return (403, ["error": "reminders_permission_denied"]) }
        let r = EKReminder(eventStore: store); r.title = title; r.calendar = store.defaultCalendarForNewReminders()
        r.notes = a["notes"] as? String
        if let due = dateArg(a["due"]) { r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due) }
        do { try store.save(r, commit: true); return (200, ["ok": true, "identifier": r.calendarItemIdentifier]) }
        catch { return (500, ["error": "reminder_create_failed", "detail": error.localizedDescription]) }
    }

    private static func completeReminder(_ a: [String: Any]) async -> (Int, [String: Any]) {
        guard let id = a["identifier"] as? String, !id.isEmpty else { return (400, ["error": "identifier_required"]) }
        guard let store = await eventStoreWithAccess(.reminder) else { return (403, ["error": "reminders_permission_denied"]) }
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { return (404, ["error": "reminder_not_found"]) }
        r.isCompleted = true; r.completionDate = Date()
        do { try store.save(r, commit: true); return (200, ["ok": true, "identifier": id, "completed": true]) }
        catch { return (500, ["error": "reminder_complete_failed", "detail": error.localizedDescription]) }
    }

    private static func deleteReminder(_ a: [String: Any]) async -> (Int, [String: Any]) {
        guard let id = a["identifier"] as? String, !id.isEmpty else { return (400, ["error": "identifier_required"]) }
        guard let store = await eventStoreWithAccess(.reminder) else { return (403, ["error": "reminders_permission_denied"]) }
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { return (404, ["error": "reminder_not_found"]) }
        do { try store.remove(r, commit: true); return (200, ["ok": true, "identifier": id]) }
        catch { return (500, ["error": "reminder_delete_failed", "detail": error.localizedDescription]) }
    }

    private static func limitation(_ message: String) -> (Int, [String: Any]) { (501, ["error": "ios_platform_limit", "detail": message]) }

    private static func dateArg(_ value: Any?) -> Date? {
        guard let value = value as? String else { return nil }
        let iso = ISO8601DateFormatter()
        return iso.date(from: value)
    }

    private static func locationLabel(_ status: CLAuthorizationStatus) -> String {
        switch status { case .authorizedAlways: return "always"; case .authorizedWhenInUse: return "when_in_use"; case .denied: return "denied"; case .restricted: return "restricted"; case .notDetermined: return "not_determined"; @unknown default: return "unknown" }
    }

    private static func listRecentPhotos() async -> (Int, [String: Any]) {
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if current == .notDetermined {
            let granted = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
            guard granted == .authorized || granted == .limited else { return (403, ["error": "photos_permission_denied"]) }
        } else if current != .authorized && current != .limited {
            return (403, ["error": "photos_permission_denied", "status": current.rawValue])
        }
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = 50
        let assets = PHAsset.fetchAssets(with: .image, options: options)
        var rows: [[String: Any]] = []
        assets.enumerateObjects { asset, _, _ in
            var row: [String: Any] = ["id": asset.localIdentifier, "width": asset.pixelWidth, "height": asset.pixelHeight, "favorite": asset.isFavorite]
            if let date = asset.creationDate { row["created_at"] = ISO8601DateFormatter().string(from: date) }
            rows.append(row)
        }
        return (200, ["photos": rows, "count": rows.count])
    }

    private static func searchMusic(_ query: String) async -> (Int, [String: Any]) {
        let status = MPMediaLibrary.authorizationStatus()
        if status == .notDetermined {
            let next = await MPMediaLibrary.requestAuthorization()
            guard next == .authorized else { return (403, ["error": "music_permission_denied", "status": next.rawValue]) }
        } else if status != .authorized { return (403, ["error": "music_permission_denied", "status": status.rawValue]) }
        let predicate = MPMediaPropertyPredicate(value: query, forProperty: MPMediaItemPropertyTitle, comparisonType: .contains)
        let artist = MPMediaPropertyPredicate(value: query, forProperty: MPMediaItemPropertyArtist, comparisonType: .contains)
        let items = MPMediaQuery.songs()
        items.addFilterPredicate(predicate)
        let first = Array((items.items ?? []).prefix(50))
        let secondQuery = MPMediaQuery.songs()
        secondQuery.addFilterPredicate(artist)
        let all = (first + Array((secondQuery.items ?? []).prefix(50))).reduce(into: [UInt64: MPMediaItem]()) { $0[$1.persistentID] = $1 }
        let rows = all.values.map { ["persistent_id": String($0.persistentID), "title": $0.title ?? "", "artist": $0.artist ?? "", "album": $0.albumTitle ?? ""] }
        return (200, ["items": rows, "count": rows.count])
    }

    private static func playMusic(id: MPMediaEntityPersistentID) async -> (Int, [String: Any]) {
        let status = MPMediaLibrary.authorizationStatus()
        guard status == .authorized else { return (403, ["error": "music_permission_required", "status": status.rawValue]) }
        let predicate = MPMediaPropertyPredicate(value: NSNumber(value: id), forProperty: MPMediaItemPropertyPersistentID)
        let query = MPMediaQuery.songs()
        query.addFilterPredicate(predicate)
        guard let item = query.items?.first else { return (404, ["error": "music_item_not_found"]) }
        let player = MPMusicPlayerController.systemMusicPlayer
        player.setQueue(with: MPMediaItemCollection(items: [item]))
        player.play()
        return (200, ["ok": true, "title": item.title ?? "", "artist": item.artist ?? ""])
    }
}

private final class LocationTool: NSObject, CLLocationManagerDelegate {
    static let shared = LocationTool()
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<(Int, [String: Any]), Never>?

    private override init() { super.init(); manager.delegate = self }

    static func read() async -> (Int, [String: Any]) {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                let tool = LocationTool.shared
                tool.continuation = continuation
                guard CLLocationManager.locationServicesEnabled() else {
                    tool.finish(503, ["error": "location_services_disabled"]); return
                }
                let status = tool.manager.authorizationStatus
                if status == .notDetermined { tool.manager.requestWhenInUseAuthorization() }
                else if status == .denied || status == .restricted { tool.finish(403, ["error": "location_permission_denied"]); return }
                else { tool.manager.requestLocation() }
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse { manager.requestLocation() }
        else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted { finish(403, ["error": "location_permission_denied"]) }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { finish(404, ["error": "location_unavailable"]); return }
        finish(200, ["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude, "accuracy_meters": location.horizontalAccuracy, "timestamp": ISO8601DateFormatter().string(from: location.timestamp)])
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish(503, ["error": "location_failed", "detail": error.localizedDescription]) }
    private func finish(_ status: Int, _ value: [String: Any]) {
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(returning: (status, value))
    }
}

private enum MotionTool {
    static func steps(start: Date, end: Date) async -> (Int, [String: Any]) {
        guard CMPedometer.isStepCountingAvailable() else { return (501, ["error": "pedometer_unavailable"]) }
        return await withCheckedContinuation { continuation in
            CMPedometer().queryPedometerData(from: start, to: end) { data, error in
                if let error { continuation.resume(returning: (403, ["error": "motion_query_failed", "detail": error.localizedDescription])); return }
                continuation.resume(returning: (200, ["steps": data?.numberOfSteps.intValue ?? 0, "distance_meters": data?.distance?.doubleValue as Any? ?? NSNull()]))
            }
        }
    }
}

private enum HealthTool {
    static func steps(start: Date, end: Date) async -> (Int, [String: Any]) {
        guard HKHealthStore.isHealthDataAvailable(), let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return (501, ["error": "healthkit_unavailable"]) }
        let store = HKHealthStore()
        do {
            try await store.requestAuthorization(toShare: [], read: [type])
        } catch { return (403, ["error": "health_authorization_failed", "detail": error.localizedDescription]) }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, error in
                if let error { continuation.resume(returning: (500, ["error": "health_query_failed", "detail": error.localizedDescription])); return }
                let count = result?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
                continuation.resume(returning: (200, ["steps": Int(count), "start": ISO8601DateFormatter().string(from: start), "end": ISO8601DateFormatter().string(from: end)]))
            }
            store.execute(query)
        }
    }
}

private final class BluetoothStatus: NSObject, CBCentralManagerDelegate {
    static let shared = BluetoothStatus()
    private var manager: CBCentralManager!
    private var continuation: CheckedContinuation<(Int, [String: Any]), Never>?
    private var found: [[String: Any]] = []
    private var scanTimer: DispatchWorkItem?
    var stateLabel: String {
        guard let manager else { return "unknown" }
        switch manager.state { case .poweredOn: return "powered_on"; case .poweredOff: return "powered_off"; case .unauthorized: return "unauthorized"; case .unsupported: return "unsupported"; case .resetting: return "resetting"; case .unknown: return "unknown"; @unknown default: return "unknown" }
    }
    private override init() { super.init(); manager = CBCentralManager(delegate: self, queue: .main) }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if let continuation, central.state != .unknown && central.state != .resetting {
            self.continuation = nil
            continuation.resume(returning: (central.state == .poweredOn ? 200 : 403, ["state": stateLabel]))
        }
    }
    func scan(seconds: Double) async -> (Int, [String: Any]) {
        guard manager.state == .poweredOn else { return (403, ["error": "bluetooth_not_ready", "state": stateLabel]) }
        found = []
        manager.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            let timer = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.manager.stopScan()
                let done = self.continuation
                self.continuation = nil
                done?.resume(returning: (200, ["peripherals": self.found, "count": self.found.count]))
            }
            scanTimer = timer
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: timer)
        }
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        found.append(["id": peripheral.identifier.uuidString, "name": peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""), "rssi": RSSI.intValue])
    }
}


@MainActor
private final class DocumentPickerFlow: NSObject, UIDocumentPickerDelegate {
    private static var active: DocumentPickerFlow?
    private var continuation: CheckedContinuation<(Int, [String: Any]), Never>?
    private var exportURL: URL?

    static func pickFile() async -> (Int, [String: Any]) {
        await withCheckedContinuation { continuation in
            guard let presenter = topPresenter() else {
                continuation.resume(returning: (409, ["error": "foreground_ui_required"]))
                return
            }
            let flow = DocumentPickerFlow()
            flow.continuation = continuation
            active = flow
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.item], asCopy: false)
            picker.allowsMultipleSelection = false
            picker.delegate = flow
            presenter.present(picker, animated: true)
        }
    }

    static func exportFile(_ arguments: [String: Any]) async -> (Int, [String: Any]) {
        guard let encoded = arguments["data_base64"] as? String, let data = Data(base64Encoded: encoded) else {
            return (400, ["error": "valid_data_base64_required"])
        }
        let name = (arguments["filename"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "NeuroClaw-export.txt"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(URL(fileURLWithPath: name).lastPathComponent)
        do { try data.write(to: url, options: .atomic) }
        catch { return (500, ["error": "temporary_export_write_failed", "detail": error.localizedDescription]) }
        return await withCheckedContinuation { continuation in
            guard let presenter = topPresenter() else {
                try? FileManager.default.removeItem(at: url)
                continuation.resume(returning: (409, ["error": "foreground_ui_required"]))
                return
            }
            let flow = DocumentPickerFlow()
            flow.continuation = continuation
            flow.exportURL = url
            active = flow
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = flow
            presenter.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let continuation else { return }
        self.continuation = nil
        if let exportURL {
            try? FileManager.default.removeItem(at: exportURL)
            self.exportURL = nil
            continuation.resume(returning: (200, ["ok": true, "exported": true]))
            Self.active = nil
            return
        }
        guard let url = urls.first else {
            continuation.resume(returning: (404, ["error": "no_file_selected"]))
            Self.active = nil
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            continuation.resume(returning: (200, [
                "filename": url.lastPathComponent,
                "content_type": UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                "size_bytes": data.count,
                "data_base64": data.base64EncodedString()
            ]))
        } catch {
            continuation.resume(returning: (500, ["error": "selected_file_read_failed", "detail": error.localizedDescription]))
        }
        Self.active = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let continuation else { return }
        self.continuation = nil
        if let exportURL { try? FileManager.default.removeItem(at: exportURL) }
        continuation.resume(returning: (499, ["error": "user_cancelled"]))
        Self.active = nil
    }

    private static func topPresenter() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap { $0.windows }
        var current = windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let presented = current?.presentedViewController { current = presented }
        return current
    }
}

@MainActor
private final class CameraCaptureFlow: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private static var active: CameraCaptureFlow?
    private var continuation: CheckedContinuation<(Int, [String: Any]), Never>?

    static func capturePhoto() async -> (Int, [String: Any]) {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            return (501, ["error": "camera_hardware_unavailable"])
        }
        let auth = AVCaptureDevice.authorizationStatus(for: .video)
        guard auth != .denied && auth != .restricted else {
            return (403, ["error": "camera_permission_denied"])
        }
        if auth == .notDetermined {
            let granted = await withCheckedContinuation { c in
                AVCaptureDevice.requestAccess(for: .video) { c.resume(returning: $0) }
            }
            guard granted else { return (403, ["error": "camera_permission_denied"]) }
        }
        return await withCheckedContinuation { continuation in
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap { $0.windows }
            var presenter = windows.first(where: { $0.isKeyWindow })?.rootViewController
            while let next = presenter?.presentedViewController { presenter = next }
            guard let presenter else {
                continuation.resume(returning: (409, ["error": "foreground_ui_required"]))
                return
            }
            let flow = CameraCaptureFlow()
            flow.continuation = continuation
            active = flow
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.delegate = flow
            presenter.present(picker, animated: true)
        }
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        defer { Self.active = nil }
        guard let continuation else { return }
        self.continuation = nil
        guard let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.9) else {
            continuation.resume(returning: (500, ["error": "camera_image_encoding_failed"]))
            return
        }
        continuation.resume(returning: (200, ["captured": true, "mime_type": "image/jpeg", "data_base64": data.base64EncodedString()]))
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        defer { Self.active = nil }
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(returning: (499, ["error": "user_cancelled"]))
    }
}


@MainActor
private final class AudioRecordingFlow {
    static let shared = AudioRecordingFlow()
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?

    func start() async -> (Int, [String: Any]) {
        guard recorder?.isRecording != true else {
            return (409, ["error": "recording_already_active"])
        }
        let session = AVAudioSession.sharedInstance()
        let permission: Bool
        switch session.recordPermission {
        case .granted: permission = true
        case .denied: permission = false
        case .undetermined:
            permission = await withCheckedContinuation { continuation in
                session.requestRecordPermission { continuation.resume(returning: $0) }
            }
        @unknown default: permission = false
        }
        guard permission else { return (403, ["error": "microphone_permission_denied"]) }
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("neuroclaw-recording-" + UUID().uuidString + ".m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            guard recorder.record() else { return (500, ["error": "audio_recording_failed_to_start"]) }
            self.recorder = recorder
            recordingURL = url
            return (200, ["recording": true, "format": "m4a", "note": "Recording continues until microphone.stop_recording is called or iOS interrupts it."])
        } catch {
            try? session.setActive(false)
            return (500, ["error": "audio_recording_setup_failed", "detail": error.localizedDescription])
        }
    }

    func stop() async -> (Int, [String: Any]) {
        guard let recorder, let url = recordingURL, recorder.isRecording else {
            return (409, ["error": "no_active_recording"])
        }
        recorder.stop()
        self.recorder = nil
        recordingURL = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        do {
            let data = try Data(contentsOf: url)
            try? FileManager.default.removeItem(at: url)
            return (200, ["recording": false, "mime_type": "audio/mp4", "size_bytes": data.count, "data_base64": data.base64EncodedString()])
        } catch {
            try? FileManager.default.removeItem(at: url)
            return (500, ["error": "audio_recording_read_failed", "detail": error.localizedDescription])
        }
    }
}
