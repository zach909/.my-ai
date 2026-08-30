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
        const maxItems = opts.maxItems ?? Infinity;
        // Optimization: Single-pass text trimming, non-empty filtering, and length summation
        // to avoid intermediate array allocations (.map().filter().reduce()).
        const items = [];
        let originalChars = 0;
        for (let i = 0; i < texts.length; i++) {
            const trimmed = (texts[i] ?? "").trim();
            if (trimmed.length > 0) {
                items.push(trimmed);
                originalChars += trimmed.length;
            }
        }
        if (items.length === 0) {
            return { summary: "", originalCount: 0, keptCount: 0, originalChars: 0, compressedChars: 0, ratio: 0 };
        }
        const n = items.length;
        // Corpus-wide term salience = how often a content word appears overall.
        const salience = new Map();
        const itemTokens = new Array(n);
        // Optimization: Pre-allocated token arrays and single pass salience counting.
        for (let i = 0; i < n; i++) {
            const toks = tokenize(items[i]);
            itemTokens[i] = toks;
            const seen = new Set();
            for (let j = 0; j < toks.length; j++) {
                const w = toks[j];
                if (!seen.has(w)) {
                    seen.add(w);
                    salience.set(w, (salience.get(w) ?? 0) + 1);
                }
            }
        }
        // Score each item by its mean salient-term weight (length-normalized so
        // long, low-signal items don't win purely on length).
        // Optimization: Pre-allocated scored array to eliminate .map() allocation.
        const scored = new Array(n);
        for (let i = 0; i < n; i++) {
            const toks = itemTokens[i];
            let s = 0;
            for (let j = 0; j < toks.length; j++) {
                s += salience.get(toks[j]) ?? 0;
            }
            const score = toks.length > 0 ? s / Math.sqrt(toks.length) : 0;
            scored[i] = { text: items[i], i, score };
        }
        // Greedy selection by score, under the character and item budgets.
        const byScore = scored.slice().sort((a, b) => b.score - a.score || a.i - b.i);
        const keptIdx = new Set();
        let used = 0;
        const sepLen = separator.length;
        for (let k = 0; k < n; k++) {
            if (keptIdx.size >= maxItems)
                break;
            const item = byScore[k];
            const addLen = item.text.length + (keptIdx.size > 0 ? sepLen : 0);
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
        // Optimization: Direct array iteration in original index order instead of
        // calling .filter().sort().map() chains.
        const kept = [];
        for (let i = 0; i < n; i++) {
            if (keptIdx.has(i)) {
                kept.push(scored[i].text);
            }
        }
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
/**
 * Optimization: Fast index-based character scanning loop for string tokenization.
 * Replaces regex split (/^\a-z0-9]+/) and .filter() array chains, filtering
 * short tokens (len <= 1) and stopwords inline without temporary array allocations.
 */
function tokenize(text) {
    if (!text)
        return [];
    const tokens = [];
    const str = text.toLowerCase();
    const len = str.length;
    let start = -1;
    for (let i = 0; i < len; i++) {
        const ch = str.charCodeAt(i);
        const isAlnum = (ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57);
        if (isAlnum) {
            if (start === -1)
                start = i;
        }
        else {
            if (start !== -1) {
                if (i - start > 1) {
                    const w = str.substring(start, i);
                    if (!STOPWORDS.has(w))
                        tokens.push(w);
                }
                start = -1;
            }
        }
    }
    if (start !== -1 && len - start > 1) {
        const w = str.substring(start, len);
        if (!STOPWORDS.has(w))
            tokens.push(w);
    }
    return tokens;
}
