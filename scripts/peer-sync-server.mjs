#!/usr/bin/env node
/**
 * peer-sync-server.mjs — standalone entry point that starts the
 * peer-sync TCP listener (scripts/peer-sync.mjs's startPeerServer())
 * wired to the real on-disk scoreboard, so incoming peer improvements
 * actually persist into extension-builder/self-improvement-scoreboard.json.
 *
 * Kept as its own tiny process (spawned by scripts/server.mjs) rather
 * than folded into self-improve.mjs's own loop so a slow/misbehaving
 * peer connection can never block or delay an in-progress training
 * cycle -- the listener and the trainer are independent processes.
 */

import { startPeerServer, DEFAULT_PEER_PORT } from './peer-sync.mjs'
import { loadScoreboard, saveScoreboard, pushScoreboardToTargetBranch } from './self-improve.mjs'

const port = Number(process.env.NEUROCLAW_PEER_PORT) || DEFAULT_PEER_PORT
startPeerServer({
  port,
  loadScoreboard: () => loadScoreboard(),
  saveScoreboard: (board) => saveScoreboard(board),
  // "When one model learns they all learn, and push to GitHub" -- an
  // improvement adopted from a peer gets pushed to the target branch
  // (main by default) the same way a self-trained one does, not just
  // kept locally.
  pushToBeta: (board) => pushScoreboardToTargetBranch(board),
})
