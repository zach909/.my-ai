#!/usr/bin/env node
/**
 * peer-sync.mjs — direct, decentralized propagation of self-improvement
 * results between running NeuroClaw instances, alongside (never instead
 * of) the GitHub push.
 *
 * "GitHub is the core... this is how all the information gets passed
 * from one sandbox to another... I want a way to pass it directly
 * between people without using GitHub... I still want the code to be on
 * GitHub, I just wanted a secondary thing... GitHub is the weakness
 * here... I want it to go directly between people."
 *
 * This is a plain peer-to-peer gossip layer: each running instance can
 * optionally know about a small list of peers (other running instances,
 * configured locally -- there is no central directory/discovery service,
 * which is the whole point: no single server anyone can take down or
 * gate stops the propagation). When scripts/self-improve.mjs rewards a
 * candidate, it broadcasts the improvement directly to every configured
 * peer over a plain TCP socket, in addition to pushing it to the target branch.
 * When a peer receives one, if it's a real improvement over what that
 * peer already has, it adopts it into its own local scoreboard --
 * spreading hyperparameter improvements peer-to-peer even if GitHub is
 * unreachable, rate-limited, or simply not used by a given deployment.
 *
 * Deliberate safety boundary: the ONLY thing ever sent or accepted over
 * this channel is a small JSON scoreboard delta -- a target script name
 * (checked against this repo's own fixed whitelist), three numeric
 * hyperparameters, and a score. Nothing received from a peer is ever
 * executed, evaluated, or written as code. A malicious or buggy peer can
 * at worst cause a future sandbox training run to try different
 * (bounded, sanity-checked) hyperparameters -- it can never make this
 * process run arbitrary code, and it can never overwrite a local best
 * score with a worse one (mergeImprovement() only ever accepts a strict
 * improvement, same judge as the local loop uses on itself).
 *
 * No central service, no external API, no account/registration --
 * genuinely peer-to-peer sockets, entirely optional: with no peers
 * configured (the default), this is a complete no-op, matching the
 * "no external APIs, ever required" principle this whole repo holds to.
 *
 * Peer configuration: a newline-separated list of `host:port` entries in
 * extension-builder/peers.txt (gitignored -- deployment-local, not
 * something to commit), or NEUROCLAW_PEERS="host1:port1,host2:port2".
 */

import { createServer, createConnection } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TARGETS } from './self-improve-targets.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PEERS_FILE = path.join(ROOT, 'extension-builder', 'peers.txt')
export const DEFAULT_PEER_PORT = 7862

function log(...args) {
  console.log('[peer-sync]', ...args)
}

/** Loads the local peer list -- deployment-specific config, never
 *  committed, never auto-discovered. Silent, empty-list default. */
export function loadPeers() {
  const fromEnv = (process.env.NEUROCLAW_PEERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const fromFile = existsSync(PEERS_FILE)
    ? readFileSync(PEERS_FILE, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'))
    : []
  return [...new Set([...fromEnv, ...fromFile])]
    .map((entry) => {
      const [host, portStr] = entry.split(':')
      const port = Number(portStr) || DEFAULT_PEER_PORT
      return host ? { host, port } : null
    })
    .filter(Boolean)
}

const VALID_TARGET_SCRIPTS = new Set(TARGETS.map((t) => t.script))

/** Every field is checked against a fixed shape and sane numeric bounds
 *  before anything downstream ever looks at it -- this is the only trust
 *  boundary between "bytes from a socket" and "a value used by this
 *  process," so it stays deliberately strict and rejects anything that
 *  doesn't match exactly. */
export function validateImprovementMessage(msg) {
  if (!msg || typeof msg !== 'object') return null
  if (msg.type !== 'scoreboard-improvement') return null
  if (typeof msg.target !== 'string' || !VALID_TARGET_SCRIPTS.has(msg.target)) return null
  const h = msg.hyperparams
  if (!h || typeof h !== 'object') return null
  const { epochs, learningRate, tolerance } = h
  if (!Number.isFinite(epochs) || epochs < 1 || epochs > 1_000_000) return null
  if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 10) return null
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 10) return null
  if (!Number.isFinite(msg.score) || msg.score < 0 || msg.score > 1) return null
  return {
    type: 'scoreboard-improvement',
    target: msg.target,
    hyperparams: { epochs, learningRate, tolerance },
    score: msg.score,
    from: typeof msg.from === 'string' ? msg.from.slice(0, 200) : 'unknown-peer',
  }
}

