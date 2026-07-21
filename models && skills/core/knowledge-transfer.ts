/**
 * Knowledge Transfer (ASI §7).
 *
 * Finds *structural* similarity between problems even when their subjects are
 * unrelated, so a method learned in one domain can be reused in another. Each
 * solved problem is registered with its domain and the method that solved it;
 * a new problem is matched against them by overlap of *structural* words
 * (operations/relations like "minimize", "flow", "route", "balance") rather
 * than domain nouns, and cross-domain matches are preferred — that is where the
 * non-obvious transfer lives.
 */

export interface SolvedProblem {
  problem: string;
  domain: string;
  method: string;
  structural: string[];
}

export interface TransferHit {
  source: SolvedProblem;
  similarity: number;
  crossDomain: boolean;
}

/** Operation/relation words that describe a problem's *shape*, not its subject. */
const STRUCTURAL_VOCAB = new Set([
  "minimize", "maximize", "optimize", "reduce", "increase", "balance", "distribute", "allocate",
  "schedule", "route", "search", "sort", "compare", "match", "transform", "sequence", "constraint",
  "flow", "rate", "network", "path", "cycle", "dependency", "feedback", "equilibrium", "gradient",
  "threshold", "capacity", "bottleneck", "propagate", "diffuse", "spread", "cluster", "partition",
  "map", "reverse", "merge", "split", "predict", "classify", "rank", "select", "combine", "through",
]);

export class KnowledgeTransfer {
  private solved: SolvedProblem[] = [];

  /** Register a solved problem and the method that worked. */
  register(problem: string, domain: string, method: string): SolvedProblem {
    const rec: SolvedProblem = { problem, domain, method, structural: structuralTokens(problem) };
    this.solved.push(rec);
    return rec;
  }

  /**
   * Find past problems structurally similar to `problem`, preferring ones from
   * a *different* domain (the useful, non-obvious transfers).
   */
  transfer(problem: string, opts: { domain?: string; topK?: number; preferCrossDomain?: boolean } = {}): TransferHit[] {
    const topK = opts.topK ?? 3;
    const preferCross = opts.preferCrossDomain ?? true;
    const q = new Set(structuralTokens(problem));
    if (q.size === 0) return [];
    const hits: TransferHit[] = [];
    for (const s of this.solved) {
      if (opts.domain && s.domain === opts.domain && s.problem === problem) continue;
      let overlap = 0;
      const seen = new Set<string>();
      for (const t of s.structural) if (q.has(t) && !seen.has(t)) { overlap++; seen.add(t); }
      if (overlap === 0) continue;
      const base = overlap / Math.sqrt(q.size * (s.structural.length || 1));
      const crossDomain = opts.domain !== undefined ? s.domain !== opts.domain : true;
      const similarity = preferCross && crossDomain ? base * 1.25 : base;
      hits.push({ source: s, similarity, crossDomain });
    }
    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, topK);
  }

  size(): number {
    return this.solved.length;
  }
}

function structuralTokens(problem: string): string[] {
  const toks = (problem || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const structural = toks.filter(t => STRUCTURAL_VOCAB.has(t));
  // Fall back to all content tokens if the problem uses no structural vocabulary.
  return structural.length > 0 ? Array.from(new Set(structural)) : Array.from(new Set(toks.filter(t => t.length > 3)));
}
