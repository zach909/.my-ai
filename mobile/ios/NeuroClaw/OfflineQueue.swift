import Foundation

/// Conversation turns and photos waiting to sync to the PC, kept in the app's own files.
final class OfflineQueue {
    struct Photo { let file: URL; let jpeg: Data; let note: String; let capturedAt: Int }
    struct Turn: Codable { let message: String; let reply: String; let at: Int }

    private let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("pending")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private var turnsFile: URL { dir.appendingPathComponent("turns.json") }

    func turns() -> [Turn] {
        (try? JSONDecoder().decode([Turn].self, from: Data(contentsOf: turnsFile))) ?? []
    }
    private func save(_ list: [Turn]) {
        try? JSONEncoder().encode(list).write(to: turnsFile)
    }

    func add(turn message: String, reply: String) {
        save(turns() + [Turn(message: message, reply: reply, at: Int(Date().timeIntervalSince1970 * 1000))])
    }
    /// The first `count` turns reached the PC.
    func dropTurns(_ count: Int) { save(Array(turns().dropFirst(count))) }

    func add(photo: Data, note: String, capturedAt: Int) {
        let base = dir.appendingPathComponent("\(capturedAt)")
        try? photo.write(to: base.appendingPathExtension("jpg"))
        try? JSONSerialization.data(withJSONObject: ["note": note, "capturedAt": capturedAt]).write(to: base.appendingPathExtension("json"))
    }
    func nextPhoto() -> Photo? {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        guard let jpg = files.filter({ $0.pathExtension == "jpg" }).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }).first,
              let data = try? Data(contentsOf: jpg) else { return nil }
        let meta = (try? JSONSerialization.jsonObject(with: Data(contentsOf: jpg.deletingPathExtension().appendingPathExtension("json")))) as? [String: Any]
        return Photo(file: jpg, jpeg: data, note: meta?["note"] as? String ?? "", capturedAt: meta?["capturedAt"] as? Int ?? 0)
    }
    func dropPhoto(_ photo: Photo) {
        try? FileManager.default.removeItem(at: photo.file)
        try? FileManager.default.removeItem(at: photo.file.deletingPathExtension().appendingPathExtension("json"))
    }
    func counts() -> (turns: Int, photos: Int) {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return (turns().count, files.filter { $0.pathExtension == "jpg" }.count)
    }
}
