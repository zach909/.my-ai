/**
 * The agent decides for itself whether to keep going.
 *
 * After a step of autonomous work, instead of always stopping (and waiting for
 * the next timer) or always carrying on, the agent is asked: is there more worth
 * doing right now? It answers CONTINUE or STOP.
 *
 * ── Why it is safe to let it choose ────────────────────────────────────
 *
 *   - Only a reply that clearly says CONTINUE continues. STOP, silence, an error
 *     or a muddled answer all stop. Stopping is the default.
 *   - There is a hard cap on how many steps it may chain (SafetySettings.autoContinue
 *     .maxSteps, at most 10), whatever it says.
 *   - It never chains past a step that failed or did nothing, because there is
 *     nothing to build on.
 *   - It can be switched off, in Settings, and then every run is one step.
 *   - Continuing does not skip any checks: each step still goes through the same
 *     approvals (tool-safety.ts) and the same team checks as a first step.
 */
import { MAX_CONTINUE_STEPS } from "./tool-safety.js";
/** CONTINUE only if the reply starts by saying so. Everything else is STOP. */
export function parseContinue(reply) {
    const line = (String(reply ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? "").replace(/^[\s"'“”‘’*_`>#-]+/, "");
    return /^(continue|keep going|more|yes)\b/i.test(line) ? "continue" : "stop";
}
/**
 * Runs `step` once, then keeps running it for as long as the agent says CONTINUE
 * (via `ask`), up to the cap. `ask` is given the step number and the last result.
 */
export async function chainSteps(step, ask, opts) {
    const cap = Math.max(1, Math.min(MAX_CONTINUE_STEPS, Math.floor(opts.maxSteps) || 1));
    const steps = [];
    for (let n = 1; n <= cap; n++) {
        const result = await step(n);
        steps.push(result);
        if (!opts.enabled)
            return { steps, ended: "off" };
        if (!result.progressed)
            return { steps, ended: "no-progress" };
        if (n === cap)
            return { steps, ended: "step-limit" };
        let reply = "";
        try {
            reply = await ask(n, result);
        }
        catch {
            reply = "";
        }
        if (parseContinue(reply) !== "continue")
            return { steps, ended: "chose-to-stop" };
    }
    return { steps, ended: "step-limit" };
}
