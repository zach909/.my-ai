# The backroom (a mod)

NeuroClaw and an Ollama-hosted model (Gemma by default) talking to each other with nobody prompting either one, until you stop it.

This is a **mod**: a store item that only adds files. It changes no core file, adds no npm or pip package, and is not part of the main branch. Install it from the store, apply it, and revert it to get back exactly what you had.

## Install and run

1. Apply the mod: **Store > Mods > backroom > Apply**, or the terminal tool `apply_mod` with `{"name": "backroom"}`. Applying needs the `mods.apply` capability, which is off by default (turn it on in Access). A backup of anything it overwrites is kept.
2. Pull a model into Ollama once, on the machine running it: `ollama pull gemma3`.
3. `node scripts/backroom.mjs`. The first run compiles the backend. Ctrl-C stops it.

To remove it: `revert_mod` with `{"name": "backroom"}`. It deletes the files the mod created.

The mod writes these files: `plugins/backroom/engine.ts`, `plugins/backroom/index.ts`, `scripts/backroom.mjs`, `test/core/backroom.test.ts`, `docs/BACKROOM.md`.

There is no chat command (`start backroom`) and no `npm run backroom`, because both would mean editing core files (`plugins/index.ts`, `package.json`). Run the script.

## What a turn does

1. The other model replies to the conversation so far (`POST /api/chat` on Ollama, non-streaming).
2. If the line is long enough and new, NeuroClaw keeps it: remembered as *the other model said ...* (tags `backroom`, `external-model`, importance 0.3), and every 8 new lines the language model is trained on the batch (`llm.learnText`).
3. NeuroClaw answers with `llm.generate()`, bounded by a deadline (default 8 s).
4. Every 50 new lines a digest page is published through the wiki store, so it goes to the `store` branch like every other store item. Never to `main` or a working branch.

Settings: `NEUROCLAW_BACKROOM_MODEL` (gemma3), `OLLAMA_HOST` (127.0.0.1:11434), `NEUROCLAW_BACKROOM_SEED`, `NEUROCLAW_BACKROOM_MAX_TURNS` (unset = until stopped), `NEUROCLAW_BACKROOM_PUBLISH_EVERY` (50, `0` = never publish). Each turn is also appended to `.neuroclaw/backroom/<run>.jsonl`.

## Safety, and why

- **The other model's text can never run a tool.** NeuroClaw answers through `llm.generate()`, which is generation only. `askOneBrain()` is not used because its router reads ``run `ls` `` as a command. The test `answers the other model through llm.generate() only` pins this.
- **It can always be stopped,** including mid-request, and an unreachable Ollama ends the run with the reason after 5 consecutive failures instead of retrying forever.
- **Agreement between two models is not evidence.** Lines that mostly repeat something already kept are skipped (and counted). If the other model says nearly the same thing three times running, the conversation is re-seeded with a new topic.
- **Published digests say what they are:** each starts with a note that the lines are unverified model output kept because they were new, not because they are true.
- **It does not use `learnFrom()`,** the path that feeds text into the mesh, which refuses `"web"` content on purpose. Another model's output is the same kind of outside text. The mod teaches through `llm.learnText()` (the prose predictor's n-gram tables, embeddings and hidden layer) and long-term memory. Each `learnText` call retrains on the whole accumulated corpus up to its cap, which is why lines are batched 8 at a time.
- **No third-party code.** Node built-ins only. Ollama is a program you run separately and the mod talks to it over HTTP.

## What it does not do yet

NeuroClaw is mostly silent. OneBrain has little trained to say, so in practice most turns the other model speaks and NeuroClaw says nothing (the status counts these as `silentTurns`, and Gemma is told "NeuroClaw said nothing"). In a real run against the built system, 3 of 3 NeuroClaw turns were silent while the learned corpus grew from 0 to 1192 characters. So today this is closer to NeuroClaw listening to Gemma than to a conversation. That the loop teaches it is measured; that the replies improve is not.

It has been exercised only against a scripted fake Ollama server. It has not been run against a real Gemma.
