/**
 * Advanced & Recursive Reasoning (ASI §2 / §8).
 *
 * A multi-step reasoning process that ties the other subsystems together
 * instead of being a monolithic prompt: understand the problem, fix the
 * objective, gather available information (memory), identify what's missing,
 * generate several candidate approaches, predict/compare them, decompose the
 * chosen one into subproblems, delegate each subproblem to a specialized solver
 * (the hive / neural runner), detect known-mistake patterns, then combine,
 * revise and verify — recording the full trace so the same dead ends are not
 * repeated.
 *
 * It is dependency-injected: `recall` supplies available info from long-term
 * memory, `lessons` supplies preventions from past mistakes, `competence`
 * supplies the self-model's confidence, and `solveSub` delegates a subproblem
 * (in the running system, to the Hive Mind). Recursion (§8) happens either
 * through `solveSub` or, absent one, by re-entering `reason` on each subproblem
 * up to `depth`.
 */
export class ReasoningEngine {
    constructor(deps = {}) {
        this.deps = deps;
    }
    async reason(problem, opts = {}) {
        const depth = opts.depth ?? 1;
        const maxSub = opts.maxSubproblems ?? 4;
        const trace = [];
        const push = (kind, detail) => trace.push({ kind, detail });
        // 1-2. Understand the problem and fix the objective.
        const objective = deriveObjective(problem);
        push("understand", problem);
        push("objective", objective);
        // 3. Available information (from memory).
        const available = (this.deps.recall?.(problem) ?? []).slice(0, 8);
        push("available", `${available.length} relevant item(s)`);
        // 4. Missing information: salient problem terms not covered by available info.
        const covered = new Set(available.flatMap(a => tokenize(a)));
        let missing = uniq(tokenize(problem).filter(t => !covered.has(t) && !STOP.has(t))).slice(0, 8);
        push("missing", missing.length ? missing.join(", ") : "none identified");
        // 4b. Recognizing a gap is not enough on its own (§1): actively seek each
        // missing term via the injected search (e.g. the knowledge graph). Terms
        // that resolve move from `missing` into `available`; terms that don't stay
        // genuinely missing rather than being silently dropped.
        const soughtAndResolved = [];
        if (this.deps.search && missing.length > 0) {
            const stillMissing = [];
            for (const term of missing) {
                const hits = this.deps.search(term);
                if (hits.length > 0) {
                    available.push(...hits);
                    soughtAndResolved.push(term);
                }
                else {
                    stillMissing.push(term);
                }
            }
            missing = stillMissing;
            if (soughtAndResolved.length)
                push("sought", `resolved: ${soughtAndResolved.join(", ")}`);
        }
        // Known-mistake lessons for this task.
        const lessons = (this.deps.lessons?.(problem) ?? []).slice(0, 5);
        if (lessons.length)
            push("lessons", lessons.join(" | "));
        // 5-7. Generate several approaches, predict/compare, and choose the best.
        const subproblems = decompose(problem, maxSub);
        const competence = clamp01(this.deps.competence?.(problem) ?? 0.5);
        const approaches = [
            { strategy: "decompose", description: "Break into subproblems and solve each", score: 1 + subproblems.length * 0.1 },
            { strategy: "analogy", description: "Reason by analogy from recalled knowledge", score: available.length > 0 ? 1.2 : 0.4 },
            { strategy: "first-principles", description: "Derive a direct solution from fundamentals", score: 0.8 + competence * 0.3 },
        ];
        // ASI §1/§7: a structurally-similar method from another domain is a real,
        // choosable candidate, not just a report — combining cross-domain
        // knowledge into an actual solution rather than only ever using one
        // specialized approach.
        if (opts.transferHint) {
            approaches.push({
                strategy: "transfer",
                description: `Reuse "${opts.transferHint.method}" from the ${opts.transferHint.domain} domain (structurally similar problem)`,
                score: 0.9 + opts.transferHint.similarity * 0.4,
            });
        }
        // Predicted consequence: a known-mistake pattern lowers every approach's score.
        for (const a of approaches)
            a.score -= 0.15 * lessons.length;
        // Self-improvement feedback (§5/§12): bias scores by discovered
        // approach/outcome regularities, if the caller supplies them.
        if (this.deps.approachBias) {
            for (const a of approaches)
                a.score *= this.deps.approachBias(a.strategy);
        }
        approaches.sort((a, b) => b.score - a.score);
        const chosen = approaches[0].strategy;
        push("approaches", approaches.map(a => `${a.strategy}:${a.score.toFixed(2)}`).join(", "));
        push("chosen", chosen);
        // 8. Decompose the chosen approach into subproblems and delegate each.
        push("decompose", `${subproblems.length} subproblem(s)`);
        const subresults = [];
        for (const sub of subproblems) {
            const result = await this.solveSubproblem(sub, depth);
            subresults.push({ subproblem: sub, result });
        }
        // 9. Detect mistakes.
        let failed = subresults.filter(s => !s.result || /\[(error|unsolved|base):/i.test(s.result));
        if (failed.length)
            push("mistakes", `${failed.length} subproblem(s) unresolved`);
        // 10. Revise: a failed subproblem is not just reported, it's retried —
        // re-decompose the specific piece that failed into finer steps and attempt
        // those instead. This is a real corrective action (recursive intelligence,
        // §8, applied to error recovery), not a fabricated "revision" label.
        const revised = [];
        if (failed.length > 0 && depth > 0) {
            for (const f of failed) {
                const finer = decompose(f.subproblem, Math.min(3, maxSub)).filter(sf => sf !== f.subproblem);
                if (finer.length === 0)
                    continue;
                const finerResults = await Promise.all(finer.map(sf => this.solveSubproblem(sf, depth - 1)));
                const stillFailing = finerResults.some(r => !r || /\[(error|unsolved|base):/i.test(r));
                if (!stillFailing) {
                    const idx = subresults.findIndex(s => s.subproblem === f.subproblem);
                    if (idx >= 0)
                        subresults[idx] = { subproblem: f.subproblem, result: finerResults.join(" ") };
                    revised.push(f.subproblem);
                }
            }
            if (revised.length)
                push("revise", `resolved via re-decomposition: ${revised.join(", ")}`);
            failed = subresults.filter(s => !s.result || /\[(error|unsolved|base):/i.test(s.result));
        }
        // Combine into a result.
        const analogyNote = chosen === "analogy" && available.length ? `\nGrounded in: ${available.slice(0, 2).join(" | ")}` : "";
        const transferNote = chosen === "transfer" && opts.transferHint
            ? `\nTransferred method: "${opts.transferHint.method}" (from ${opts.transferHint.domain})`
            : "";
        const result = subresults.map(s => `- ${s.subproblem}: ${s.result}`).join("\n") + analogyNote + transferNote;
        // 11. Verify the final result.
        const verified = subresults.length > 0 && failed.length === 0;
        push("verify", verified ? "all subproblems resolved" : "incomplete");
        // Confidence, honestly calibrated (never certain without support, §9).
        let confidence = 0.4;
        if (verified)
            confidence += 0.25;
        if (available.length > 0)
            confidence += 0.1;
        confidence += competence * 0.1;
        confidence -= 0.15 * lessons.length;
        confidence -= 0.1 * failed.length;
        confidence = clamp01(confidence);
        return { problem, objective, available, missing, soughtAndResolved, revised, approaches, chosen, subproblems: subproblems, subresults, result, verified, confidence, lessons, trace };
    }
    async solveSubproblem(sub, depth) {
        if (this.deps.solveSub)
            return String(await this.deps.solveSub(sub, depth));
        if (depth > 0) {
            const r = await this.reason(sub, { depth: depth - 1 });
            return r.result;
        }
        return `[base: ${sub}]`;
    }
}
/** Split a problem into subproblems on connectives; fall back to analyze/solve. */
function decompose(problem, maxSub) {
    const parts = problem
        .split(/\b(?:and then|then|and|;|,|\band\b)\b|\bfollowed by\b/gi)
        .map(p => p.trim())
        .filter(p => p.length > 2);
    const unique = uniq(parts);
    if (unique.length >= 2)
        return unique.slice(0, maxSub);
    const base = problem.trim();
    return [`analyze: ${base}`, `solve: ${base}`];
}
function deriveObjective(problem) {
    const p = problem.trim().replace(/[?.!]+$/, "");
    const m = p.match(/^(?:how (?:do|can|to)|why|what|explain|design|build|write|create|solve|find|compute|prove)\b\s*(.*)$/i);
    return m && m[1] ? m[1].trim() : p;
}
const STOP = new Set(["the", "a", "an", "is", "to", "of", "in", "on", "for", "and", "or", "how", "do", "i", "you", "it", "with", "that", "this", "what", "why"]);
function tokenize(text) {
    return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}
function uniq(xs) {
    return Array.from(new Set(xs));
}
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
