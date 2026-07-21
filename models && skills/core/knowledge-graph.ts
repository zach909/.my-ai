/**
 * Knowledge Integration (ASI §4).
 *
 * Long-term memory stores *episodes* (conversation turns, task results) keyed by
 * relevance. This is the complementary *semantic* structure the spec asks for:
 * memory as an interconnected knowledge graph — concepts (nodes) joined by typed
 * relations (edges) — that the system can search by meaning, follow along
 * relationships, combine across nodes, and check for contradictions.
 *
 * Deterministic and local: concept embeddings are token bag-of-words (cosine
 * search), relations are explicit typed edges, and contradiction detection uses
 * a small set of negation pairs.
 */

export interface Concept {
  id: string;
  name: string;
  definition: string;
  embedding: number[];
  createdAt: number;
}

export interface Relation {
  from: string;
  type: string;
  to: string;
  weight: number;
  confidence: number;
  timestamp: number;
  /** True once a higher-confidence relation has superseded this one (ASI §4: "update outdated knowledge"). */
  superseded: boolean;
}

export interface ConceptHit {
  concept: Concept;
  score: number;
}

/** Relation types that assert the opposite of one another (for contradictions). */
const NEGATION_PAIRS: Array<[string, string]> = [
  ["is", "is-not"],
  ["can", "cannot"],
  ["causes", "prevents"],
  ["true", "false"],
  ["increases", "decreases"],
  ["requires", "excludes"],
];

export class KnowledgeGraph {
  private concepts = new Map<string, Concept>();
  private relations: Relation[] = [];
  private readonly dim: number;

  constructor(dim = 256) {
    this.dim = dim;
  }

  /** Add or update a concept (keyed by normalized name). */
  addConcept(name: string, definition = ""): Concept {
    const id = normalize(name);
    const existing = this.concepts.get(id);
    if (existing) {
      if (definition) {
        existing.definition = definition;
        existing.embedding = this.embed(`${name} ${definition}`);
      }
      return existing;
    }
    const concept: Concept = { id, name, definition, embedding: this.embed(`${name} ${definition}`), createdAt: Date.now() };
    this.concepts.set(id, concept);
    return concept;
  }

  getConcept(name: string): Concept | undefined {
    return this.concepts.get(normalize(name));
  }
  conceptCount(): number {
    return this.concepts.size;
  }

  /** Assert a typed relation between two concepts (creating them if needed). */
  relate(from: string, type: string, to: string, opts: { weight?: number; confidence?: number } = {}): Relation {
    this.addConcept(from);
    this.addConcept(to);
    const rel: Relation = {
      from: normalize(from),
      type: normalize(type),
      to: normalize(to),
      weight: opts.weight ?? 1,
      confidence: opts.confidence ?? 1,
      timestamp: Date.now(),
      superseded: false,
    };
    this.relations.push(rel);
    return rel;
  }

  /**
   * Mark existing (from,type,to) relations as superseded by newer knowledge
   * (ASI §4: "update outdated knowledge") rather than deleting them — history
   * is preserved, but `current()` no longer surfaces them as believed. Returns
   * how many relations were marked.
   */
  supersede(from: string, type: string, to: string): number {
    const f = normalize(from);
    const t = normalize(type);
    const o = normalize(to);
    let count = 0;
    for (const r of this.relations) {
      if (r.from === f && r.type === t && r.to === o && !r.superseded) {
        r.superseded = true;
        count++;
      }
    }
    return count;
  }

  /** Immediate neighbours of a concept, optionally filtered by relation type. Includes superseded relations (full history). */
  neighbors(name: string, relType?: string): Array<{ relation: Relation; concept: Concept }> {
    const id = normalize(name);
    const rt = relType ? normalize(relType) : undefined;
    const out: Array<{ relation: Relation; concept: Concept }> = [];
    for (const r of this.relations) {
      if (r.from === id && (!rt || r.type === rt)) {
        const c = this.concepts.get(r.to);
        if (c) out.push({ relation: r, concept: c });
      }
    }
    return out;
  }

  /** Like neighbors(), but excludes superseded relations — the "currently believed" view. */
  current(name: string, relType?: string): Array<{ relation: Relation; concept: Concept }> {
    return this.neighbors(name, relType).filter(n => !n.relation.superseded);
  }

  /**
   * Follow relations outward from a concept up to `depth` hops (optionally only
   * along the given relation types) — combining information across the graph.
   */
  follow(name: string, relTypes: string[] = [], depth = 2): Concept[] {
    const rts = new Set(relTypes.map(normalize));
    const start = normalize(name);
    const visited = new Set<string>([start]);
    let frontier = [start];
    const reached: Concept[] = [];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const r of this.relations) {
          if (r.from !== node) continue;
          if (rts.size > 0 && !rts.has(r.type)) continue;
          if (!visited.has(r.to)) {
            visited.add(r.to);
            const c = this.concepts.get(r.to);
            if (c) { reached.push(c); next.push(r.to); }
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return reached;
  }

  /** Semantic search over concepts (cosine on name+definition embeddings). */
  search(query: string, topK = 5): ConceptHit[] {
    const q = this.embed(query);
    const hits: ConceptHit[] = [];
    for (const c of this.concepts.values()) {
      const score = cosine(q, c.embedding);
      if (score > 0) hits.push({ concept: c, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  /**
   * Detect contradictions: the same (from,to) pair asserted with a relation and
   * its negation (e.g. `A is B` and `A is-not B`).
   */
  findContradictions(): Array<{ a: Relation; b: Relation }> {
    const negOf = new Map<string, string>();
    for (const [x, y] of NEGATION_PAIRS) { negOf.set(x, y); negOf.set(y, x); }
    const out: Array<{ a: Relation; b: Relation }> = [];
    for (let i = 0; i < this.relations.length; i++) {
      const a = this.relations[i];
      const opp = negOf.get(a.type);
      if (!opp) continue;
      for (let j = i + 1; j < this.relations.length; j++) {
        const b = this.relations[j];
        if (b.from === a.from && b.to === a.to && b.type === opp) out.push({ a, b });
      }
    }
    return out;
  }

  /**
   * Auto-link a concept to its semantically nearest existing concepts (above a
   * similarity floor) with a `related-to` edge — so new knowledge attaches to
   * related existing knowledge instead of sitting isolated.
   */
  integrate(name: string, definition = "", opts: { topK?: number; minScore?: number } = {}): Relation[] {
    const concept = this.addConcept(name, definition);
    const topK = opts.topK ?? 3;
    const minScore = opts.minScore ?? 0.15;
    const added: Relation[] = [];
    for (const hit of this.search(`${name} ${definition}`, topK + 1)) {
      if (hit.concept.id === concept.id) continue;
      if (hit.score < minScore) continue;
      added.push(this.relate(name, "related-to", hit.concept.name, { weight: Number(hit.score.toFixed(3)) }));
      if (added.length >= topK) break;
    }
    return added;
  }

  private embed(text: string): number[] {
    const v = new Array(this.dim).fill(0);
    for (const t of tokenize(text)) {
      let h = 2166136261;
      for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
      const idx = (h >>> 0) % this.dim;
      v[idx] += (h & 1) === 0 ? 1 : -1;
    }
    return v;
  }
}

function normalize(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function tokenize(text: string): string[] {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}
function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
