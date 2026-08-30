# Terms & Conditions

**Plain-language terms of use for running this software — not a substitute for legal advice.** This is not a law-firm-drafted license agreement; it's an honest description of what you're agreeing to by running this code, written by the people who built it. If you need a binding legal document (for redistribution, commercial use, or a regulated context), have a lawyer draft one for your actual situation.

## License

This repository does not currently include a formal `LICENSE` file. Until the repository owner adds one, all rights are reserved by default — treat this as "look but the usual open-source permissions (redistribution, modification, commercial use) are not explicitly granted" unless a `LICENSE` file says otherwise by the time you're reading this.

## No warranty

This software is provided as-is. It is a research/hobby project (an experimental neural-mesh engine, not a certified or audited product), and it comes with no warranty of any kind — no guarantee of correctness, fitness for a particular purpose, or fitness for production/safety-critical use. Use it at your own risk, and test it yourself before relying on it for anything that matters.

## Autonomous behavior — what runs on its own, and how to control it

Running `npm run server` starts more than a web server. Before you run it, you should know what else it does:

- **Autonomous self-improvement** (`scripts/self-improve.mjs`): periodically retrains a bounded set of this project's own skill networks with mutated hyperparameters, inside an isolated local sandbox, and — only if a candidate strictly outperforms the current best AND still passes the full runner test suite — pushes that result **directly to `main`, with no human review step**, and (if you've configured peers) to them directly too. This happens automatically, on a timer, once the server is running. **This is an explicit choice, not a conservative default** — commits land on your primary branch unattended the moment a candidate passes its checks. **Disable it entirely** with `NEUROCLAW_SELF_IMPROVE=0`, or redirect it to an isolated branch instead of `main` with `NEUROCLAW_SELF_IMPROVE_BRANCH=<branch>`.
- **Peer sync** (`scripts/peer-sync.mjs`): listens on a local port for improvements from peers you configure, and only accepts a message if it's a real improvement over your own local best, matches a fixed whitelist of target scripts, and passes strict validation (no arbitrary code is ever executed from a peer message — see [[Privacy-Policy]]). Off/empty by default; you must configure `NEUROCLAW_PEERS` or `extension-builder/peers.txt` for it to talk to anyone. **Disable the listener** with `NEUROCLAW_PEER_SYNC=0`.
- **System diagnostics**: read-only, printed to your own terminal at startup — never modifies anything on your machine, never transmits anything. See [[Privacy-Policy]] for exactly what it reads.

If you're deploying this on a machine you don't fully control, or somewhere a direct push to `main` matters (a shared/production repo), read `scripts/self-improve.mjs`'s own doc comment before enabling it — it explains exactly what gets pushed and under what conditions.

## What this software does not do

- It does not scan for or remove viruses/malware — `scripts/system-diagnostics.mjs` explicitly says so in its own output. If you're worried about malware, run a real antivirus tool.
- It does not modify system-wide settings, defragment drives, delete files, or change anything outside its own project directory and its own sandboxed git worktrees.
- It does not use any capability against a target outside your own machine and your own configured peers — no external "hacking," no unauthorized access to any other system.

## Your responsibility

You are responsible for reviewing what this software does before running it in any context where the consequences matter — especially the autonomous push-to-`main` and peer-sync behavior described above. Peer sync defaults to empty/off until you configure it, but the self-improvement push to `main` is on by default once the server is running — you should understand it rather than assume it's conservative.

## Changes to these terms

This page reflects the software's actual behavior as of when it was last edited. If the code changes, this page should be updated to match — if you find a mismatch between what's documented here and what the code actually does, that's a bug in the documentation, and the code's real behavior (readable in `scripts/self-improve.mjs`, `scripts/peer-sync.mjs`, and `scripts/system-diagnostics.mjs`) is the source of truth.

## See Also

- [[Privacy-Policy]] — what data is or isn't collected/transmitted
- [[Privacy]] — the technical encryption/security implementation
- [[Home]] — project overview
