# Self-Improvement & Peer Sync

`npm run server` doesn't just start the web backend — it also starts an autonomous loop that improves the project's own trained skill networks, a direct peer-to-peer channel for sharing those improvements, and a couple of honest, boring performance/diagnostic pieces. This page documents all of it plainly, including exactly what it does and doesn't do, so nothing here is a surprise.

## The self-improvement loop (`scripts/self-improve.mjs`)

Every 30 minutes by default (configurable via `NEUROCLAW_SELF_IMPROVE_INTERVAL_MS`), the loop:

1. **Picks a target** from a fixed whitelist of this project's own skill-training scripts — currently `build-physics-chemistry-network.mjs`, `train-coding-skills.mjs`, `build-main-network.mjs` (moby/cmudict), `build-self-knowledge-network.mjs` (the wiki + session scripts), and `build-capability-exam-network.mjs` (see the capability exam section below). This is real training, the same genuine `torch.autograd` gradient descent used everywhere else in this project — never a simulated or fabricated result.
2. **Mutates its hyperparameters** — an evolution-strategy-style perturbation of the current best-known epochs/learning-rate/tolerance, the same algorithm family as `trainDefinitionsRandomSearch()` elsewhere in this repo.
3. **Trains the candidate in a sandbox** — a throwaway `git worktree` checked out fresh from the current commit, with its own freshly built `dist/`. The live server's own working directory is never touched.
4. **Judges the result** three ways, all required:
   - Did the candidate's real trained accuracy strictly beat the current best? (Ties don't count — "better than the original" means strictly better.)
   - Does the runner that actually executes skills still pass its own test suite (`test/smoke.mjs`) against it? A skill improvement that breaks the runner is rejected regardless of its accuracy score.
   - **Does the candidate's own sandbox pass the capability exam?** — a completely fresh, randomly-generated, cross-domain test (see below), regenerated from scratch for every single gate check, run against `EXAM_PASS_THRESHOLD` (default `0.15`, tune with `NEUROCLAW_EXAM_PASS_THRESHOLD`). This applies to *every* target's candidate, not just the exam network's own row — "when the agent tries to improve itself, it must go through that test to see if it's been improved."
5. **Rewards or punishes**: a candidate that passes all three checks becomes the new best, gets recorded in `extension-builder/self-improvement-scoreboard.json` (including its exam score and pass/fail), and gets pushed straight to `beta` (configurable via `NEUROCLAW_SELF_IMPROVE_TARGET_BRANCH`) — **directly, with no human review step** — never to this session's own active development branch, which stays untouched either way. A candidate that fails any check is discarded — the "negative feedback" is exactly that: the attempt is logged to the scoreboard's history as a punished attempt, and the loop tries again next cycle from the same last-known-good hyperparameters, nothing silently dropped.

  **`main` vs `beta`:** an earlier version of this pushed straight to `main` with no gate in front of it at all ("not beta, but to git") — now that a real capability-exam gate stands between a candidate and a reward, accepted candidates land on a dedicated `beta` branch instead. Point a second `npm run server` checkout at `beta` (`git checkout beta`) to run it as a live sandbox: `scripts/update-check.mjs`'s existing fast-forward auto-pull picks up every exam-gated improvement automatically, with no separate deploy step. `skill-agent.mjs` and `skill-drill-agent.mjs` are unaffected by this — they still push straight to `main` via the separate `NEUROCLAW_SELF_IMPROVE_BRANCH` env var, unchanged.

**Turn it off** entirely with `NEUROCLAW_SELF_IMPROVE=0`.

## The capability exam (`scripts/capability-exam.mjs`) — "a test that can't be cheated"

Every self-improve.mjs candidate, for every target, has to clear this exam before it's rewarded. It's designed around one constraint: it must be cheap to *generate* and *grade*, but genuinely hard to guess — "hard proofs which you know the answers to so it's really easy to check and make but really hard to solve."

