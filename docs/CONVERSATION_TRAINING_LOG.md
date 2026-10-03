# Conversation Training Log

This document records a real training-by-conversation session run against
this checkout's NeuroClaw/OneBrain stack: what was tested, what the system
actually did (not a description of what it's supposed to do), what turned
out to be broken, what was fixed, and what remains a genuine capability gap
rather than a bug. It follows a test → response → analysis → correction →
retest structure, the same shape `scripts/conversation-learning-agent.mjs`
and `src/lib/conversation-log.ts` already use to describe how this project
intends to learn from real usage.

No real user conversation content is recorded here. `extension-builder/conversation-log.jsonl`
is gitignored on purpose (see `wiki/Privacy-Policy.md`) and nothing in this
document reproduces its contents; the turns below are synthetic prompts sent
by this training session itself, run against a fresh, untrained `NeuroclawLLM`
instance, and only their *behavior* is reported.

## How this system is actually meant to learn from conversation

Three pieces, already built, wire together into "the agent learns by talking
to you":

- `src/lib/conversation-log.ts` — `appendConversationTurn()` records every
  real `(userMessage, response)` pair from `src/server/bot-service.ts` to
  `extension-builder/conversation-log.jsonl`, a strictly local, gitignored
  file.
- `src/lib/conversation-learning-trigger.ts` — fires a real training cycle
  immediately after each turn (fire-and-forget, non-fatal on failure).
- `scripts/conversation-learning-agent.mjs` — reads the log, builds two
  training directions per turn (predict the AI's reply from the user's
  message, and predict the user's *next* message from the AI's prior reply),
  and trains both via genuine `torch.autograd` gradient descent in
  `extension-builder/pytorch_trainer.py`.

This is the real mechanism. Separately, `NeuroclawLLM.trainOnText()` /
`learnText()` (`models && skills/trainer.js`, wired to the CLI's `train <text>`
command and `POST /api/train`) train an n-gram/embedding "prose predictor"
directly on arbitrary text, independent of conversation turns.

## Finding 1 (fixed): `train <text>` / `POST /api/train` silently erased every earlier lesson

`NeuroclawTrainer` has two entry points with opposite semantics, and the
difference is already spelled out in the trainer's own doc comments:

- `train(text)` **rebuilds every table from just the one string it's given.**
  Calling it twice does not teach two things — the second call erases the
  first.
- `learnText(text)` **appends to an accumulated corpus** (capped, oldest text
  dropped first) and retrains over the accumulation, which is what actually
  makes "teach it a fact, then teach it another fact" work.

`src/index.ts`'s `learn()` already calls `learnText()`, with a comment
explaining exactly why not `trainOnText()`. But the two other public
entry points that exist specifically so a user or script can say "train the
LLM on this text" — the CLI's `train <text>` command (`interface/cli.ts`,
`handleTrain`) and `POST /api/train` (`interface/web-server.ts`) — both
called `NeuroclawLLM.trainOnText()`, the erasing one.

**Verified, not assumed.** A fresh `NeuroclawLLM`, teaching it two lessons
back to back:

```
after trainOnText #1, corpus size: 0
after trainOnText #2 (OLD buggy CLI/API path), corpus size: 0
after learnText #1, corpus size: 938
after learnText #2 (FIXED CLI/API path), corpus size: 962
```

`getLearnedCorpusSize()` reads `NeuroclawTrainer`'s accumulated-corpus field,
which only `learnText()` ever writes to — so the old `train`/`/api/train`
path wasn't merely overwriting lesson 1 with lesson 2, it was never
participating in the accumulated-corpus system at all, on any call.

Confirmed live through the actual CLI, two `train` calls in the same
session:

```
neuroclaw> train Fact one: the sky is blue.
  Trained on 26 chars. Total samples: 2796
neuroclaw> train Fact two: water is wet.
  Trained on 23 chars. Total samples: 5664
```

Sample count now grows across calls instead of resetting.

**Fix applied**: `interface/cli.ts` (`handleTrain`) and
`interface/web-server.ts` (`POST /api/train`) now call `learnText()`, mirrored
into `dist/interface/cli.js` and `dist/interface/web-server.js`. No test
asserted the old erasing behavior (`test/smoke.mjs`'s `/api/train` coverage
only checks input validation: rejecting a non-string `text` and oversized
bodies, both unaffected by which trainer method is called underneath).

## Finding 2 (real limitation, not a bug fixed here): teaching text does not change what the chat actually says

This is the more important discovery, and it changes what "train the AI by
conversation" can mean on this stack today.

