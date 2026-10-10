import AVFoundation
import AppTrackingTransparency
import CoreBluetooth
import CoreLocation
import CoreMotion
import CoreTelephony
import EventKit
import Foundation
import HealthKit
import Intents
import LocalAuthentication
import MediaPlayer
import Photos
import Speech
import UIKit
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
        tool("capabilities.catalog", "List supported iOS tool coverage and system-enforced limitations.")
    ]

    private static func tool(_ name: String, _ description: String) -> [String: Any] {
        ["name": name, "description": description, "input_schema": ["type": "object", "properties": [:]]]
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
        case "files.pick":
            return (409, ["error": "document_picker_requires_foreground_ui", "instruction": "Open the app's file picker UI. iOS requires a user-facing document picker; this HTTP bridge cannot present it safely by itself."])
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
        default:
            return (404, ["error": "unknown_extended_tool", "name": name])
        }
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
