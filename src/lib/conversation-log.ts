/**
 * conversation-log.ts — the real, local record of what actually gets
 * said to this agent and what it actually replied, kept strictly so a
 * later training pass can learn from real usage instead of only
 * external research.
 *
 * "It learns by talking to you. It tries to predict what you're gonna
 * say and tries to predict what any input into the model is gonna say,
 * and then that's how it learns." -- this file is step one of that:
 * real (message, response) pairs, persisted to disk so they survive a
 * restart. scripts/conversation-learning-agent.mjs is step two: it
 * reads this log and actually trains on it.
 *
 * Privacy boundary, absolute: this file is local-only, by construction,
 * not by policy alone. It lives under extension-builder/, which is
 * gitignored for exactly this file (see extension-builder/.gitignore);
 * nothing in this codebase ever pushes it to git, broadcasts it to a
 * peer, or sends it anywhere over HTTP. Compare
 * scripts/peer-sync.mjs's validateImprovementMessage()/
 * validateNewSkillMessage(), neither of which carries anything from
 * this file -- conversation content specifically was never wired into
 * either broadcast path. See wiki/Privacy-Policy.md.
 */

import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

export interface ConversationTurn {
  at: number
  userMessage: string
  response: string
}

const DEFAULT_LOG_PATH = path.join(process.cwd(), 'extension-builder', 'conversation-log.jsonl')
/** Bounded so the log can't grow forever on a long-running server -- a
 *  real cap, the same "cap it, don't let it grow unbounded" pattern
 *  this codebase already uses for in-memory logs (see
 *  src/lib/error-log.ts's MAX_ENTRIES), just applied to a file instead
 *  of an array. */
const MAX_LINES = 4000

/** Appends one real turn to the local log -- fire-and-forget from the
 *  caller's point of view: a failure here (disk full, permissions)
 *  never breaks the actual chat response, it just means this one turn
 *  doesn't get learned from later. */
export function appendConversationTurn(userMessage: string, response: string, logPath = DEFAULT_LOG_PATH): void {
  try {
    mkdirSync(path.dirname(logPath), { recursive: true })
    const turn: ConversationTurn = { at: Date.now(), userMessage, response }
    appendFileSync(logPath, JSON.stringify(turn) + '\n', 'utf8')
    maybeTrim(logPath)
  } catch {
    // Local disk issue -- never let logging break the actual response.
  }
}

/** Rewrites the file to keep only the most recent MAX_LINES entries.
 *  Cheap to call on every append (only actually rewrites once the file
 *  has grown past the cap, not on every single line). */
function maybeTrim(logPath: string): void {
  let size: number
  try {
    size = statSync(logPath).size
  } catch {
    return
  }
  // Rough gate before paying for a full read: only bother checking the
  // real line count once the file is large enough that it plausibly
  // exceeds the cap (average real turn is well under 1KB).
  if (size < MAX_LINES * 200) return
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  if (lines.length <= MAX_LINES) return
  writeFileSync(logPath, lines.slice(-MAX_LINES).join('\n') + '\n', 'utf8')
}

/** Reads the most recent `limit` real turns, oldest first (the order a
 *  training pass wants them in, so consecutive turns stay adjacent for
 *  the "predict the next user message from the prior response" samples).
 *  Malformed lines are skipped, never thrown -- a corrupt tail from an
 *  interrupted write shouldn't take down whatever's reading this. */
export function readRecentConversationTurns(limit = 200, logPath = DEFAULT_LOG_PATH): ConversationTurn[] {
  if (!existsSync(logPath)) return []
  let raw: string
  try {
    raw = readFileSync(logPath, 'utf8')
  } catch {
    return []
  }
  const turns: ConversationTurn[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed.userMessage === 'string' && typeof parsed.response === 'string') {
        turns.push(parsed)
      }
    } catch {
      continue
    }
  }
  return turns.slice(-limit)
}
