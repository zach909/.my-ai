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
        const missing = uniq(tokenize(problem).filter(t => !covered.has(t) && !STOP.has(t))).slice(0, 8);
        push("missing", missing.length ? missing.join(", ") : "none identified");
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
        // Predicted consequence: a known-mistake pattern lowers every approach's score.
        for (const a of approaches)
            a.score -= 0.15 * lessons.length;
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
        // 9-10. Detect mistakes, revise, and combine into a result.
        const failed = subresults.filter(s => !s.result || /\[(error|unsolved|base):/i.test(s.result));
        if (failed.length)
            push("mistakes", `${failed.length} subproblem(s) unresolved`);
        const analogyNote = chosen === "analogy" && available.length ? `\nGrounded in: ${available.slice(0, 2).join(" | ")}` : "";
        const result = subresults.map(s => `- ${s.subproblem}: ${s.result}`).join("\n") + analogyNote;
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
        return { problem, objective, available, missing, approaches, chosen, subproblems: subproblems, subresults, result, verified, confidence, lessons, trace };
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