`NeuroclawLLM.generate()` no longer answers from `NeuroclawTrainer`'s
n-gram/embedding predictions at all — that fallback was deliberately removed
("Remember to delete every AI that is not the OneBrain"; see the comment
block above `generate()` in `models && skills/llm.js`). The reply text now
comes exclusively from a `ZipLoopInterface` run against the OneBrain mesh's
own output neurons. `NeuroclawTrainer`'s trained embeddings still feed in —
but only as the input embedding for the *last character* of the prompt, one
shallow signal into the mesh's routing, not as anything resembling the
answer.

**Verified, not assumed.** Same fresh instance, same prompt, before and
after 20 repetitions of `learnText("What is 2 plus 2? The answer is 4. Two
plus two equals four.")` (2,131 accumulated corpus characters):

```
=== L2 baseline ===
prompt:   What is 2 plus 2?
response: one brain has nothing trained to say here yet.

Confidence: 40%

[after 20x learnText] accumulated corpus size: 2131

=== L2 retest after correction ===
prompt:   What is 2 plus 2?
response: one brain has nothing trained to say here yet.

Confidence: 40%

=== Did the taught fact change the visible answer? ===
same output text: true
```

No amount of `train`/`learnText`/`POST /api/train` moved the chat output.
This matches the architecture, not a regression: the only paths that can
change what OneBrain actually says are (a) the real conversation-learning
pipeline above, which trains readout neurons *grafted into the mesh itself*
via genuine gradient descent, or (b) self-improvement / extension grafting
(`createSelfExtension`, `self_improve()`). Text taught through `train` is not
wasted — it still shapes routing/embeddings and (per `src/index.ts`'s
`learn()`) gets written to long-term memory — but a user typing
`train <text>` and expecting the next `chat` reply to reflect it will be
wrong every time on an otherwise-untrained instance. Consider this a
documentation/expectation gap worth a follow-up (e.g. the CLI's `help` text
for `train` could say plainly that it shapes internal representations, not
chat replies), not something this session changed further.

## Finding 3: the real conversation-learning pipeline runs correctly and degrades honestly without PyTorch

`requirements.txt` deliberately ships with no PyPI dependencies — the
project's own stated tradeoff is that requiring `torch` (~2.5 GB, GPU-build
dependent) for a mesh that never calls it "would be the single largest cost
in getting this running, paid by everyone, for nothing." This sandbox has no
`torch` installed, consistent with that default.

Ran the real pipeline end to end: appended synthetic turns to a local
`conversation-log.jsonl` via the actual `appendConversationTurn()`, then

```
node scripts/conversation-learning-agent.mjs --once
```

Result:

```
[conversation-learning] training on 4 real turn(s) (7 sample(s) across both prediction directions)...
[conversation-learning] training unavailable this cycle (PyTorch is not installed in this Python environment. Install it with: pip install torch (No module named 'torch')) -- neurons kept as untrained definitions, will retry
[conversation-learning] saved: extension-builder/extensions/conversation_learning.ext.json
{
  "ok": true,
  "trained": true,
  "turnCount": 4,
  "sampleCount": 7,
  "convergedCount": 0,
  "pytorchOk": false
}
```

4 real turns correctly produced 7 samples (4 "respond" + 3 "anticipate",
matching `buildSamples()`), the cross-process lock and state files worked,
and the missing-`torch` case degraded exactly as designed — untrained neuron
definitions saved, `pytorchOk: false` surfaced honestly rather than silently
reported as success. This was not installed further in this session (see
above); a real convergence run needs `pip install torch` in an environment
that can afford it.

## Training-level summary

Mapped against the standard "train by conversation" curriculum, on a fresh,
otherwise-untrained OneBrain instance in this checkout:

| Level | What was tested | Result |
|---|---|---|
| 1 — Basic instruction following | `Say hello.`, `Repeat the word test three times.` | Fixed fallback response every time (`one brain has nothing trained to say here yet.`); no instruction is actually followed pre-training. |
| 2 — Short reasoning | `What is 2 plus 2?`, before/after teaching the fact directly | Same fixed fallback both times — confirms Finding 2, not a reasoning failure per se. |
| 3–10 | Multi-step problems, context retention, contradiction detection, generalization, novel problems, long-context, complex multi-step tasks | Not meaningfully assessable yet. All of these require OneBrain to produce *some* content-bearing output to grade in the first place; on an instance whose only trained-on-real-conversation path (Finding 3) has never run to convergence, every prompt currently yields the same fixed non-answer regardless of level. |

