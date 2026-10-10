import AVFoundation
import AppTrackingTransparency
import Contacts
import CoreBluetooth
import CoreLocation
import CoreMotion
import CoreTelephony
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
import UserNotifications

/// "Give it access to everything": every permission category iOS has a
/// usage-description key for, requested in one batch (`requestAll`) or one
/// at a time (the individual `request...` functions), the same shape as
/// Android's `Permissions.kt`.
///
/// Three of these are not a system dialog the way the rest are, and have no
/// "request" call at all -- iOS does not offer one:
///   - **Background App Refresh** is a per-app toggle only the person sets,
///     in Settings; an app can read `backgroundRefreshStatus` and declare
///     `UIBackgroundModes` (done in project.yml + AppDelegate.swift's real
///     background-fetch handler, which runs a sync), never request it.
///   - **Cellular Data** has no request either; `CTCellularData` only
///     reports today's state.
///   - **Files and Folders** (`NSDocumentsFolderUsageDescription` /
///     `NSDownloadsFolderUsageDescription`) are Mac Catalyst keys for
///     sandbox-extension access to those folders; a plain iOS app gets that
///     access through the system document picker instead, which carries its
///     own, separate authorization and needs no request here.
///
/// Two more need something this project cannot give them from here: HealthKit
/// and HomeKit each need their own capability entitlement, which only Xcode
/// (and, for HomeKit, a paid Apple Developer account) can add to the app ID.
/// `NeuroClaw.entitlements` lists both; see mobile/README.md for the manual
/// step. Calling their request functions without that entitlement fails
/// (reported back, not a crash), it does not stop the rest of `requestAll`.
enum Permissions {
    struct Status: Identifiable {
        let id: String
        let label: String
        let result: String
    }

    /// Every category, in the order it's safest to ask: dialogs iOS always
    /// allows stacked back-to-back, then ones that open their own UI
    /// (HomeKit's, Siri's), then Face ID last since it's a real biometric
    /// challenge, not just a yes/no dialog.
    static func requestAll() async -> [Status] {
        var out: [Status] = []
        out.append(Status(id: "location", label: "Location", result: await requestLocation()))
        out.append(Status(id: "precise_location", label: "Precise Location", result: await requestPreciseLocation()))
        out.append(Status(id: "contacts", label: "Contacts", result: await requestContacts()))
        out.append(Status(id: "calendars", label: "Calendars Read/Write", result: await requestCalendar()))
        out.append(Status(id: "calendar_write_only", label: "Calendar Write Only", result: await requestCalendarWriteOnly()))
        out.append(Status(id: "reminders", label: "Reminders", result: await requestReminders()))
        out.append(Status(id: "photos", label: "Photos Read/Write", result: await requestPhotos()))
        out.append(Status(id: "photos_add_only", label: "Photos Add Only", result: await requestPhotosAddOnly()))
        out.append(Status(id: "microphone", label: "Microphone", result: await requestMicrophone()))
        out.append(Status(id: "camera", label: "Camera", result: await requestCamera()))
        out.append(Status(id: "speech", label: "Speech Recognition", result: await requestSpeechRecognition()))
        out.append(Status(id: "motion", label: "Health & Fitness / Motion", result: await requestMotion()))
        out.append(Status(id: "music", label: "Media & Apple Music", result: await requestAppleMusic()))
        out.append(Status(id: "notifications", label: "Notifications & Critical Messages", result: await requestNotifications()))
        out.append(Status(id: "tracking", label: "App Tracking Transparency", result: await requestTracking()))
        out.append(Status(id: "bluetooth", label: "Bluetooth", result: await requestBluetooth()))
        out.append(Status(id: "health", label: "HealthKit", result: await requestHealth()))
        out.append(Status(id: "homekit", label: "HomeKit", result: await requestHomeKit()))
        out.append(Status(id: "siri", label: "Siri & Search", result: await requestSiri()))
        out.append(Status(id: "faceid", label: "Face ID / Touch ID", result: await requestBiometrics()))
        out.append(Status(id: "cellular", label: "Cellular Data", result: cellularStatus()))
        out.append(Status(id: "background", label: "Background App Refresh", result: await backgroundRefreshStatus()))
        return out
    }

    // MARK: Location

