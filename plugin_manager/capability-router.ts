/**
 * Which plugin should handle this, and how do we decide without running them.
 *
 * The problem this replaces, measured rather than assumed: dispatch routed
 * through a hardcoded intent -> plugin-name table, and 26 of the 35 registered
 * plugins appeared nowhere in it. Store, research, email, calendar, camera,
 * robotics, the coding and image skills -- none of them could be reached from
 * a chat message at all, no matter what the message said. They were registered,
 * activated, health-checked, and unreachable.
 *
 * The second problem was how the reachable nine were chosen: try each
 * candidate's onMessage() in order until one returns non-null. That makes
 * "can you handle this?" and "handle this" the same operation, so finding out
 * a plugin is not the right one costs a full execution of it -- including any
 * disk or network work it does before deciding. It also means a plugin's
 * ability to be selected depends on the order of a hand-maintained list.
 *
 * So: plugins declare what they handle, the router SCORES those declarations
 * against the message, and only the best few are actually called. Scoring is
 * string work over a prebuilt index -- no plugin code runs during selection.
 *
 * The intent map is kept, but as a prior rather than a gate: an intent that
 * names a plugin boosts it, and a plugin nobody thought to list can still win
 * on the strength of what it declares. That distinction is the whole point --
 * a routing table you must remember to update is a routing table that will be
 * out of date, and the failure mode is silent.
 */

import type { BasePlugin } from "./sdk.js";

/** What a plugin says it can do. */
export interface PluginCapability {
  /** Words that indicate this plugin, e.g. "publish", "install", "screenshot". */
  verbs?: string[];
  /** Things it acts on, e.g. "store", "wiki", "window", "file". */
  nouns?: string[];
  /**
   * Exact command prefixes it owns, e.g. "store install". A prefix match is
   * decisive -- someone typing a plugin's own command syntax has already said
   * which plugin they mean, and no amount of word overlap should outvote that.
   */
  commands?: string[];
  /** Nudges a plugin up or down when two genuinely overlap. Defaults to 0. */
  weight?: number;
}

/** A plugin that describes itself. Optional -- anything without it still gets a default. */
export interface DescribesCapabilities {
  describeCapabilities(): PluginCapability;
}

export function describesCapabilities(p: unknown): p is DescribesCapabilities {
  return typeof (p as DescribesCapabilities)?.describeCapabilities === "function";
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "to", "in", "on", "for",
  "with", "and", "or", "but", "it", "this", "that", "my", "me", "you", "i", "can", "could",
  "would", "please", "do", "does", "did", "how", "what", "when", "where", "why", "get", "got",
]);

/**
 * Reduce a word to a form that matches its relatives.
 *
 * Without this, seven plugins stayed unreachable for the most ordinary
 * phrasings: "calculate" missed "calculator", "code" missed "coding",
 * "notification" missed "notifications", "screenshot" missed "screenshots".
 * Someone typing the singular of a plugin's own noun should not fail to find
 * it, and asking every plugin author to list every inflection is a rule that
 * will be forgotten on the first plugin written after this comment.
 *
 * Deliberately crude -- suffix stripping, not a real stemmer. It only needs to
 * make related forms collide, and a heavier stemmer would be a dependency and
 * a source of surprises for a job this small. The 3-character floor keeps it
 * from mangling short words into each other.
 */
export function stem(word: string): string {
  let w = word;
  for (const suffix of ["ings", "ing", "ors", "or", "ers", "er", "ies", "es", "ed", "s", "e"]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

export function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

interface IndexedPlugin {
  id: string;
  commands: string[];
  /** verb/noun terms, deduped. */
  terms: Set<string>;
  weight: number;
}

export interface Ranked {
  id: string;
  score: number;
  /** Why it was chosen, so a routing decision can be explained rather than guessed at. */
  reason: string;
}

/**
 * Builds the index once and answers "who should handle this" cheaply.
 *
 * Rebuilt when plugins change rather than on every message: the index is a
 * function of the plugin set, and recomputing it per message would put the
 * cost back exactly where this class exists to remove it.
 */
export class CapabilityRouter {
  private index: IndexedPlugin[] = [];

  /** Rebuild from the live plugin set. Cheap, and only called when that set changes. */
  reindex(plugins: Map<string, BasePlugin>, fallbackCapabilities: Record<string, string[]> = {}): void {
    this.index = [];
    for (const [id, plugin] of plugins) {
      const declared: PluginCapability = describesCapabilities(plugin)
        ? plugin.describeCapabilities()
        : {};

      // Anything that does not describe itself still gets a usable default,
      // built from its id and its manifest capability strings. A plugin with
      // no declaration should be worse at being found than one with a good
      // declaration -- it should not be impossible to find, which is what the
      // hardcoded table made it.
      const terms = new Set<string>();
      for (const term of tokenize(id.replace(/-/g, " "))) terms.add(term);
      for (const cap of fallbackCapabilities[id] ?? []) {
        for (const term of tokenize(cap.replace(/-/g, " "))) terms.add(term);
      }
      // Stemmed like everything else: a declared noun that skipped
      // normalisation would match worse than one that came in through a
      // manifest string, which is a trap for whoever writes the next plugin.
      for (const verb of declared.verbs ?? []) terms.add(stem(verb.toLowerCase()));
      for (const noun of declared.nouns ?? []) terms.add(stem(noun.toLowerCase()));

      this.index.push({
        id,
        commands: (declared.commands ?? []).map(c => c.toLowerCase()),
        terms,
        weight: declared.weight ?? 0,
      });
    }
  }

  size(): number {
    return this.index.length;
  }

  /**
   * Rank plugins for a message. Never executes anything.
   *
   * @param intentCandidates plugin ids the intent map suggested, as a prior.
   */
  rank(input: string, intentCandidates: string[] = []): Ranked[] {
    const lower = input.toLowerCase().trim();
    const terms = new Set(tokenize(input));
    const intentRank = new Map(intentCandidates.map((id, i) => [id, i]));

    const ranked: Ranked[] = [];
    for (const entry of this.index) {
      let score = 0;
      let reason = "";

      // An exact command prefix is decisive: the person typed this plugin's
      // own syntax.
      const command = entry.commands.find(c => lower === c || lower.startsWith(c + " ") || lower.startsWith(c + "\n"));
      if (command) {
        score += 100;
        reason = `names its command "${command}"`;
      }

      let overlap = 0;
      for (const term of entry.terms) if (terms.has(term)) overlap++;
      if (overlap > 0) {
        score += overlap * 4;
        if (!reason) reason = `${overlap} matching term${overlap === 1 ? "" : "s"}`;
      }

      // The intent map as a prior: earlier in its list means a stronger hint,
      // but it can be outscored by a plugin that genuinely matches the words.
      const prior = intentRank.get(entry.id);
      if (prior !== undefined) {
        score += Math.max(1, 6 - prior);
        if (!reason) reason = "suggested by intent";
      }

      score += entry.weight;
      if (score > 0) ranked.push({ id: entry.id, score, reason: reason || "weighted" });
    }

    // Deterministic: ties break by id, so the same message always routes the
    // same way. A router whose answer depends on Map insertion order is a
    // router that will behave differently after an unrelated refactor.
    ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return ranked;
  }
}