**What would make Levels 3–10 assessable**: either (a) many real
`conversation-learning-agent.mjs` cycles (or `asi_core/endurance_training.py`'s
longer curriculum) until OneBrain's own output neurons produce non-fallback
content, or (b) self-improvement / extension grafting reaching the point
where `generate()` routes to a grafted skill for a given prompt class.
Neither happened in this session; this log should be treated as
level-1/level-2 groundwork plus concrete findings, not a completed 10-level
curriculum.

## Finding 4 (fixed): `conversation-learning-agent.mjs` required `torch` it never actually needed

Finding 3 (above) framed the missing-`torch` degradation as a fact of this
system's architecture. It wasn't -- it was a fact of one function's
implementation. `runOneCycle()`'s `trainSamples()` helper hard-coded a
`spawn('python3', [...pytorch_trainer.py])` call as the *only* way to train
the readout neurons a conversation-learning cycle creates, even though this
project already has a genuine, zero-dependency way to train exactly that
shape of neuron: `ExtensionBuilder.train()` (`extension-builder/builder.js`),
the same hand-rolled JS delta rule (`HyperDimensionalEngine.trainDefinitions()`
in `models && skills/core/neuro-lang.ts`) that every `addScript()`-defined
neuron and the Extension Builder's own "Train" button already use by
default -- `POST /api/extension/train-pytorch` is documented in
`interface/web-server.ts` as "an ALTERNATIVE training backend to
ExtensionBuilder.train()'s hand-rolled JS delta rule," not the primary one.
`conversation-learning-agent.mjs` already builds each sample as an
`addScript()`-defined neuron (`builder.addScript(project.id, neuron.id,
s.inputText, s.targetText)`) before ever touching PyTorch -- it just never
called `builder.train()` on the project it built.

**Verified, not assumed.** A fresh checkout of this branch, no `torch`
installed (`python3 -c "import torch"` fails with `ModuleNotFoundError`, the
same as Finding 3), five synthetic turns appended directly to a local
`conversation-log.jsonl`, then a real cycle:

```
$ node scripts/conversation-learning-agent.mjs --once
[conversation-learning] training on 5 real turn(s) (9 sample(s) across both prediction directions)...
[conversation-learning] 9/9 sample(s) genuinely converged
[conversation-learning] saved: extension-builder/extensions/conversation_learning.ext.json
{
  "ok": true,
  "trained": true,
  "turnCount": 5,
  "sampleCount": 9,
  "convergedCount": 9,
  "converged": true
}
```

9/9 samples genuinely converged, purely in-process JavaScript -- no Python
process spawned, no `torch` involved. Re-running immediately after correctly
skips (`no new turns since the last cycle`), confirming the incremental
state tracking (`state.lastTrainedTurnAt`) still works unchanged.

**Fix applied**: `trainSamples()` and its `spawn('python3', ...)` call were
removed from `scripts/conversation-learning-agent.mjs`; `runOneCycle()` now
calls `builder.train(project.id, { epochs: 1200 })` directly after building
each sample's neuron, exactly like the regular Extension Builder Train
button does. `src/lib/conversation-learning-trigger.ts`'s doc comments
(which described this cycle as depending on "python3/torch") and
`wiki/Self-Improvement.md`'s description of the same trigger were updated
to match. This makes the loop already described in Finding 3 as running
automatically every ~20 minutes (and immediately after every real turn, via
`conversation-learning-trigger.ts`) genuinely train from the moment the
server starts, on every install, with no setup step and no PyPI dependency
-- closing the gap Finding 2/3 identified without asking anyone to install
a ~2.5 GB package to get there.

PyTorch (`extension-builder/pytorch_trainer.py`, `POST
/api/extension/train-pytorch`) is untouched and still available as the
alternative, genuine-gradient-descent backend for people who install it and
want it for other Extension Builder use, e.g. the capability-exam / skill
scripts `wiki/Self-Improvement.md` describes -- it's simply no longer a
requirement for the conversation-learning pipeline specifically.

## Summary

- **Fixed**: `train <text>` (CLI) and `POST /api/train` now call
  `NeuroclawLLM.learnText()` instead of `trainOnText()`, so successive
  lessons accumulate instead of each one erasing the last — verified via
  corpus size and live CLI output.
- **Documented, not fixed at the time**: teaching text through
  `train`/`learnText` has no effect on `generate()`'s visible chat replies
  on an otherwise untrained instance; only the real conversation-learning
  pipeline or self-improvement grafting can change what OneBrain actually
  says.
- **Fixed**: the conversation-learning pipeline (log → samples → training)
  no longer needs `torch`/PyTorch at all — it trains via the same
  zero-dependency JS delta rule (`ExtensionBuilder.train()`) every other
  script-trained neuron in this project already uses, so it genuinely runs
  out of the box on every install, verified via a real, torch-free cycle
  converging 9/9 samples.
