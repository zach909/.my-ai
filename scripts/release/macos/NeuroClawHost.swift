// The macOS app window for NeuroClaw.
//
// What it does, and all it does: runs the bundled engine through the launcher
// script (Contents/Resources/runtime/node ... desktop-launcher.mjs --no-window),
// waits for the line "READY <url>", and shows that page in a window using the
// system's own WebKit. Quitting the app or closing the window stops the engine.
//
// Only Apple frameworks are used (SwiftUI, WebKit, Foundation). It asks for no
// permissions: no camera, microphone, accessibility or screen recording. Features
// that need those are unavailable in this app and say so in Settings > About.
import SwiftUI
import WebKit
import Foundation

/// Runs the engine and reports when its address is known.
final class Engine: ObservableObject {
    static let shared = Engine()
    @Published var url: URL?
    @Published var failure: String?
    private var process: Process?
    private var buffer = ""

    func start() {
        guard process == nil else { return }
        let resources = Bundle.main.resourceURL!
        let p = Process()
        p.executableURL = resources.appendingPathComponent("runtime/node")
        p.arguments = [resources.appendingPathComponent("app/scripts/desktop-launcher.mjs").path, "--no-window"]
        p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.consume(text) }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                if self?.url == nil && self?.failure == nil {
                    self?.failure = "The engine stopped before it was ready (exit code \(proc.terminationStatus))."
                }
            }
        }
        do { try p.run(); process = p } catch { failure = "Could not start the engine: \(error.localizedDescription)" }
    }

    private func consume(_ text: String) {
        buffer += text
        while let nl = buffer.firstIndex(of: "\n") {
            let line = String(buffer[buffer.startIndex..<nl]).trimmingCharacters(in: .whitespaces)
            buffer.removeSubrange(buffer.startIndex...nl)
            if line.hasPrefix("READY "), let u = URL(string: String(line.dropFirst(6))) { url = u }
            else if line.hasPrefix("FAILED ") { failure = String(line.dropFirst(7)) }
        }
    }

    /// SIGTERM: the launcher stops the engine it started, and leaves one that was already running alone.
    func stop() { if let p = process, p.isRunning { p.terminate() } }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { Engine.shared.stop() }
}

extension Notification.Name {
    static let ncReload = Notification.Name("ai.neuroclaw.reload")
    static let ncSettings = Notification.Name("ai.neuroclaw.settings")
}

struct WebView: NSViewRepresentable {
    let origin: URL

    func makeCoordinator() -> Coordinator { Coordinator(origin: origin) }

    func makeNSView(context: Context) -> WKWebView {
        let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        context.coordinator.web = web
        web.load(URLRequest(url: origin))
        return web
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        let origin: URL
        weak var web: WKWebView?
        private var observers: [NSObjectProtocol] = []

        init(origin: URL) {
            self.origin = origin
            super.init()
            observers.append(NotificationCenter.default.addObserver(forName: .ncReload, object: nil, queue: .main) { [weak self] _ in self?.web?.reload() })
            observers.append(NotificationCenter.default.addObserver(forName: .ncSettings, object: nil, queue: .main) { [weak self] _ in
                if let self = self, let u = URL(string: "/settings", relativeTo: self.origin) { self.web?.load(URLRequest(url: u)) }
            })
        }

        // Links stay inside the app only when they are NeuroClaw's own; everything else opens in the browser.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "about" || url.scheme == "data" || url.scheme == "blob" || (url.host == origin.host && url.port == origin.port) {
                decisionHandler(.allow)
            } else {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
            return nil
        }

        // Importing chats: the page's file chooser.
        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = parameters.allowsMultipleSelection
            panel.canChooseDirectories = false
            panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
        }

        // Exporting chats: attachments become downloads that ask where to save.
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
            decisionHandler(disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType ? .download : .allow)
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = suggestedFilename
            panel.begin { result in completionHandler(result == .OK ? panel.url : nil) }
        }
    }
}

struct ContentView: View {
    @ObservedObject var engine: Engine

    var body: some View {
        ZStack {
            Color(red: 0.067, green: 0.047, blue: 0.055).ignoresSafeArea()
            if let url = engine.url {
                WebView(origin: url)
            } else if let failure = engine.failure {
                VStack(spacing: 12) {
                    Text("NeuroClaw could not start").font(.title2).bold()
                    Text(failure).multilineTextAlignment(.center)
                    Text("Details are in ~/.neuroclaw/logs/server.log").font(.footnote).opacity(0.7)
                    Button("Quit") { NSApp.terminate(nil) }
                }
                .foregroundColor(Color(red: 0.97, green: 0.93, blue: 0.91))
                .padding(32)
            } else {
                Text("Starting NeuroClaw...").foregroundColor(Color(red: 0.97, green: 0.93, blue: 0.91))
            }
        }
        .frame(minWidth: 480, minHeight: 360)
        .onAppear { engine.start() }
    }
}

@main
struct NeuroClawApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var engine = Engine.shared

    var body: some Scene {
        WindowGroup("NeuroClaw") {
            ContentView(engine: engine)
        }
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Go") {
                Button("Reload") { NotificationCenter.default.post(name: .ncReload, object: nil) }.keyboardShortcut("r")
                Button("Settings") { NotificationCenter.default.post(name: .ncSettings, object: nil) }.keyboardShortcut(",")
            }
        }
    }
}
