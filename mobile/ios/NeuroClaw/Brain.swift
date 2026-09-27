import Foundation
import UIKit

/// The PC when reachable (POST /api/chat, /api/captures, HTTP Basic with the
/// Remote Access password); otherwise the full network on the phone
/// (PhoneNetwork) answers and the message is queued for the PC.
@MainActor
final class Brain: ObservableObject {
    struct Line: Identifiable { let id = UUID(); let who: String; let text: String }

    @Published var lines: [Line] = []
    @Published var busy = false
    @Published var serverURL: String = UserDefaults.standard.string(forKey: "serverURL") ?? "" {
        didSet { UserDefaults.standard.set(serverURL.trimmingCharacters(in: .whitespaces), forKey: "serverURL") }
    }
    @Published var password: String = UserDefaults.standard.string(forKey: "password") ?? "" {
        didSet { UserDefaults.standard.set(password, forKey: "password") }
    }

    private var history: [(String, String)] = []
    /// The full network on the phone: answers whenever the PC cannot.
    let phone = PhoneNetwork()
    private let queue = OfflineQueue()

    var pending: (messages: Int, photos: Int) { queue.counts() }

    func send(_ text: String) async {
        lines.append(Line(who: "You", text: text))
        busy = true
        defer { busy = false }
        do {
            try await flush()
            let reply = try await chat(text)
            lines.append(Line(who: "NeuroClaw", text: reply))
        } catch let error as ServerError {
            lines.append(Line(who: "NeuroClaw", text: "PC error: \(error.message)"))
        } catch {
            // PC not reachable: the phone's own network answers, and the
            // message is also queued so the PC sees it later.
            queue.add(message: text)
            do {
                let a = try await phone.chat(text)
                let memory = a.recalled.isEmpty ? "" : "\n(OneBrain recalls: \(a.recalled.joined(separator: " ")))"
                lines.append(Line(who: "NeuroClaw (phone)", text: "\(a.reply)\(memory)\n[phone network, \(a.ms) ms; also queued for your PC]"))
            } catch {
                lines.append(Line(who: "NeuroClaw (offline)", text: "The phone's network failed: \(error.localizedDescription). Your message is queued for your PC."))
            }
        }
    }

    func capture(_ image: UIImage, note: String) async -> Bool {
        guard let jpeg = image.jpegData(compressionQuality: 0.9) else { return false }
        let takenAt = Int(Date().timeIntervalSince1970 * 1000)
        do {
            try await upload(jpeg, note: note, capturedAt: takenAt)
            return true
        } catch {
            queue.add(photo: jpeg, note: note, capturedAt: takenAt)
            return false
        }
    }

    private func flush() async throws {
        while let message = queue.nextMessage() {
            let reply = try await chat("(sent while offline) \(message)")
            lines.append(Line(who: "NeuroClaw", text: reply))
            queue.dropMessage()
        }
        while let photo = queue.nextPhoto() {
            try await upload(photo.jpeg, note: photo.note, capturedAt: photo.capturedAt)
            queue.dropPhoto(photo)
        }
    }

    struct ServerError: Error { let message: String }

    private func chat(_ message: String) async throws -> String {
        let body: [String: Any] = [
            "message": message,
            "history": history.suffix(12).map { ["role": $0.0, "content": $0.1] },
        ]
        let json = try await post("/api/chat", body)
        let reply = json["response"] as? String ?? ""
        history.append(("user", message)); history.append(("ai", reply))
        return reply
    }

    private func upload(_ jpeg: Data, note: String, capturedAt: Int) async throws {
        _ = try await post("/api/captures", [
            "image": jpeg.base64EncodedString(), "mime": "image/jpeg", "note": note, "capturedAt": capturedAt,
        ])
    }

    private func post(_ path: String, _ body: [String: Any]) async throws -> [String: Any] {
        let base = serverURL.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !base.isEmpty, let url = URL(string: base + path) else { throw URLError(.badURL) }
        var request = URLRequest(url: url, timeoutInterval: 120)
        request.httpMethod = "POST"
        // JSON only: the server refuses other content types (CSRF protection).
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !password.isEmpty {
            let token = Data("neuroclaw:\(password)".utf8).base64EncodedString()
            request.setValue("Basic \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            throw ServerError(message: status == 401 ? "Wrong password for the PC" : (json["error"] as? String ?? "PC answered \(status)"))
        }
        return json
    }
}
