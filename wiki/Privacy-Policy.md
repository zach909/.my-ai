# Privacy Policy

**This is a plain-language description of what this software actually does with data — not a substitute for legal advice.** If you're deploying this for others (a business, a shared service, a regulated context), have a lawyer review your actual usage before relying on this page. It describes the code's real behavior as of this writing, not a legal guarantee.

For the technical implementation of encryption and the "no external APIs" architecture, see [[Privacy]] — this page is the plain-language "what happens to my data" companion to that technical page.

## The short version

This software runs locally on your own machine by default. It doesn't have accounts, doesn't phone home to its authors, and doesn't collect analytics or telemetry about you or your usage. A small number of features you have to explicitly use or explicitly enable send specific, limited data off your machine — every one of them is listed below, with exactly what leaves and where it goes.

## What stays entirely local, always

- **Conversation memory, the reasoning ledger, the empathy state** — persisted locally, optionally encrypted at rest (see [[Privacy]] and [[Zip-IO]]). Never transmitted anywhere.
- **Drive search** (`ResearchPlugin.searchDrive()`) — reads files under a root you specify (your own machine's filesystem, default the current working directory). Nothing about what it finds is sent anywhere; results only return to the process that called it.
- **System diagnostics** (`scripts/system-diagnostics.mjs`, printed when you run `npm run server`) — reads local memory/process statistics and prints them to your own terminal. Nothing is transmitted, logged externally, or stored beyond that printed report. It is explicitly **not** a virus scanner and does not claim to detect malware — see the disclaimer it prints alongside its report.
- **Self-improvement training** (`scripts/self-improve.mjs`) — runs entirely on your own machine, in a throwaway local git worktree. No data about your usage, conversations, or files is included in what it trains on or produces.
- **Conversation-learning training** (`scripts/conversation-learning-agent.mjs`) — your real conversation turns (message + response) are logged locally (`extension-builder/conversation-log.jsonl`, gitignored) and trained on locally. This is the one piece of this project that learns from your actual usage, and it is also the one with the strictest guarantee: the script has no code path capable of sending any of it anywhere — it never calls the git-publish helpers or the peer-sync broadcaster the other two agents use. Your conversations never leave this machine, structurally, not just by policy. See [[Self-Improvement]].

- **Data donor** (`models && skills/core/data-donor.ts`) — **off by default.** If you switch it on, screenshots and/or microphone audio are saved to `~/.neuroclaw/donor/` and used to train this machine's own network. There is no upload path in that file: the capture never leaves this machine. You can pause it, set quiet hours, stop it or erase everything captured from the Sharing page (`/sharing`). Recording other people (a call, someone in the room) is your responsibility: tell them, and note that recording a voice without consent is unlawful in many places.

## What leaves your machine, and exactly when

| Feature | What's sent | Where it goes | When it happens |
|---|---|---|---|
| Web search (`ResearchPlugin.searchWeb()`, `digestIntel()`) | Your search query text | The SearXNG instance you configure with `NEUROCLAW_SEARXNG_URL` (default `http://127.0.0.1:8080`, i.e. one on your own machine, so nothing leaves it unless you point this at a remote instance) | Only when you or the agent explicitly invoke a web search — never automatically, never in the background |
| Self-improvement push | Hyperparameter values (epochs, learning rate, tolerance) and a numeric accuracy score — **never conversation content, files, or personal data** | This project's own GitHub repository, directly to the `main` branch by default (`NEUROCLAW_SELF_IMPROVE_BRANCH` to change it) | Only when a candidate genuinely outperforms the current best AND passes the full runner test suite (see [[Self-Improvement]]) and `NEUROCLAW_SELF_IMPROVE` isn't disabled |
| Peer sync (`scripts/peer-sync.mjs`) | The same hyperparameter/score data as the GitHub push — nothing else | Directly to peers YOU configure (`NEUROCLAW_PEERS` or `extension-builder/peers.txt`) | Only when you've configured at least one peer; empty (a complete no-op) by default |
| Shared learning (`models && skills/core/shared-mesh-sync.ts`) — **opt-in** | Changes to the live mesh's learned weights (int8-quantised numbers for its shared 64-neuron block), under a random per-install id — **never conversation text, files, or personal data** | This project's own GitHub repository, `extension-builder/shared-mesh/deltas/<id>.json` on `main` (`NEUROCLAW_SHARED_LEARNING_BRANCH` to change it) | **Only if you set `NEUROCLAW_SHARED_LEARNING=1`**; off by default. At most once per `NEUROCLAW_SHARED_LEARNING_INTERVAL_MS` (30 min), and only when your mesh's own learning changed. Weights are learned from what you and the agent say, so they are derived from your usage, but they are not text and can't be read back as it |
| Compute sharing (`models && skills/core/compute-share.ts`) — **opt-in, two directions** | **Borrowing:** the text of the question you ask, plus your lease token, to a computer you added yourself. **Lending:** nothing leaves; a guest's question arrives, is answered by your agent, and the answer goes back to them. Either way the machine that runs a job can read it. | Only to the addresses you add (borrowing), or only to someone holding a lease token you issued (lending) | Lending is **off by default** and each lease has a time limit, a compute cap, and can be ended at any time. Borrowing happens only when you ask. |

Nothing else in this project makes an outbound network call. This is enforced at multiple layers, not just claimed once — see [[Privacy]]'s "What 'no external APIs' actually means here" section for the specifics (plugin architecture, server bind address, CORS policy).

## What's never collected, under any configuration

- No analytics, telemetry, crash reports, or usage statistics sent to this project's authors.
- No accounts, no sign-up, no identifiers tied to a person.
- No third-party trackers, ad networks, or fingerprinting.
- No conversation content, file contents, or personal data is ever included in the self-improvement or peer-sync payloads — those only ever carry small numeric hyperparameters and a score (see `validateImprovementMessage()` in `scripts/peer-sync.mjs`, which rejects anything outside that exact shape).

## Your control over the network-touching features

- Web search only fires when explicitly invoked (a tool call, not a background process).
- The self-improvement loop and its push to `main` can be turned off entirely with `NEUROCLAW_SELF_IMPROVE=0`, or redirected to an isolated branch instead of `main` with `NEUROCLAW_SELF_IMPROVE_BRANCH=<branch>`.
- Peer sync is opt-in and empty by default (`NEUROCLAW_PEER_SYNC=0` disables the listener entirely); you choose exactly who your instance talks to.

## See Also

- [[Privacy]] — the technical implementation: encryption, key derivation, and how "no external APIs" is enforced in code
- [[Home]] — the self-improvement loop and peer-sync feature overview
- [[Terms]] — terms of use for running this software
