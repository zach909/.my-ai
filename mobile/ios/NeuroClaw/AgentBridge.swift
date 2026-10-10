import Foundation
import Network
import UIKit

/// The iPhone half of the agent's desktop layer.
///
/// The PC-side DesktopControl (models && skills/core/desktop-control.ts) can be
/// pointed at a phone through a small HTTP API; PhoneBackend in
/// models && skills/core/desktop/backends.ts documents the contract and
/// BridgeServer.kt is the Android end. This is the iOS end, and it is
/// deliberately narrower, because iOS is: an app cannot see, screenshot or
/// drive any other app, and cannot send itself taps. What is real here is
/// NeuroClaw's OWN windows: list them, screenshot them, type into the focused
/// text field, and open another app through its URL scheme.
///
/// Off until you turn it on in Permissions -> Agent bridge. Every request needs
/// the bearer token shown there. iOS suspends sockets when the app goes to the
/// background, so the bridge only answers while NeuroClaw is on screen.
///
/// Not verified: this was written without Xcode, like the rest of this folder.
/// Expect small build fixes the first time.
final class AgentBridge: ObservableObject {
    static let shared = AgentBridge()
    static let port: NWEndpoint.Port = 7862

    @Published private(set) var running = false
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "ai.neuroclaw.agent-bridge")
    private let defaults = UserDefaults.standard

    /// Made once from the system's secure random source.
    var token: String {
        if let existing = defaults.string(forKey: "bridgeToken"), !existing.isEmpty { return existing }
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let made = bytes.map { String(format: "%02x", $0) }.joined()
        defaults.set(made, forKey: "bridgeToken")
        return made
    }

    /// Whether the bridge listens on Wi-Fi (for a PC) rather than only on this phone. Off by default.
    var lan: Bool {
        get { defaults.bool(forKey: "bridgeLan") }
        set { defaults.set(newValue, forKey: "bridgeLan") }
    }

    var enabled: Bool {
        get { defaults.bool(forKey: "bridgeEnabled") }
        set { defaults.set(newValue, forKey: "bridgeEnabled"); newValue ? start() : stop() }
    }

    func startIfEnabled() { if enabled { start() } }

    func start() {
        stop()
        do {
            let parameters = NWParameters.tcp
            if !lan {
                parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: Self.port)
            } else {
                // A specific port is only given alongside no required endpoint.
                parameters.requiredLocalEndpoint = nil
            }
            let listener = lan ? try NWListener(using: parameters, on: Self.port) : try NWListener(using: parameters)
            listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
            listener.stateUpdateHandler = { [weak self] state in
                DispatchQueue.main.async { self?.running = (state == .ready) }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            DispatchQueue.main.async { self.running = false }
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        DispatchQueue.main.async { self.running = false }
    }

    // MARK: - HTTP

    private struct Request {
        let method: String
        let path: String
        let auth: String
        let body: Data
    }

    private struct Response {
        let status: Int
        let type: String
        let body: Data
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        var buffer = Data()
        func receive() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, finished, error in
                guard let self else { connection.cancel(); return }
                if let data { buffer.append(data) }
                if let request = Self.parse(buffer) {
                    Task {
                        let response = await self.route(request)
                        connection.send(content: Self.serialize(response), completion: .contentProcessed { _ in connection.cancel() })
                    }
                } else if finished || error != nil || buffer.count > 200_000 {
                    connection.cancel()
                } else {
                    receive()
                }
            }
        }
        receive()
    }

    /// Nil until the whole request (headers and the declared body) has arrived.
    private static func parse(_ data: Data) -> Request? {
        guard let split = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(decoding: data[..<split.lowerBound], as: UTF8.self)
        let lines = head.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ")
        guard first.count >= 2 else { return nil }
        var length = 0
        var auth = ""
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if name == "content-length" { length = Int(value) ?? 0 }
            if name == "authorization" { auth = value }
        }
        let body = data[split.upperBound...]
        guard length <= 65_536, body.count >= length else { return nil }
        return Request(method: String(first[0]), path: String(first[1]), auth: auth, body: Data(body.prefix(length)))
    }

    private static func serialize(_ response: Response) -> Data {
        var out = Data("HTTP/1.1 \(response.status) \(response.status == 200 ? "OK" : "Error")\r\nContent-Type: \(response.type)\r\nContent-Length: \(response.body.count)\r\nConnection: close\r\n\r\n".utf8)
        out.append(response.body)
        return out
    }

    private func json(_ status: Int, _ value: Any) -> Response {
        let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
        return Response(status: status, type: "application/json", body: data)
    }

    private func fail(_ status: Int, _ message: String) -> Response { json(status, ["error": message]) }

    // MARK: - Routes

    private func route(_ request: Request) async -> Response {
        let presented = request.auth.hasPrefix("Bearer ") ? String(request.auth.dropFirst(7)) : ""
        guard Self.constantTimeEqual(presented, token) else { return fail(401, "Missing or wrong bridge token.") }
        let body = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any] ?? [:]

        switch "\(request.method) \(request.path)" {
        case "GET /v1/info":
            return json(200, [
                "platform": "ios",
                "features": [
                    "windows": true, "screenshot": true, "keyboard": true, "pointer": false,
                    "moveResize": false, "settings": false, "launch": true,
                ],
                "notes": [
                    "iPhone: iOS lets an app see and screenshot only itself, so the window list and screenshots cover NeuroClaw's own screen, not other apps.",
                    "iPhone: taps cannot be sent, and the bridge only answers while NeuroClaw is on screen.",
                ],
            ])
        case "GET /v1/tools":
            return json(200, ["tools": NativeToolRegistry.definitions])
        case "POST /v1/tools":
            guard let name = body["name"] as? String, !name.isEmpty else {
                return fail(400, "name is required; send {name, arguments}.")
            }
            let arguments = body["arguments"] as? [String: Any] ?? [:]
            let (status, result) = await NativeToolRegistry.invoke(name: name, arguments: arguments)
            return json(status, result)
        case "GET /v1/windows":
            let rows: [[String: Any]] = await MainActor.run {
                Self.ownWindows().enumerated().map { index, window in
                    ["id": String(index), "title": window.windowScene?.title ?? "NeuroClaw", "pid": 0, "host": "ios", "owned": true]
                }
            }
            return json(200, rows)
        case "GET /v1/screenshot":
            let png: Data? = await MainActor.run { Self.screenshot() }
            guard let png else { return fail(500, "NeuroClaw has no window on screen to capture.") }
            return Response(status: 200, type: "image/png", body: png)
        case "POST /v1/type":
            guard let text = body["text"] as? String, !text.isEmpty, text.count <= 10_000 else {
                return fail(400, "text must be 1 to 10000 characters.")
            }
            let problem: String? = await MainActor.run { Self.type(text) }
            return problem.map { fail(409, $0) } ?? json(200, ["ok": true])
        case "POST /v1/click":
            return fail(501, "iOS does not let an app send taps, even to itself.")
        case "POST /v1/close":
            return fail(501, "iOS does not let an app close its own screens on request.")
        case "POST /v1/launch":
            guard let target = body["target"] as? String, let url = URL(string: target), url.scheme != nil else {
                return fail(400, "target must be a URL such as maps:// or https://example.com.")
            }
            // canOpenURL would need every scheme pre-declared in Info.plist; the
            // open call itself says whether anything handled it.
            let opened: Bool = await withCheckedContinuation { continuation in
                DispatchQueue.main.async {
                    UIApplication.shared.open(url, options: [:]) { continuation.resume(returning: $0) }
                }
            }
            return opened ? json(200, ["ok": true]) : fail(409, "Nothing on this phone could open \(target).")
        default:
            return fail(404, "No such endpoint.")
        }
    }

    // MARK: - UIKit (main actor only)

    @MainActor private static func ownWindows() -> [UIWindow] {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
    }

    @MainActor private static func screenshot() -> Data? {
        guard let window = ownWindows().first(where: { $0.isKeyWindow }) ?? ownWindows().first else { return nil }
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        return renderer.image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: false) }.pngData()
    }

    /// Insert text where the keyboard is already pointed -- the first responder
    /// -- found through the public responder chain. Never into a secure field.
    @MainActor private static func type(_ text: String) -> String? {
        FirstResponderProbe.found = nil
        UIApplication.shared.sendAction(#selector(UIResponder.neuroclawNoteFirstResponder), to: nil, from: nil, for: nil)
        guard let responder = FirstResponderProbe.found else { return "No text field has focus. Tap one first." }
        defer { FirstResponderProbe.found = nil }
        if let traits = responder as? UITextInputTraits, traits.isSecureTextEntry == true {
            return "Refusing to type into a password field."
        }
        guard let input = responder as? UIKeyInput else { return "The focused view does not take text." }
        input.insertText(text)
        return nil
    }

    private static func constantTimeEqual(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<x.count { diff |= x[i] ^ y[i] }
        return diff == 0
    }
}

/// Holds the responder that answered the probe action. Only touched on the main actor.
private enum FirstResponderProbe {
    @MainActor static weak var found: UIResponder?
}

private extension UIResponder {
    /// Sent to `nil` so UIKit delivers it to whichever responder is first.
    @objc func neuroclawNoteFirstResponder() {
        FirstResponderProbe.found = self
    }
}
