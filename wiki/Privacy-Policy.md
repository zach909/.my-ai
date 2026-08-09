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

## What leaves your machine, and exactly when

| Feature | What's sent | Where it goes | When it happens |
|---|---|---|---|
| Web search (`ResearchPlugin.searchWeb()`, `digestIntel()`) | Your search query text | DuckDuckGo's public HTML search endpoint | Only when you or the agent explicitly invoke a web search — never automatically, never in the background |
| Self-improvement `beta` push | Hyperparameter values (epochs, learning rate, tolerance) and a numeric accuracy score — **never conversation content, files, or personal data** | This project's own GitHub repository, `beta` branch | Only when a candidate genuinely outperforms the current best (see [[Home]]'s self-improvement section) and `NEUROCLAW_SELF_IMPROVE` isn't disabled |
| Peer sync (`scripts/peer-sync.mjs`) | The same hyperparameter/score data as the beta push — nothing else | Directly to peers YOU configure (`NEUROCLAW_PEERS` or `extension-builder/peers.txt`) | Only when you've configured at least one peer; empty (a complete no-op) by default |

Nothing else in this project makes an outbound network call. This is enforced at multiple layers, not just claimed once — see [[Privacy]]'s "What 'no external APIs' actually means here" section for the specifics (plugin architecture, server bind address, CORS policy).

## What's never collected, under any configuration

- No analytics, telemetry, crash reports, or usage statistics sent to this project's authors.
- No accounts, no sign-up, no identifiers tied to a person.
- No third-party trackers, ad networks, or fingerprinting.
- No conversation content, file contents, or personal data is ever included in the self-improvement or peer-sync payloads — those only ever carry small numeric hyperparameters and a score (see `validateImprovementMessage()` in `scripts/peer-sync.mjs`, which rejects anything outside that exact shape).

## Your control over the network-touching features

- Web search only fires when explicitly invoked (a tool call, not a background process).
- The self-improvement loop and its `beta` push can be turned off entirely with `NEUROCLAW_SELF_IMPROVE=0`.
- Peer sync is opt-in and empty by default (`NEUROCLAW_PEER_SYNC=0` disables the listener entirely); you choose exactly who your instance talks to.

## See Also

- [[Privacy]] — the technical implementation: encryption, key derivation, and how "no external APIs" is enforced in code
- [[Home]] — the self-improvement loop and peer-sync feature overview
- [[Terms]] — terms of use for running this software
