import Foundation

/// OneBrain on the phone: the memory model bundled from the PC (model.json),
/// running the same byte recall the PC's recallFromSelfExtensions() does.
/// Memory only -- the full network runs on the PC.
struct OneBrainRecall {
    private var edges: [(from: Int, to: Int, weight: Double)] = []

    init() {
        guard let url = Bundle.main.url(forResource: "model", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let model = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let neurons = model["neurons"] as? [[Any]],
              let connections = model["connections"] as? [[Any]],
              let weights = model["weights"] as? [Any] else { return }
        var byId: [String: (isInput: Bool, byte: Int)] = [:]
        for entry in neurons {
            guard entry.count == 2, let n = entry[1] as? [String: Any], let id = n["id"] as? String,
                  let label = n["label"] as? String else { continue }
            for (prefix, isInput) in [("memory_input_b", true), ("memory_output_b", false)] where label.hasPrefix(prefix) {
                if let byte = Int(label.dropFirst(prefix.count)) { byId[id] = (isInput, byte) }
            }
        }
        for entry in connections {
            guard entry.count == 2, let c = entry[1] as? [String: Any],
                  let from = (c["fromNeuronId"] as? String).flatMap({ byId[$0] }),
                  let to = (c["toNeuronId"] as? String).flatMap({ byId[$0] }),
                  from.isInput, !to.isInput,
                  let index = c["weightIndex"] as? Int, index < weights.count,
                  let weight = weights[index] as? Double else { continue }
            edges.append((from.byte, to.byte, weight))
        }
    }

    func recall(_ message: String, topK: Int = 5) -> [String] {
        let active = Set(Array(message.utf8).map(Int.init))
        var scores: [Int: Double] = [:]
        for e in edges where active.contains(e.from) { scores[e.to, default: 0] += e.weight }
        return scores.sorted { $0.value > $1.value }.prefix(topK).map { (byte, _) in
            (32...126).contains(byte) ? String(UnicodeScalar(UInt8(byte))) : "byte \(byte)"
        }
    }
}
