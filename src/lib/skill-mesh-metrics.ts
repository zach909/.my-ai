/**
 * skill-mesh-metrics.ts — "I also want a test for the AI and a graph for
 * npm run server." The real, ongoing measurement of whether trained
 * skills genuinely connecting directly into live chat (ChatBot.matchSkillMesh(),
 * see bot-service.ts) is actually working: every real chat message is
 * itself a live trial, logged here, so the Self-Improvement dashboard can
 * graph the real direct-answer rate over time instead of relying on a
 * one-off test run.
 *
 * Local-only, same reasoning as conversation-log.ts: this is diagnostic
 * data about how well this one machine's trained skills are covering
 * real usage, not something to publish or share.
 */

import { appendFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from '../../models && skills/core/atomic-write.js'

export interface SkillMeshAttempt {
  at: number
  /** Did a trained skill's trigger clear ChatBot.SKILL_MATCH_THRESHOLD and answer directly? */
  matched: boolean
  /** Real cosine similarity of the best candidate, whether or not it cleared the threshold. */
  similarity: number
  /** Which skill answered, when matched is true. */
  matchedSkill?: string
}

const DEFAULT_LOG_PATH = path.join(process.cwd(), 'extension-builder', 'skill-mesh-history.jsonl')
const MAX_LINES = 4000

/** Appends one real attempt to the local log -- fire-and-forget, same
 *  contract as appendConversationTurn(): a disk issue here never breaks
 *  the actual chat response. */
export function recordSkillMeshAttempt(attempt: Omit<SkillMeshAttempt, 'at'>, logPath = DEFAULT_LOG_PATH): void {
  try {
    mkdirSync(path.dirname(logPath), { recursive: true })
    const full: SkillMeshAttempt = { at: Date.now(), ...attempt }
    appendFileSync(logPath, JSON.stringify(full) + '\n', 'utf8')
    maybeTrim(logPath)
  } catch {
    // Local disk issue -- never let logging break the actual response.
  }
}

function maybeTrim(logPath: string): void {
  let size: number
  try {
    size = statSync(logPath).size
  } catch {
    return
  }
  if (size < MAX_LINES * 200) return
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  if (lines.length <= MAX_LINES) return
  // Atomic: rotation truncates and rewrites the whole file, which is the
  // longest window this module ever has where a power cut destroys data --
  // and what it would destroy here is the skill-mesh metric history.
  writeFileAtomic(logPath, lines.slice(-MAX_LINES).join('\n') + '\n')
}

/** Reads the most recent `limit` real attempts, oldest first. Malformed
 *  lines are skipped, never thrown. */
export function readRecentSkillMeshAttempts(limit = 500, logPath = DEFAULT_LOG_PATH): SkillMeshAttempt[] {
  if (!existsSync(logPath)) return []
  let raw: string
  try {
    raw = readFileSync(logPath, 'utf8')
  } catch {
    return []
  }
  const attempts: SkillMeshAttempt[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed.matched === 'boolean' && typeof parsed.similarity === 'number' && typeof parsed.at === 'number') {
        attempts.push(parsed)
      }
    } catch {
      continue
    }
  }
  return attempts.slice(-limit)
}
