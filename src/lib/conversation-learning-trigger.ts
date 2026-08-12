/**
 * conversation-learning-trigger.ts — makes "always learn by talking to
 * it / using it" real: fires an actual training cycle right after every
 * real exchange, instead of waiting for the background agent's periodic
 * timer (scripts/conversation-learning-agent.mjs, still running as a
 * catch-up fallback -- see NEUROCLAW_CONVERSATION_LEARNING_INTERVAL_MS).
 *
 * "Personalized to you": there is exactly one conversation log per
 * install (no accounts, no multi-tenant separation -- see
 * wiki/Privacy-Policy.md), so the trained state this produces is, by
 * construction, shaped only by whoever actually talks to this one
 * instance. Real personalization for a single-user local system, not a
 * generic shared model.
 *
 * Fire-and-forget, from the caller's point of view: the chat response
 * this session already computed is returned immediately regardless of
 * how long training takes. A module-level lock skips a trigger while a
 * cycle is already running (real gradient descent takes real time --
 * cold start alone can be several seconds, see pytorch_trainer.py's own
 * doc comment) rather than letting rapid back-and-forth messages queue
 * up overlapping training subprocesses; the background loop's next
 * scheduled pass still picks up whatever a skipped trigger missed, so
 * no turn is ever silently lost, only deferred.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

let learningInFlight = false

/** Dynamically imports scripts/conversation-learning-agent.mjs's real
 *  runOneCycle() and runs it once, in-process, right now -- not waiting
 *  for the separate background agent's next scheduled tick. Never
 *  throws into the caller: a failure here (python3/torch unavailable,
 *  disk issue) is logged and otherwise invisible to whoever triggered
 *  it, exactly like every other optional-dependency degradation in this
 *  project. */
export async function triggerConversationLearning(): Promise<void> {
  if (learningInFlight) return // a cycle is already running -- the background loop will catch this turn later
  learningInFlight = true
  try {
    const agentPath = path.join(process.cwd(), 'scripts', 'conversation-learning-agent.mjs')
    const { runOneCycle } = await import(pathToFileURL(agentPath).href)
    await runOneCycle()
  } catch (err) {
    console.error('[conversation-learning-trigger] cycle failed (non-fatal):', err instanceof Error ? err.message : err)
  } finally {
    learningInFlight = false
  }
}
