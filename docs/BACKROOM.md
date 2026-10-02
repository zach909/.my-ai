# The backroom

NeuroClaw and an Ollama-hosted model (Gemma by default) talking to each other with nobody prompting either one, until you stop it.

```
ollama pull gemma3          # once, on the machine running Ollama
npm run backroom            # Ctrl-C to stop
```

Or from chat: `start backroom`, `start backroom about <opening line>`, `backroom status`, `stop backroom`.

No new dependencies. The loop and the HTTP call to Ollama use only Node built-ins (`models && skills/core/backroom.ts`); Ollama itself is a separate program you run, not code in this repo.

## What a turn does

1. The other model replies to the conversation so far (`POST /api/chat`, non-streaming).
2. If the line is long enough and new, NeuroClaw keeps it: remembered as *the other model said ...* (tags `backroom`, `external-model`, importance 0.3), and every 8 new lines the language model is trained on the batch (`llm.learnText`).
3. NeuroClaw answers with `NeuroclawSystem.speak()`, bounded by a deadline (default 8 s).
4. Every 50 new lines a digest page is published through the wiki store, so it goes to the `store` branch the way every other store item does. Never to `main` or a working branch.

Settings: `NEUROCLAW_BACKROOM_MODEL` (gemma3), `OLLAMA_HOST` (127.0.0.1:11434), `NEUROCLAW_BACKROOM_SEED`, `NEUROCLAW_BACKROOM_MAX_TURNS` (unset = until stopped), `NEUROCLAW_BACKROOM_PUBLISH_EVERY` (50, `0` = never publish). Each turn is also appended to `.neuroclaw/backroom/<run>.jsonl`.

## Safety, and why

- **The other model's text can never run a tool.** NeuroClaw answers through `speak()`, which is generation only. `askOneBrain()` is not used because its router reads ``run `ls` `` as a command. The test `answers the other model through speak() only` pins this.
- **It can always be stopped,** including mid-request, and an unreachable Ollama ends the run with the reason after 5 consecutive failures instead of retrying forever.
- **Agreement between two models is not evidence.** Lines that mostly repeat something already kept are skipped (and counted). If the other model says nearly the same thing three times running, the conversation is re-seeded with a new topic. Without this an endless loop teaches the same sentence thousands of times.
- **Published digests say what they are:** each starts with a note that the lines are unverified model output kept because they were new, not because they are true.
- **It does not use `learnFrom()`,** the path that feeds text into the mesh, which refuses `"web"` content on purpose. Another model's output is the same kind of outside text. The backroom teaches through `llm.learnText()` (the prose predictor's n-gram tables, embeddings and hidden layer) and long-term memory. Each `learnText` call retrains on the whole accumulated corpus up to its cap, which is why lines are batched 8 at a time.

## What it does not do yet

NeuroClaw is mostly silent. OneBrain has little trained to say, so in practice most turns the other model speaks and NeuroClaw says nothing (the status counts these as `silentTurns`, and Gemma is told "NeuroClaw said nothing"). In a real run against the built system, 3 of 3 NeuroClaw turns were silent while the learned corpus grew from 0 to 1192 characters. So today this is closer to NeuroClaw listening to Gemma than to a conversation; it becomes two-sided only as the language model accumulates enough to say something back. That the loop teaches it is measured; that the replies improve is not.

It has been exercised only against a scripted fake Ollama server (tests and one real-system run). It has not been run against a real Gemma.
