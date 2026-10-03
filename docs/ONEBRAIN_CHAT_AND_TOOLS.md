# OneBrain in chat, and OneBrain calling tools

## What a chat turn does now

`POST /api/chat/messages` → `ChatBot.processMessage()` (`src/server/bot-service.ts`):

1. Route and error questions are answered from app introspection (never the brain).
2. **OneBrain is asked first** (`NeuroclawSystem.askOneBrain()`, `src/index.ts`). It answers in one of three ways:
   - `network`: a tool neuron the mesh fired on its own was called (`ToolNeuronLayer.step()`); the tool's result is the reply.
   - `router`: the message named a tool call outright (`models && skills/core/tool-router.ts`, e.g. ``run `ls` ``, `read file x`). It is made as a message-origin neuron event.
   - `brain`: whatever OneBrain wrote to its output.
3. If OneBrain has nothing usable (silent, non-text bytes, past its deadline, disabled, or it throws) the turn falls through to what chat did before: the prompting-skill loop, trained-skill match, then plan / recall / solve.

Knobs: `NEUROCLAW_ONEBRAIN_FIRST=0` turns step 2 off. `NEUROCLAW_ONEBRAIN_DEADLINE_MS` (default 6000) bounds how long the brain may take; the run is cut off between output bytes (`HaltConfig.deadline` in `zip-halt.ts`), so one settle of a large mesh can still overrun it.

## Safety

- A tool call from a message goes through `ToolNeuronLayer.dispatch()`: the same Access-page capability check a network firing gets (`terminal.execute`, `files.write`, ...). `call()` does not check access; `dispatch()` does.
- The AlignmentVeto sees the call first. Its "needs human confirmation" flag for irreversible/external-effect actions is not blocking here: typing ``run `cmd` `` is the confirmation. A veto that forbids the action outright is honoured.
- The router recognises only explicit phrasings. A paraphrase ("can you check the output of ls") is left alone, because a wrong guess is a real command on a real machine.

## What does NOT work yet: teaching the network to pick tools

Tool neurons exist and fire from a tool-neuron crossing, but nothing teaches the mesh to cross for the right prompt. This was attempted and measured, and **it failed**; the code was removed rather than shipped.

Setup: a small mesh (16 neurons + the terminal's 12 tool neurons + 2 result neurons, 8 dimensions), four prompts, each labelled with one terminal tool. Prompts were streamed as chat streams them (packed archive through the Zip Loop doorway).

- Plain Hebbian (drive the target tool neuron while the prompt is held): every tool's score for every prompt rose to the same value (0.739), then at 20 epochs fell back to 0.405 for all. It learned "something was said", not "this was said".
- Error-driven perceptron over the mesh's real per-dimension weights (push the wrong neurons down, the right one up, using end-of-stream and per-tick state): all four tool neurons fired on every prompt, including held-out ones like "hello there".

Cause, measured: two different prompts ("read file notes.txt" vs "list directory src") left tool-neuron energies equal to three digits (e.g. 3.89e-2 vs 3.75e-2 for `read_file`, the rest identical). The packed archive's fixed header dominates the few differing bytes, and the mesh's recurrent dynamics wash out the rest, so the end state carries almost nothing about the prompt. No readout from that state can separate prompts.

A tool layer that fires everything for everything would make every chat turn attempt terminal calls. That is why the untrained behaviour (fires nothing) is kept, and why selection is by the router until this is fixed.

Next steps that would address the cause rather than the readout: make the doorway's state depend on the prompt (feed the raw prompt bytes without the archive header, or give the mesh more dimensions and neurons than the toy used), then re-run the same measurement. `scripts/tool-call-dataset.mjs` is the labelled set to train and score against: `explicit: true` examples must agree with the router (checked in `test/core/tool-router.test.ts`); `explicit: false` examples are the paraphrases a learned router would have to get right.

## Known pre-existing issue

`test/core/tool-neurons-chat.test.ts` calls `processQuery()`, which runs a full un-bounded OneBrain generation, and timed out at 120 s in this environment before any of these changes. Everything else in `tool-neurons*.test.ts` and `bot-service.test.ts` passed.
