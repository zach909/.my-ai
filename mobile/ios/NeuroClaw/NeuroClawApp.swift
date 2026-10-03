import SwiftUI

/// NeuroClaw for iPhone. iOS does not allow apps to draw over other apps, so
/// unlike Android there is no floating bubble: open the app (or add it to a
/// Shortcut / Back Tap) to talk. Same brain: NeuroClaw on your PC when it is
/// reachable, the full network on the phone (PhoneNetwork) when it is not.
@main
struct NeuroClawApp: App {
    @StateObject private var brain = Brain()
    @Environment(\.scenePhase) private var phase
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene {
        WindowGroup { ContentView().environmentObject(brain) }
            // Keep what the phone's network learned for the next launch.
            .onChange(of: phase) { p in if p == .background { Task { await brain.phone.save() } } }
    }
}