/**
 * Merges a validated peer improvement into a local scoreboard object --
 * pure, no I/O, directly testable. Accepts ONLY a strict improvement over
 * the local best (same rule scripts/self-improve.mjs's own decideReward()
 * uses on itself), so a peer can never downgrade or overwrite a better
 * local result, and a flood of duplicate/inferior messages is a no-op.
 */
export function mergeImprovement(board, validatedMsg) {
  const targets = { ...board.targets }
  const entry = targets[validatedMsg.target] ?? { bestHyperparams: null, bestScore: 0, history: [] }
  if (validatedMsg.score <= entry.bestScore) {
    return { board, accepted: false, reason: 'not better than local best' }
  }
  const updated = {
    ...entry,
    bestHyperparams: validatedMsg.hyperparams,
    bestScore: validatedMsg.score,
    history: [
      ...entry.history.slice(-19),
      { at: new Date().toISOString(), fromPeer: validatedMsg.from, score: validatedMsg.score, ok: true },
    ],
  }
  targets[validatedMsg.target] = updated
  return { board: { ...board, targets }, accepted: true }
}

/** Sends one improvement to one peer over a plain newline-delimited JSON
 *  TCP message -- best-effort, always resolves (never throws), since a
 *  peer being offline is normal in a decentralized network, not an
 *  error. */
function sendToPeer(peer, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: peer.host, port: peer.port })
    const done = (ok, error) => {
      socket.destroy()
      resolve({ ok, peer, error })
    }
    socket.setTimeout(timeoutMs, () => done(false, 'timeout'))
    socket.on('connect', () => {
      socket.write(JSON.stringify(payload) + '\n')
      socket.end()
    })
    socket.on('close', () => done(true))
    socket.on('error', (err) => done(false, err.message))
  })
}

/** Broadcasts one improvement to every configured peer, in parallel,
 *  best-effort -- called by self-improve.mjs right after a candidate is
 *  rewarded, alongside (not instead of) the GitHub push. */
export async function broadcastImprovement(target, hyperparams, score, peers = loadPeers()) {
  if (peers.length === 0) return { sent: 0, peers: [] }
  const payload = {
    type: 'scoreboard-improvement',
    target,
    hyperparams,
    score,
    from: `${process.env.HOSTNAME || 'node'}-${process.pid}`,
  }
  const results = await Promise.all(peers.map((peer) => sendToPeer(peer, payload)))
  const sent = results.filter((r) => r.ok).length
  log(`broadcast ${target} (score ${score.toFixed(4)}) to ${sent}/${peers.length} peer(s)`)
  return { sent, peers: results }
}

/**
 * Broadcasts a "a new skill was published" notification to every
 * configured peer -- used by scripts/skill-agent.mjs, distinct from
 * broadcastImprovement()'s hyperparameter deltas. Deliberately carries
 * ONLY a topic and a slug, never the page content itself: "everyone has
 * access to it" is satisfied by the shared git history skill-agent.mjs
 * already pushed to TARGET_BRANCH (a peer that wants the actual page
 * runs `git pull`), keeping the same trust boundary
 * validateImprovementMessage() enforces -- nothing arbitrary a peer
 * sends is ever written to disk or executed here.
 */
export async function broadcastNewSkill(topic, slug, peers = loadPeers()) {
  if (peers.length === 0) return { sent: 0, peers: [] }
  const payload = {
    type: 'new-skill-published',
    topic: String(topic).slice(0, 300),
    slug: String(slug).slice(0, 200),
    from: `${process.env.HOSTNAME || 'node'}-${process.pid}`,
  }
  const results = await Promise.all(peers.map((peer) => sendToPeer(peer, payload)))
  const sent = results.filter((r) => r.ok).length
  log(`broadcast new skill "${topic}" to ${sent}/${peers.length} peer(s)`)
  return { sent, peers: results }
}