- **Completely random questions, completely random order, every single time.** `generateExam()` draws fresh questions from every domain and shuffles them (a real Fisher-Yates shuffle, not a biased sort comparator) on every call — nothing is cached, seeded from a file, or reused between exam attempts.
- **Six real domains**, each its own pure generator under `scripts/exam-generators/`, every question backed by a real closed-form formula this JS runtime actually evaluates (never fabricated, never an external API call — the same "NO EXTERNAL APIS" constraint the rest of this project holds elsewhere):
  - `arithmetic.mjs` — real arithmetic facts (shared with `skill-drill-agent.mjs`'s own math drilling).
  - `chemistry.mjs` — molar mass over a real periodic-table subset ("molecules, atoms").
  - `astrophysics.mjs` — Schwarzschild radius and escape velocity with real physical constants ("really big stuff like black holes").
  - `optics.mjs` — photon energy and the thin-lens equation ("light, computation").
  - `quantum-computing.mjs` — qubit measurement probability, basis-state counts, Grover-iteration counts ("quantum science, computation, quantum computation").
  - `digital-logic.mjs` — base conversion, boolean gates, address-bus width ("chip design... computation").
- **Grading** (`gradeAnswer()`) is an exact string match or a numeric comparison within a small relative tolerance — forgiving harmless formatting differences, not wrong answers.
- **`build-capability-exam-network.mjs`** is what actually "takes" the exam. **v1** routed straight to `pytorch_trainer.py`'s flat `tanh(W . input + b)` contract — one linear layer, 32 learnable numbers total — and it genuinely could not clear the gate: real runs measured 0% held-out accuracy every time, the same known ceiling `train-coding-skills.mjs`'s own doc comment already describes for a single-readout linear transform asked to fit many *different* input/target pairs at once. **v2** ("you have the hyperdimensional thinking and the non-linear thinking, right?") routes through `HyperDimensionalEngine.trainDefinitions()` instead (`models && skills/core/onebrain.ts`, Section 4) — a real, distinct mechanism already used elsewhere in this project: each exam question clamps a *dedicated per-domain drive neuron* to the question's embedding, the *whole mesh settles* through several steps of real all-to-all, non-linear (tanh) propagation, and a *dedicated per-domain readout neuron* is delta-rule-adjusted from every other neuron's resulting state — real cross-neuron capacity (up to `(neuronCount - 1) x dimensions` learnable weights per domain), not a single linear map from the raw input. Held-out evaluation reuses the exact same `settle()` dynamics without the weight-adjustment step, on a second, disjoint, freshly-generated batch.
- The gate itself (`runCapabilityExamGate()` in `self-improve.mjs`) re-runs this whole exam fresh, inside the candidate's own sandbox, for every cycle regardless of which target is being trained.
- **Honest current state:** v2 is genuinely more expressive than v1 (confirmed by hand: the same mechanism converges on a couple of hand-picked definitions given enough epochs), but real multi-domain training at its current default hyperparameters still measures 0% held-out accuracy — it has not yet found a convergent setting for 18 simultaneous, wildly different questions. That's not a dead end the way v1's fixed 32-parameter ceiling was: it's exactly the search problem `self-improve.mjs`'s own evolution-strategy hyperparameter mutation (`mutateHyperparams()`) exists to solve over many cycles, by trying different epoch counts, learning rates, and tolerances until one actually converges.

**Graphed** on `/app/self-improvement`: "Capability exam: pass rate & average score" — the cumulative pass rate and average score across every gated attempt, from every target.

## The skill-creation agent (`scripts/skill-agent.mjs`)

A separate autonomous agent from the self-improvement loop above — same engine, different job. Instead of tuning the hyperparameters of a fixed set of existing skill scripts, this one creates **new** skills from scratch, one research topic per cycle (45 minutes by default, `NEUROCLAW_SKILL_AGENT_INTERVAL_MS`):

1. **Research** — runs `ResearchPlugin.conductResearch()` (the same real memory/drive/web search + never-trust-one-source corroboration described in [[Plugins]]) against a topic drawn from a rotating pool (physics/chemistry/computation/AI research — explicitly no biology, matching this project's curriculum scope).
2. **Wiki** — writes up *only* the corroborated findings (2+ independent sources) as a new page under `wiki/`, explicitly disclosed as AI-generated with an honest explanation of what "verified" means. A topic that turns up nothing corroborated produces no page at all.
3. **Skill** — trains a real `@definishon` neuron from that page's actual content via genuine `torch.autograd` gradient descent.
4. **Share** — only if the skill converges *and* the runner gate (`test/smoke.mjs`) still passes, **five things** get published together to the same target branch as the self-improvement loop, and a lightweight notification (topic + slug only, never the page content) is broadcast to peers:

   | # | File | What it is |
   |---|------|------------|
   | 1 | `wiki/<slug>.md` | The sourced article — the corroborated research findings (and the skill itself is trained *from* this content) |
   | 2 | `extension-builder/extensions/<slug>.skill.json` | The compiled skill — quantized, the "binary" |
   | 3 | `extension-builder/extensions/<slug>.source.json` | The same skill, unquantized — the "source code" |
   | 4 | `test/skills/<slug>.test.ts` | An auto-generated regression test (does this artifact actually contain a real, trained neuron?) |
   | 5 | `extension-builder/drill-weights/<slug>.json` | Seeded here at zero, then kept "constantly improving" by the skill-drill agent below |

**Turn it off** with `NEUROCLAW_SKILL_AGENT=0`.

## The skill-drill agent (`scripts/skill-drill-agent.mjs`)

Artifact #5 above, made real: "an algorithm that you can run on your machine to constantly improve it... if it was a math skill, it would constantly spam it with math problems." A separate `npm run server` process (10 minutes by default, `NEUROCLAW_SKILL_DRILLS_INTERVAL_MS`) that:

1. **Picks a published skill** — least-recently-drilled first, rotating through whatever `skill-agent.mjs` has actually published on this machine.
2. **Classifies it** — right now exactly one concrete drill category is implemented, matching the math example above: topics that look like arithmetic/algebra/number theory get real, freshly-generated arithmetic problems (`scripts/drill-generators/arithmetic.mjs` — pure JS, no external API). Everything else falls back to a **generic** drill: a regression check that the skill still reproduces its own trained content. This project deliberately never calls out to an external LLM to invent held-out quiz material for arbitrary research topics (see "NO EXTERNAL APIS" throughout this page) — the generic fallback is the honest alternative, not a disguised version of the real thing.
3. **Measures real held-out accuracy** *before* drilling — a pure forward pass (`pytorch_trainer.py`'s `"op": "eval"`, no weight update) against a batch the current weights were never trained on.
4. **Continues training** on a second fresh batch (`"op": "train"`, resuming from the current weights via `initW`/`initB` — a genuine fine-tune, not a cold restart).
5. **Measures accuracy again** on a *third* fresh batch, never touched by steps 3 or 4.
6. **The judge**: only a strict accuracy improvement (same rule as `decideReward()` above) counts as real progress. A cycle that doesn't improve discards its weight update and keeps the previous best — but the attempt is still logged, win or not.
7. **On genuine improvement**, the updated weights are committed to `extension-builder/drill-weights/<slug>.json` and pushed straight to the same target branch as everything else — "when one model learns, they all learn": a `git pull` on any other install picks up the improved weights.

Every attempt (improved or not) is appended to the local, gitignored `extension-builder/skill-quality-history.json` — this is the data behind the **Self-Improvement dashboard** (the "Self-Improvement" nav item, `src/routes/app/self-improvement.tsx`, served from `GET /api/self-improvement/history`): one graph of real trained scores over time (`self-improve.mjs`'s own scoreboard), one graph of the cumulative pass rate of the improvement-test judge above (this agent's history). Both graphs are empty on a fresh install or with the relevant agent disabled — not an error, just nothing recorded yet.

**Turn it off** with `NEUROCLAW_SKILL_DRILLS=0`.

## Skills directly connected into live chat, not routed to a separate expert network

An architecture audit this session found a real gap: every trained skill's actual (trigger → response) content was reachable only two ways, both weak. Boot-time loading flattened it into one plain-text memory sentence per script ("When asked X, Y responds: Z"), and ordinary chat only ever consulted that memory as loosely-weighted background context for the reasoner (`ReasoningEngine`'s `recall` dependency) — a trained skill could influence a response, but never directly *be* the response, and its own trigger text was diluted by boilerplate wording around it before anything ever compared it to a live message.

This is fixed now, and deliberately *not* via a Mixture-of-Experts-style routing layer that picks between separate expert networks — that's the wrong shape for what was asked for here ("not the skill system, because the skill system connects skills directly into the rest of it, versus having a bunch of different neural networks solve different problems"). Instead:

- **`interface/web-server.ts`'s `rememberSkillScript()`** stores a trained skill's trigger (`userSays`) as the memory item's `content` — what actually gets embedded and matched — and its literal response as a new, separate `payload` field (`models && skills/core/long-term-memory.ts`), tagged `'skill-script'`. Previously the response was only recoverable by re-parsing a flattened sentence; now it's returned directly.
- **`loadSavedExtensions()`** now also loads `*.source.json` (what `skill-agent.mjs` actually publishes per skill — see the five things above) alongside the older `*.ext.json` format. Previously a skill-agent-published skill was silently never loaded into memory at boot at all.
- **`ChatBot.matchSkillMesh()`** (`src/server/bot-service.ts`) runs on every real chat message, ahead of the reasoner/hive fallback: it queries `LongTermMemory`'s real bag-of-words cosine similarity for the closest `'skill-script'` trigger, and if the match is genuinely confident (`SKILL_MATCH_THRESHOLD = 0.6` — chosen from real measured similarity scores: genuine paraphrases of a trigger scored 0.67–0.89, an unrelated query scored 0.29, against the same trigger set during development), returns that skill's trained response **verbatim**, short-circuiting the entire reasoner/hive path. Below the threshold, nothing changes — the message falls through to `plan`/`recall`/`solve` exactly as before.

This makes every skill `skill-agent.mjs` publishes (and every skill manually built/registered via the Extension Builder) something live chat can actually be directly answered by, for the first time — not just background text a heuristic reasoner might or might not use.

**"A test for the AI"**: every real chat message is itself a live trial of this. `src/lib/skill-mesh-metrics.ts` logs every attempt (matched or not, and its real similarity score) to the local, gitignored `extension-builder/skill-mesh-history.jsonl`. The Self-Improvement dashboard's third graph, **"Skill-mesh direct-answer rate"**, is the cumulative fraction of real messages a trained skill has directly answered, over time — genuinely continuous testing of whether this connection is actually working, not a one-off assertion.

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

## Faster startup: the update check and the backend build run concurrently

Both `npm run dev` and `npm run server` used to run the update check (a network call — `git fetch`, up to a 15-second timeout, longer still if it auto-pulls) and the backend build (a pure CPU-bound `tsc` compile) one after the other, purely because the startup scripts called them as sequential steps — neither one actually depends on the other's result. `scripts/spawn-utils.mjs`'s `spawnAwait()` lets both scripts run them as two real concurrent child processes instead (`Promise.all(...)`), so the network call's latency is hidden behind the build instead of adding to it. The win scales with how slow or flaky your network is — on a fast connection it saves a second or two; on a slow one, it can save the whole multi-second fetch. Nothing about *what* either step does changed, only that they no longer block each other.

## See Also

- [[Privacy-Policy]] — exactly what data this leaves your machine, and when
- [[Terms]] — terms of use, including this autonomous behavior
- [[Home]] — project overview
