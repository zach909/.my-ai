import Foundation
import UIKit

/// Offline-first NeuroClaw. The phone's own copy of the network
/// (PhoneNetwork: the PC's engine, run on the phone) answers every message.
/// The PC is for syncing whenever it is reachable:
///   phone -> PC  conversations, photos, yes/no examples taught on the phone;
///   PC -> phone  the PC's OneBrain when newer, and its yes/no knowledge.
/// Sync runs in the background after each message or photo, and from Sync now.
@MainActor
final class Brain: ObservableObject {
    struct Line: Identifiable { let id = UUID(); let who: String; let text: String }

    @Published var lines: [Line] = []
    @Published var busy = false
    @Published var syncStatus = ""
    @Published var serverURL: String = UserDefaults.standard.string(forKey: "serverURL") ?? "" {
        didSet { UserDefaults.standard.set(serverURL.trimmingCharacters(in: .whitespaces), forKey: "serverURL") }
    }
    @Published var password: String = UserDefaults.standard.string(forKey: "password") ?? "" {
        didSet { UserDefaults.standard.set(password, forKey: "password") }
    }

    let phone = PhoneNetwork()
    private let queue = OfflineQueue()
    private var syncing = false

    var pending: (turns: Int, photos: Int) { queue.counts() }

    func send(_ text: String) async {
        lines.append(Line(who: "You", text: text))
        busy = true
        defer { busy = false }
        var reply: String
        do {
            let a = try await phone.chat(text)
            let memory = a.recalled.isEmpty ? "" : "\n(OneBrain recalls: \(a.recalled.joined(separator: " ")))"
            reply = "\(a.reply)\(memory)"
        } catch {
            reply = "The phone's network failed: \(error.localizedDescription)"
        }
        lines.append(Line(who: "NeuroClaw", text: reply))
        queue.add(turn: text, reply: reply)
        Task { await sync() }
    }

    func capture(_ image: UIImage, note: String) {
        guard let jpeg = image.jpegData(compressionQuality: 0.9) else { return }
        queue.add(photo: jpeg, note: note, capturedAt: Int(Date().timeIntervalSince1970 * 1000))
        Task { await sync() }
    }

    /// One sync with the PC; a no-op without a PC address.
    func sync() async {
        guard !serverURL.trimmingCharacters(in: .whitespaces).isEmpty, !syncing else { return }
        syncing = true
        defer { syncing = false }
        do {
            let turns = queue.turns()
            let out = try await phone.syncOut(clear: false)
            let response = try await post("/api/phone-sync", [
                "turns": turns.map { ["message": $0.message, "reply": $0.reply, "at": $0.at] },
                "teach": out["teach"] ?? [],
                "oneBrainVersion": out["oneBrainVersion"] ?? 0,
            ])
            queue.dropTurns(turns.count)
            _ = try await phone.syncOut(clear: true)
            let model = (response["oneBrain"] as? [String: Any])?["model"] as? String
            let yesNo = (response["yesNo"]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }.map { String(decoding: $0, as: UTF8.self) }
            try await phone.syncIn(oneBrainModel: model, yesNoState: yesNo)
            var photos = 0
            while let photo = queue.nextPhoto() {
                _ = try await post("/api/captures", ["image": photo.jpeg.base64EncodedString(), "mime": "image/jpeg", "note": photo.note, "capturedAt": photo.capturedAt])
                queue.dropPhoto(photo)
                photos += 1
            }
            syncStatus = "Synced \(Date().formatted(date: .omitted, time: .shortened)): \(turns.count) turn(s), \(photos) photo(s)\(model != nil ? ", newer OneBrain from the PC" : "")."
        } catch let error as ServerError {
            syncStatus = "PC refused the sync: \(error.message)"
        } catch {
            syncStatus = "PC not reachable; everything stays on the phone until it is."
        }
    }

    struct ServerError: Error { let message: String }

    private func post(_ path: String, _ body: [String: Any]) async throws -> [String: Any] {
        let base = serverURL.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !base.isEmpty, let url = URL(string: base + path) else { throw URLError(.badURL) }
        var request = URLRequest(url: url, timeoutInterval: 60)
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
