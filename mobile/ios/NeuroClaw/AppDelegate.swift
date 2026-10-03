import UIKit

/// Background App Refresh has no "request" call (see Permissions.swift) --
/// an app earns it by declaring UIBackgroundModes: [fetch] (project.yml) and
/// actually doing something useful when the system wakes it, which is this:
/// one sync with the PC, on whatever schedule iOS decides to grant.
/// SwiftUI's App protocol has no fetch hook of its own at this deployment
/// target, hence the classic UIApplicationDelegate, wired in via
/// @UIApplicationDelegateAdaptor in NeuroClawApp.swift.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        Task { @MainActor in
            guard let brain = Brain.current else {
                completionHandler(.noData)
                return
            }
            let before = brain.syncStatus
            await brain.sync()
            completionHandler(brain.syncStatus == before ? .noData : .newData)
        }
    }
}