/** Validates an incoming new-skill notification -- same discipline as
 *  validateImprovementMessage(): exact shape, bounded string lengths,
 *  nothing else accepted. */
export function validateNewSkillMessage(msg) {
  if (!msg || typeof msg !== 'object') return null
  if (msg.type !== 'new-skill-published') return null
  if (typeof msg.topic !== 'string' || msg.topic.length === 0 || msg.topic.length > 300) return null
  if (typeof msg.slug !== 'string' || msg.slug.length === 0 || msg.slug.length > 200) return null
  return {
    type: 'new-skill-published',
    topic: msg.topic,
    slug: msg.slug,
    from: typeof msg.from === 'string' ? msg.from.slice(0, 200) : 'unknown-peer',
  }
}

/**
 * Starts listening for incoming peer broadcasts. Every connection is
 * read as a single newline-delimited JSON message, validated, and -- if
 * it's a real improvement -- merged into the local scoreboard on disk via
 * the caller-supplied load/save functions (dependency-injected so this
 * stays testable without real files or sockets).
 *
 * "When one model learns they all learn, and push to GitHub" -- "not
 * beta, but to git": accepting an improvement from a peer isn't just a
 * local write -- it's treated the same way this instance's OWN
 * self-improvement loop treats a reward. `pushToBeta` (dependency-
 * injected, same pattern as loadScoreboard/saveScoreboard -- see
 * peer-sync-server.mjs for the real wiring; the name is a holdover from
 * an earlier design and it now pushes to TARGET_BRANCH, main by
 * default -- see self-improve.mjs) pushes the newly-adopted best
 * straight to that branch, same as if this instance had trained it
 * itself. And the improvement is
 * re-broadcast to this instance's OWN configured peers, so it keeps
 * propagating outward through the whole mesh, not just one hop from
 * whoever originally trained it -- a peer of a peer eventually
 * converges too. This can't loop forever: mergeImprovement() only ever
 * accepts a STRICT improvement, so once every peer's local best matches
 * the true best for a target, no further "accepted" event fires and the
 * re-broadcast chain naturally stops on its own.
 */
export function startPeerServer({ port = DEFAULT_PEER_PORT, loadScoreboard, saveScoreboard, pushToBeta } = {}) {
  const server = createServer((socket) => {
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk
    })
    socket.on('end', () => {
      const line = buf.trim().split('\n')[0] ?? ''
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        return // malformed input -- silently ignored, never crashes the server
      }

      // A new-skill notification carries no scoreboard data to
      // merge/push -- it's just informational (skill-agent.mjs already
      // pushed the actual page to git before broadcasting), so it's
      // logged and re-propagated, not written to any local state.
      const newSkill = validateNewSkillMessage(parsed)
      if (newSkill) {
        log(`peer ${newSkill.from} published a new skill: "${newSkill.topic}" (wiki/${newSkill.slug}.md) -- pull to get it`)
        broadcastNewSkill(newSkill.topic, newSkill.slug).catch(() => {})
        return
      }

      const validated = validateImprovementMessage(parsed)
      if (!validated) return // anything not matching either expected shape is dropped
      const board = loadScoreboard()
      const { board: merged, accepted } = mergeImprovement(board, validated)
      if (accepted) {
        saveScoreboard(merged)
        log(`accepted improvement for ${validated.target} from peer ${validated.from} (score ${validated.score.toFixed(4)})`)
        if (pushToBeta) {
          const result = pushToBeta(merged)
          if (result?.ok) log(`pushed peer-learned improvement for ${validated.target}`)
        }
        // Propagate outward to this instance's own peers -- "when one
        // model learns they all learn." A no-op when no peers are
        // configured, same as every other peer-sync call.
        broadcastImprovement(validated.target, validated.hyperparams, validated.score).catch(() => {})
      }
    })
    socket.on('error', () => {}) // a peer dropping mid-write is normal, not fatal
  })
  server.listen(port, () => log(`listening for peer improvements on port ${port}`))
  return server
}
