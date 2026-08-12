# Self-Improvement & Peer Sync

`npm run server` doesn't just start the web backend — it also starts an autonomous loop that improves the project's own trained skill networks, a direct peer-to-peer channel for sharing those improvements, and a couple of honest, boring performance/diagnostic pieces. This page documents all of it plainly, including exactly what it does and doesn't do, so nothing here is a surprise.

## The self-improvement loop (`scripts/self-improve.mjs`)

Every 30 minutes by default (configurable via `NEUROCLAW_SELF_IMPROVE_INTERVAL_MS`), the loop:

1. **Picks a target** from a fixed whitelist of this project's own skill-training scripts — currently `build-physics-chemistry-network.mjs`, `train-coding-skills.mjs`, `build-main-network.mjs` (moby/cmudict), and `build-self-knowledge-network.mjs` (the wiki + session scripts). This is real training, the same genuine `torch.autograd` gradient descent used everywhere else in this project — never a simulated or fabricated result.
2. **Mutates its hyperparameters** — an evolution-strategy-style perturbation of the current best-known epochs/learning-rate/tolerance, the same algorithm family as `trainDefinitionsRandomSearch()` elsewhere in this repo.
3. **Trains the candidate in a sandbox** — a throwaway `git worktree` checked out fresh from the current commit, with its own freshly built `dist/`. The live server's own working directory is never touched.
4. **Judges the result** two ways, both required:
   - Did the candidate's real trained accuracy strictly beat the current best? (Ties don't count — "better than the original" means strictly better.)
   - Does the runner that actually executes skills still pass its own test suite (`test/smoke.mjs`) against it? A skill improvement that breaks the runner is rejected regardless of its accuracy score.
5. **Rewards or punishes**: a candidate that passes both checks becomes the new best, gets recorded in `extension-builder/self-improvement-scoreboard.json`, and gets pushed straight to `main` (configurable via `NEUROCLAW_SELF_IMPROVE_BRANCH`) — **directly, with no human review step** — never to this session's own active development branch, which stays untouched either way. A candidate that fails either check is discarded; the attempt is logged to the scoreboard's history either way, so nothing is silently dropped.

  **This is a deliberate, explicit choice, not a conservative default.** An earlier version of this pushed to an isolated `beta` branch instead, specifically so nothing landed on `main` unreviewed — the project owner asked for that to change: "not beta, but to git." If you want the more conservative isolated-branch behavior back, set `NEUROCLAW_SELF_IMPROVE_BRANCH=beta` (or any branch name you choose).

**Turn it off** entirely with `NEUROCLAW_SELF_IMPROVE=0`.

## The skill-creation agent (`scripts/skill-agent.mjs`)

A separate autonomous agent from the self-improvement loop above — same engine, different job. Instead of tuning the hyperparameters of a fixed set of existing skill scripts, this one creates **new** skills from scratch, one research topic per cycle (45 minutes by default, `NEUROCLAW_SKILL_AGENT_INTERVAL_MS`):

