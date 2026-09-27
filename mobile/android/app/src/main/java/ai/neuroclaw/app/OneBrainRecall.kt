package ai.neuroclaw.app

import android.content.Context
import org.json.JSONObject

/**
 * OneBrain on the phone: the same memory model the PC grafts into its mesh,
 * shipped in the app (assets/onebrain/model.json) so there is something that
 * answers when the PC cannot be reached.
 *
 * It is small (tens of neurons) and runs the same recall the PC's
 * recallFromSelfExtensions() does: every byte of the message activates its
 * input neuron, the weighted connections feed the output neurons, and the
 * strongest outputs come back. It is memory, not the full network -- the
 * full mesh only runs on the PC.
 */
class OneBrainRecall(context: Context) {
    private val edges: List<Triple<Int, Int, Double>>

    init {
        edges = runCatching {
            val text = context.assets.open("onebrain/model.json").bufferedReader().use { it.readText() }
            parse(JSONObject(text))
        }.getOrDefault(emptyList())
    }

    val size: Int get() = edges.size

    private fun parse(model: JSONObject): List<Triple<Int, Int, Double>> {
        val inRe = Regex("^(?:memory_input|mem_in)_b(\\d+)$")
        val outRe = Regex("^(?:memory_output|mem_out)_b(\\d+)$")
        val byId = HashMap<String, Pair<Boolean, Int>>()
        val neurons = model.getJSONArray("neurons")
        for (i in 0 until neurons.length()) {
            val n = neurons.getJSONArray(i).getJSONObject(1)
            val label = n.optString("label")
            inRe.find(label)?.let { byId[n.getString("id")] = true to it.groupValues[1].toInt() }
            outRe.find(label)?.let { byId[n.getString("id")] = false to it.groupValues[1].toInt() }
        }
        val weights = model.getJSONArray("weights")
        val out = ArrayList<Triple<Int, Int, Double>>()
        val conns = model.getJSONArray("connections")
        for (i in 0 until conns.length()) {
            val c = conns.getJSONArray(i).getJSONObject(1)
            val from = byId[c.getString("fromNeuronId")] ?: continue
            val to = byId[c.getString("toNeuronId")] ?: continue
            if (!from.first || to.first) continue
            val w = weights.opt(c.getInt("weightIndex")) as? Number ?: continue
            out.add(Triple(from.second, to.second, w.toDouble()))
        }
        return out
    }

    /** The strongest output bytes for `message`, as readable characters. */
    fun recall(message: String, topK: Int = 5): List<String> {
        val active = message.toByteArray(Charsets.UTF_8).map { it.toInt() and 0xff }.toSet()
        val scores = HashMap<Int, Double>()
        for ((from, to, w) in edges) if (from in active) scores[to] = (scores[to] ?: 0.0) + w
        return scores.entries.sortedByDescending { it.value }.take(topK).map { (b, _) ->
            if (b in 32..126) b.toChar().toString() else "byte $b"
        }
    }
}
