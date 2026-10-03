import SwiftUI

/// "Give it access to everything": one Grant all button, plus every
/// category listed individually (tap one to (re)request just that one).
/// Nothing here forces a grant -- iOS always shows its own system dialog,
/// and declining is always an option; this just asks once, for everything,
/// instead of leaving each feature to ask for itself the first time you use it.
struct PermissionsView: View {
    @State private var results: [Permissions.Status] = []
    @State private var busy = false

    var body: some View {
        List {
            Section(footer: Text("Background App Refresh and Cellular Data have no request dialog -- iOS only lets you see and change those yourself, in Settings. HealthKit and HomeKit need a capability added in Xcode first (see mobile/README.md); until then they report that plainly instead of a grant.")) {
                Button(busy ? "Requesting..." : "Grant all permissions") {
                    busy = true
                    Task {
                        results = await Permissions.requestAll()
                        busy = false
                    }
                }
                .disabled(busy)
            }
            Section("Each one") {
                row("location", "Location") { await Permissions.requestLocation() }
                row("contacts", "Contacts") { await Permissions.requestContacts() }
                row("calendars", "Calendars") { await Permissions.requestCalendar() }
                row("reminders", "Reminders") { await Permissions.requestReminders() }
                row("photos", "Photos") { await Permissions.requestPhotos() }
                row("microphone", "Microphone") { await Permissions.requestMicrophone() }
                row("camera", "Camera") { await Permissions.requestCamera() }
                row("speech", "Speech Recognition") { await Permissions.requestSpeechRecognition() }
                row("motion", "Health & Fitness / Motion") { await Permissions.requestMotion() }
                row("music", "Media & Apple Music") { await Permissions.requestAppleMusic() }
                row("notifications", "Notifications & Critical Messages") { await Permissions.requestNotifications() }
                row("tracking", "App Tracking Transparency") { await Permissions.requestTracking() }
                row("bluetooth", "Bluetooth") { await Permissions.requestBluetooth() }
                row("health", "HealthKit") { await Permissions.requestHealth() }
                row("homekit", "HomeKit") { await Permissions.requestHomeKit() }
                row("siri", "Siri & Search") { await Permissions.requestSiri() }
                row("faceid", "Face ID / Touch ID") { await Permissions.requestBiometrics() }
                statusRow("Cellular Data", value: Permissions.cellularStatus())
                statusRow("Background App Refresh", value: result(for: "background") ?? "Checking...")
            }
        }
        .navigationTitle("Permissions")
        .task {
            let value = await Permissions.backgroundRefreshStatus()
            set("background", "Background App Refresh", value)
        }
    }

    private func result(for id: String) -> String? {
        results.first(where: { $0.id == id })?.result
    }

    private func set(_ id: String, _ label: String, _ value: String) {
        if let index = results.firstIndex(where: { $0.id == id }) {
            results[index] = Permissions.Status(id: id, label: label, result: value)
        } else {
            results.append(Permissions.Status(id: id, label: label, result: value))
        }
    }

    private func row(_ id: String, _ label: String, action: @escaping () async -> String) -> some View {
        Button {
            Task { set(id, label, await action()) }
        } label: {
            HStack {
                Text(label)
                Spacer()
                Text(result(for: id) ?? "Tap to ask").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func statusRow(_ label: String, value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value).font(.footnote).foregroundStyle(.secondary) }
    }
}