1. **Research** — runs `ResearchPlugin.conductResearch()` (the same real memory/drive/web search + never-trust-one-source corroboration described in [[Plugins]]) against a topic drawn from a rotating pool (physics/chemistry/computation/AI research — explicitly no biology, matching this project's curriculum scope).
2. **Wiki** — writes up *only* the corroborated findings (2+ independent sources) as a new page under `wiki/`, explicitly disclosed as AI-generated with an honest explanation of what "verified" means. A topic that turns up nothing corroborated produces no page at all.
3. **Skill** — trains a real `@definishon` neuron from that page's actual content via genuine `torch.autograd` gradient descent.
4. **Share** — only if the skill converges *and* the runner gate (`test/smoke.mjs`) still passes, the page is pushed straight to the same target branch as the self-improvement loop, and a lightweight notification (topic + slug only, never the page content) is broadcast to peers.

**Turn it off** with `NEUROCLAW_SKILL_AGENT=0`.

## The conversation-learning agent (`scripts/conversation-learning-agent.mjs`)

The only one of these agents that learns from real usage instead of external research or existing skills — and the only one that is **never published anywhere**, structurally, not just by policy.

Every real (your message → its response) exchange gets appended locally to `extension-builder/conversation-log.jsonl` (gitignored — see [[Privacy-Policy]]). Every 20 minutes by default (`NEUROCLAW_CONVERSATION_LEARNING_INTERVAL_MS`), this agent reads that log and trains two real prediction directions via genuine gradient descent:

1. **Respond**: given your actual message, predict this agent's actual response to it.
2. **Anticipate**: given this agent's prior response, predict what you actually said next.

Both are trained from real local data, never fabricated. The result is written to a single local file (`extension-builder/extensions/conversation_learning.ext.json`, overwritten each cycle, gitignored) that the running server loads at boot like any other trained skill.

**This script has no code path capable of sending any of it anywhere**: it never calls the sandbox/publish helpers the other two agents use, never imports `peer-sync.mjs`, and only ever touches two gitignored local files. Conversation content stays on this machine by construction.

**Turn it off** with `NEUROCLAW_CONVERSATION_LEARNING=0`.

### Learning immediately, not on a 20-minute timer

The 20-minute loop above is a catch-up fallback now, not the primary path. `src/lib/conversation-learning-trigger.ts` fires a real training cycle **right after every real exchange**, called directly from `bot-service.ts` the moment a response is logged — you don't wait for the timer.

- **Fire-and-forget**: the chat response you already got back is never delayed by this. `triggerConversationLearning()` runs the cycle in the background and swallows any failure (missing `python3`/`torch`, disk issue) rather than surfacing it to you — same graceful-degradation rule as every other optional dependency in this project.
- **Two locks, because two different processes can both try to train at once**: an in-process `learningInFlight` flag skips a trigger fired while this server's own last cycle is still running, and a real cross-process file lock (`extension-builder/conversation-learning.lock`, gitignored, `acquireLock()`/`releaseLock()` in `scripts/conversation-learning-agent.mjs`) stops the immediate trigger and the separate 20-minute background process from training at the same moment. A lock older than 10 minutes is treated as abandoned and reclaimed automatically, so a crashed process can never wedge learning shut. Either way, nothing is lost — `state.lastTrainedTurnAt` means the next cycle that *does* get the lock picks up whatever a skipped one missed.

### Personalized to you

There are no accounts and no multi-tenant separation in this project (see [[Privacy-Policy]]) — one install has exactly one conversation log. So everything this agent trains is shaped only by whoever actually talks to *this* instance, on *this* machine. That's real personalization for a single local install, not a shared/generic model: nobody else's conversations ever touch your trained state, and yours never touch anyone else's.

## Peer sync (`scripts/peer-sync.mjs`)

GitHub is the backbone, but it's still a single point of coordination — if you want improvements to reach another running instance directly, without going through GitHub at all, peer sync does that:

- When a candidate is rewarded, the loop broadcasts the same small hyperparameter/score payload directly to any peers you've configured, over a plain TCP socket — in addition to (never instead of) the push to `main`. A peer that adopts an improvement pushes it to `main` itself and re-broadcasts it to its own peers, so it propagates through the whole mesh, not just one hop.
- Peers are configured locally, not auto-discovered: `NEUROCLAW_PEERS="host1:port1,host2:port2"` or a `extension-builder/peers.txt` file (one `host:port` per line, gitignored — deployment-specific). **Empty by default: a complete no-op until you configure at least one peer.**
- **The trust boundary is strict.** The only thing ever sent or accepted is a small JSON message: a target script name (checked against the same fixed whitelist as the local loop), three bounded numeric hyperparameters, and a score in `[0, 1]`. Nothing received from a peer is ever executed, evaluated, or written as code — a malicious or buggy peer can at most cause a future sandbox run to try different (still bounded) hyperparameters, never run arbitrary code. And a peer can never overwrite a better local result with a worse one: incoming scores are only ever adopted if they're a strict improvement over what's already there.

**Turn off the listener** with `NEUROCLAW_PEER_SYNC=0`.

## Process tuning (`scripts/process-tuning.mjs`)

Scoped deliberately to the server's own Node processes, never the host machine: libuv's threadpool size and Node's heap ceiling are sized to the machine's real CPU count and memory (instead of Node's conservative defaults), so training subprocesses and file I/O aren't artificially bottlenecked. This makes self-improvement cycles run faster on real hardware — it does not touch anything outside these processes.

## Startup diagnostics (`scripts/system-diagnostics.mjs`)

Printed once when `npm run server` starts: current memory pressure and the processes actually consuming it, read-only. **This is explicitly not a virus scanner** — it has no malware signature database and doesn't claim to detect anything malicious, only surfaces "this process is using an unusual amount of memory, might be worth a look." If something looks wrong, run a real antivirus/anti-malware tool. Nothing here is transmitted anywhere or modifies anything.

## See Also

- [[Privacy-Policy]] — exactly what data this leaves your machine, and when
- [[Terms]] — terms of use, including this autonomous behavior
- [[Home]] — project overview
