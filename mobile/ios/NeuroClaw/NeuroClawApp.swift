import SwiftUI

/// NeuroClaw for iPhone. iOS does not allow apps to draw over other apps, so
/// unlike Android there is no floating bubble: open the app (or add it to a
/// Shortcut / Back Tap) to talk. Same brain: NeuroClaw on your PC when it is
/// reachable, OneBrain on the phone with a send-later queue when it is not.
@main
struct NeuroClawApp: App {
    @StateObject private var brain = Brain()
    var body: some Scene {
        WindowGroup { ContentView().environmentObject(brain) }
    }
}
