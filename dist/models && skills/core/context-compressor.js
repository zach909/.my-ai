/**
 * Context Compression (Spec Section 7).
 *
 * Section 7 distinguishes "Compressed context" as its own category, separate
 * from active working context and long-term memory. The ZipIO buffer already
 * does *byte-level* compression (gzip); this module does *semantic* compression
 * — condensing many turns/memories into a compact extractive summary that keeps
 * the salient content and drops filler, within a character budget.
 *
 * The method is deterministic and local (no external APIs): term-frequency
 * salience over the whole set, length-normalized per-item scoring, greedy
 * selection under a budget, and re-ordering of the kept items back into their
 * original order so the summary still reads in sequence.
 */
export class ContextCompressor {
    /** Condense a list of texts into a compact, salient summary. */
    compress(texts, opts = {}) {
        const maxChars = opts.maxChars ?? 600;
        const separator = opts.separator ?? " / ";
        const items = texts.map(t => (t ?? "").trim()).filter(Boolean);
        const originalChars = items.reduce((s, t) => s + t.length, 0);
        if (items.length === 0) {
            return { summary: "", originalCount: 0, keptCount: 0, originalChars: 0, compressedChars: 0, ratio: 0 };
        }
        // Corpus-wide term salience = how often a content word appears overall.
        const salience = new Map();
        const itemTokens = items.map(t => tokenize(t));
        for (const toks of itemTokens) {
            for (const w of new Set(toks))
                salience.set(w, (salience.get(w) ?? 0) + 1);
        }
        // Score each item by its mean salient-term weight (length-normalized so
        // long, low-signal items don't win purely on length).
        const scored = items.map((text, i) => {
            const toks = itemTokens[i];
            let s = 0;
            for (const w of toks)
                s += salience.get(w) ?? 0;
            const score = toks.length > 0 ? s / Math.sqrt(toks.length) : 0;
            return { text, i, score };
        });
        // Greedy selection by score, under the character and item budgets.
        const byScore = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
        const keptIdx = new Set();
        let used = 0;
        const maxItems = opts.maxItems ?? Infinity;
        for (const item of byScore) {
            if (keptIdx.size >= maxItems)
                break;
            const addLen = item.text.length + (keptIdx.size > 0 ? separator.length : 0);
            if (used + addLen > maxChars && keptIdx.size > 0)
                continue;
            keptIdx.add(item.i);
            used += addLen;
            if (used >= maxChars)
                break;
        }
        // Always keep at least the single most salient item.
        if (keptIdx.size === 0)
            keptIdx.add(byScore[0].i);
        // Re-order kept items back into original sequence.
        const kept = scored.filter(x => keptIdx.has(x.i)).sort((a, b) => a.i - b.i).map(x => x.text);
        // Hard-enforce the budget: a single most-salient item longer than maxChars
        // is truncated so compressedChars never exceeds maxChars.
        let summary = kept.join(separator);
        if (summary.length > maxChars)
            summary = summary.slice(0, maxChars);
        return {
            summary,
            originalCount: items.length,
            keptCount: kept.length,
            originalChars,
            compressedChars: summary.length,
            // A ratio > 1 (possible only when nothing is dropped and separators are
            // added) correctly reads as "no compression"; lower means more.
            ratio: originalChars > 0 ? summary.length / originalChars : 0,
        };
    }
}
const STOPWORDS = new Set([
    "the", "and", "for", "are", "was", "were", "you", "your", "our", "this", "that", "with",
    "from", "did", "does", "how", "what", "which", "who", "when", "where", "why", "can", "will",
    "not", "its", "have", "has", "had", "into", "than", "then", "they", "them", "about", "just",
    "i", "a", "an", "is", "in", "on", "of", "to", "it", "at", "or", "as", "we", "me", "my", "be",
]);
function tokenize(text) {
    return (text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 1 && !STOPWORDS.has(w));
}