    private static let locationDelegate = LocationDelegate()
    static func requestLocation() async -> String {
        await withCheckedContinuation { continuation in
            locationDelegate.request(continuation: continuation)
        }
    }

    private final class LocationDelegate: NSObject, CLLocationManagerDelegate {
        private let manager = CLLocationManager()
        private var continuation: CheckedContinuation<String, Never>?

        func request(continuation: CheckedContinuation<String, Never>) {
            self.continuation = continuation
            manager.delegate = self
            let current = manager.authorizationStatus
            if current != .notDetermined {
                finish(current)
                return
            }
            // When-in-use first; Always needs it granted before it can be asked for,
            // and NSLocationAlwaysAndWhenInUseUsageDescription covers both prompts.
            manager.requestWhenInUseAuthorization()
        }

        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            let status = manager.authorizationStatus
            if status == .authorizedWhenInUse {
                manager.requestAlwaysAuthorization()
                return
            }
            finish(status)
        }

        private func finish(_ status: CLAuthorizationStatus) {
            guard let continuation else { return }
            self.continuation = nil
            continuation.resume(returning: describe(status))
        }

        private func describe(_ status: CLAuthorizationStatus) -> String {
            switch status {
            case .authorizedAlways: return "Always"
            case .authorizedWhenInUse: return "When in use"
            case .denied: return "Denied"
            case .restricted: return "Restricted"
            case .notDetermined: return "Not asked"
            @unknown default: return "Unknown"
            }
        }
    }

    /// Requests temporary precise-location access where supported.
    private static let preciseLocationManager = CLLocationManager()

    static func requestPreciseLocation() async -> String {
        await withCheckedContinuation { continuation in
            let manager = preciseLocationManager
            guard manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse else {
                continuation.resume(returning: "Location permission must be granted first")
                return
            }
            if #available(iOS 14.0, *) {
                guard manager.accuracyAuthorization != .fullAccuracy else {
                    continuation.resume(returning: "Already precise")
                    return
                }
                manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "AgentTask") { error in
                    continuation.resume(returning: error == nil ? "Precise location granted or already allowed" : (error?.localizedDescription ?? "Precise location not granted"))
                }
            } else {
                continuation.resume(returning: "Precise-location authorization is not separately available on this iOS version")
            }
        }
    }

    // MARK: Contacts

    static func requestContacts() async -> String {
        await withCheckedContinuation { continuation in
            CNContactStore().requestAccess(for: .contacts) { granted, error in
                continuation.resume(returning: granted ? "Granted" : (error?.localizedDescription ?? "Denied"))
            }
        }
    }

    // MARK: Calendars / Reminders (EventKit)

    static func requestCalendar() async -> String {
        await withCheckedContinuation { continuation in
            // requestAccess(to:) rather than the iOS-17-only requestFullAccessToEvents,
            // since this app's deployment target is iOS 16.
            EKEventStore().requestAccess(to: .event) { granted, error in
                continuation.resume(returning: granted ? "Granted" : (error?.localizedDescription ?? "Denied"))
            }
        }
    }

    static func requestCalendarWriteOnly() async -> String {
        guard #available(iOS 17.0, *) else {
            return "Not separately available before iOS 17; use Calendar access"
        }
        return await withCheckedContinuation { continuation in
            EKEventStore().requestWriteOnlyAccessToEvents { granted, error in
                continuation.resume(returning: granted ? "Granted" : (error?.localizedDescription ?? "Denied"))
            }
        }
    }

    static func requestReminders() async -> String {
        await withCheckedContinuation { continuation in
            EKEventStore().requestAccess(to: .reminder) { granted, error in
                continuation.resume(returning: granted ? "Granted" : (error?.localizedDescription ?? "Denied"))
            }
        }
    }

    // MARK: Photos

    static func requestPhotos() async -> String {
        await withCheckedContinuation { continuation in
            // .readWrite covers NSPhotoLibraryUsageDescription; NSPhotoLibraryAddUsageDescription
            // (save-only) is declared too, for any save-to-library feature added later.
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                continuation.resume(returning: describePhotos(status))
            }
        }
    }

    static func requestPhotosAddOnly() async -> String {
        await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                continuation.resume(returning: describePhotos(status))
            }
        }
    }

    private static func describePhotos(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "Granted"
        case .limited: return "Limited"
        case .denied: return "Denied"
        case .restricted: return "Restricted"
        case .notDetermined: return "Not asked"
        @unknown default: return "Unknown"
        }
    }

    // MARK: Microphone / Camera (AVFoundation)

    static func requestMicrophone() async -> String {
        await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted ? "Granted" : "Denied")
            }
        }
    }

    static func requestCamera() async -> String {
        await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .video) { granted in
                continuation.resume(returning: granted ? "Granted" : "Denied")
            }
        }
    }

    // MARK: Speech Recognition

    static func requestSpeechRecognition() async -> String {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                let text: String
                switch status {
                case .authorized: text = "Granted"
                case .denied: text = "Denied"
                case .restricted: text = "Restricted"
                case .notDetermined: text = "Not asked"
                @unknown default: text = "Unknown"
                }
                continuation.resume(returning: text)
            }
        }
    }

    // MARK: Health & Fitness / Motion

    /// CMMotionActivityManager is what NSMotionUsageDescription actually gates;
    /// one query is enough to trigger the system prompt. The manager must be
    /// kept alive until the handler fires, hence the static property.
    private static let motionManager = CMMotionActivityManager()
    static func requestMotion() async -> String {
        guard CMMotionActivityManager.isActivityAvailable() else { return "Not available on this device" }
        return await withCheckedContinuation { continuation in
            let now = Date()
            motionManager.queryActivityStarting(from: now.addingTimeInterval(-60), to: now, to: .main) { _, error in
                continuation.resume(returning: error == nil ? "Granted" : "Denied")
            }
        }
    }

    // MARK: HealthKit

    /// Scoped to step count only -- "every permission" means every CATEGORY
    /// is requestable, not that this app reads your full health record.
    /// Needs the HealthKit capability (NeuroClaw.entitlements) added in
    /// Xcode before this does anything but report "not available".
    static func requestHealth() async -> String {
        guard HKHealthStore.isHealthDataAvailable() else { return "Not available on this device" }
        let store = HKHealthStore()
        guard let steps = HKObjectType.quantityType(forIdentifier: .stepCount) else { return "Unavailable" }
        return await withCheckedContinuation { continuation in
            store.requestAuthorization(toShare: [steps], read: [steps]) { success, error in
                continuation.resume(returning: success ? "Granted" : (error?.localizedDescription ?? "Denied (needs the HealthKit capability in Xcode)"))
            }
        }
    }

    // MARK: HomeKit

    /// Instantiating HMHomeManager is itself the request -- there is no
    /// separate "ask" call. Kept alive statically so the OS prompt and the
    /// delegate callback are not torn down before they fire. Needs the
    /// HomeKit capability (a paid Apple Developer account) added in Xcode.
    private static let homeDelegate = HomeKitDelegate()
    static func requestHomeKit() async -> String {
        await withCheckedContinuation { continuation in
            homeDelegate.request(continuation: continuation)
        }
    }

    private final class HomeKitDelegate: NSObject, HMHomeManagerDelegate {
        private var manager: HMHomeManager?
        private var continuation: CheckedContinuation<String, Never>?

        func request(continuation: CheckedContinuation<String, Never>) {
            self.continuation = continuation
            let m = HMHomeManager()
            m.delegate = self
            manager = m
            // No callback fires if the HomeKit entitlement is missing; time out
            // rather than hang the batch forever.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                self?.finish("Not available (needs the HomeKit capability + a paid developer account)")
            }
        }

        func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {
            finish("Granted")
        }

        private func finish(_ result: String) {
            guard let continuation else { return }
            self.continuation = nil
            continuation.resume(returning: result)
        }
    }

    // MARK: Media & Apple Music

    static func requestAppleMusic() async -> String {
        await withCheckedContinuation { continuation in
            MPMediaLibrary.requestAuthorization { status in
                let text: String
                switch status {
                case .authorized: text = "Granted"
                case .denied: text = "Denied"
                case .restricted: text = "Restricted"
                case .notDetermined: text = "Not asked"
                @unknown default: text = "Unknown"
                }
                continuation.resume(returning: text)
            }
        }
    }

    // MARK: Siri & Search

    /// Full Shortcuts support (donating/handling specific intents) needs an
    /// Intents extension target, which is its own Xcode project surface and
    /// out of scope here; this is the authorization half only.
    static func requestSiri() async -> String {
        await withCheckedContinuation { continuation in
            INPreferences.requestSiriAuthorization { status in
                let text: String
                switch status {
                case .authorized: text = "Granted"
                case .denied: text = "Denied"
                case .restricted: text = "Restricted"
                case .notDetermined: text = "Not asked"
                @unknown default: text = "Unknown"
                }
                continuation.resume(returning: text)
            }
        }
    }

    // MARK: App Tracking Transparency

    static func requestTracking() async -> String {
        await withCheckedContinuation { continuation in
            ATTrackingManager.requestTrackingAuthorization { status in
                let text: String
                switch status {
                case .authorized: text = "Granted"
                case .denied: text = "Denied"
                case .restricted: text = "Restricted"
                case .notDetermined: text = "Not asked"
                @unknown default: text = "Unknown"
                }
                continuation.resume(returning: text)
            }
        }
    }

    // MARK: Notifications & Critical Messages

    /// .criticalAlert is included, but Apple only grants that specific
    /// sub-permission to apps it has separately approved for the
    /// com.apple.developer.usernotifications.critical-alerts entitlement
    /// (health/safety categories); asking without it is harmless, it just
    /// never turns on.
    static func requestNotifications() async -> String {
        await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge, .criticalAlert]) { granted, error in
                continuation.resume(returning: granted ? "Granted" : (error?.localizedDescription ?? "Denied"))
            }
        }
    }

    // MARK: Bluetooth

    /// Creating a CBCentralManager is itself what triggers the
    /// NSBluetoothAlwaysUsageDescription prompt; there is no separate
    /// request call. Kept alive statically so it is not deallocated before
    /// the state-update delegate callback fires.
    private static let bluetoothDelegate = BluetoothDelegate()
    static func requestBluetooth() async -> String {
        await withCheckedContinuation { continuation in
            bluetoothDelegate.request(continuation: continuation)
        }
    }

    private final class BluetoothDelegate: NSObject, CBCentralManagerDelegate {
        private var manager: CBCentralManager?
        private var continuation: CheckedContinuation<String, Never>?

        func request(continuation: CheckedContinuation<String, Never>) {
            self.continuation = continuation
            manager = CBCentralManager(delegate: self, queue: nil, options: [CBCentralManagerOptionShowPowerAlertKey: false])
        }

        func centralManagerDidUpdateState(_ central: CBCentralManager) {
            guard let continuation else { return }
            self.continuation = nil
            let text: String
            switch CBManager.authorization {
            case .allowedAlways: text = "Granted"
            case .denied: text = "Denied"
            case .restricted: text = "Restricted"
            case .notDetermined: text = "Not asked"
            @unknown default: text = "Unknown"
            }
            continuation.resume(returning: text)
        }
    }

    // MARK: Face ID / Touch ID

    /// There is no "ask permission for biometrics" API separate from
    /// actually running a challenge -- evaluating the policy IS the request,
    /// and it shows the real Face ID / Touch ID prompt.
    static func requestBiometrics() async -> String {
        let context = LAContext()
        var evalError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &evalError) else {
            return evalError?.localizedDescription ?? "Not available on this device"
        }
        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Confirm it's you, so NeuroClaw knows who it's talking to.") { success, error in
                continuation.resume(returning: success ? "Confirmed" : (error?.localizedDescription ?? "Not confirmed"))
            }
        }
    }

    // MARK: Cellular Data (status only -- no request exists)

    private static let cellularData = CTCellularData()
    static func cellularStatus() -> String {
        switch cellularData.restrictedState {
        case .restrictedStateUnknown: return "Unknown yet"
        case .restricted: return "Restricted in Settings"
        case .notRestricted: return "Allowed"
        @unknown default: return "Unknown"
        }
    }

    // MARK: Background App Refresh (status only -- no request exists)

    @MainActor
    static func backgroundRefreshStatus() -> String {
        switch UIApplication.shared.backgroundRefreshStatus {
        case .available: return "On"
        case .denied: return "Off (Settings > General > Background App Refresh)"
        case .restricted: return "Restricted"
        @unknown default: return "Unknown"
        }
    }
}
