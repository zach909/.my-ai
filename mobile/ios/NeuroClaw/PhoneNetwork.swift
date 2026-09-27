import Foundation
import WebKit

/// NeuroClaw's full network on the iPhone: the PC's own engine
/// (mobile/brain/bundle/neuroclaw-brain.js) run in a hidden WKWebView -- the
/// same bundle Android runs, so one codebase everywhere. WKWebView rather than
/// a bare JSContext because only WebKit's web views get the JIT on iOS; a
/// JSContext runs several times slower.
///
/// Mesh (with OneBrain grafted in), Zip Loop with send neurons, net-skill
/// routing and yes/no. What it learns is saved when the app goes to the
/// background.
@MainActor
final class PhoneNetwork: NSObject, WKNavigationDelegate {
    private let web = WKWebView(frame: .zero)
    private var started: CheckedContinuation<Void, Never>?
    private var isReady = false
    private var stateFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("phone-network-state.json")
    }

    struct Answer { let reply: String; let trained: Bool; let recalled: [String]; let ms: Int }

    func start() async {
        if isReady { return }
        web.navigationDelegate = self
        web.loadHTMLString("<!doctype html><html><body><script src=\"neuroclaw-brain.js\"></script></body></html>", baseURL: Bundle.main.resourceURL)
        await withCheckedContinuation { started = $0 }
        let model = Bundle.main.url(forResource: "model", withExtension: "json").flatMap { try? String(contentsOf: $0) }
        let saved = try? String(contentsOf: stateFile)
        _ = try? await web.callAsyncJavaScript("return NeuroClawBrain.init(m, s)", arguments: ["m": model ?? NSNull(), "s": saved ?? NSNull()], contentWorld: .page)
        isReady = true
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in started?.resume(); started = nil }
    }

    func chat(_ text: String) async throws -> Answer {
        await start()
        let value = try await call("return await NeuroClawBrain.chat(t)", ["t": text])
        return Answer(
            reply: value["reply"] as? String ?? "",
            trained: value["trained"] as? Bool ?? false,
            recalled: value["recalled"] as? [String] ?? [],
            ms: value["ms"] as? Int ?? 0)
    }

    func save() async {
        guard isReady, let raw = try? await web.callAsyncJavaScript("return NeuroClawBrain.exportState()", arguments: [:], contentWorld: .page) as? String,
              let json = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
              json["ok"] as? Bool == true, let state = json["value"] as? String else { return }
        try? FileManager.default.createDirectory(at: stateFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? state.write(to: stateFile, atomically: true, encoding: .utf8)
    }

    struct NetworkError: Error { let message: String }

    private func call(_ body: String, _ args: [String: Any]) async throws -> [String: Any] {
        guard let raw = try await web.callAsyncJavaScript(body, arguments: args, contentWorld: .page) as? String,
              let json = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] else {
            throw NetworkError(message: "No answer from the phone's network")
        }
        guard json["ok"] as? Bool == true else { throw NetworkError(message: json["error"] as? String ?? "phone network error") }
        return json["value"] as? [String: Any] ?? [:]
    }
}
