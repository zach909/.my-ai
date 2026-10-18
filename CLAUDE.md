# NO THIRD-PARTY CODE (standing rule from the owner; read this first, every session)

The owner has said this many times and it must never need saying again. The full text is in `AGENTS.md`; this is the part Claude must follow without being reminded.

- **Never add third-party code of any kind.** No npm, pip or cargo packages; no vendored or cloned source; no SDKs, CLIs, apps or models; no copying code from other projects, websites, Stack Overflow or docs; no `npm install <pkg>`, `pip install`, `npx <pkg>` or `git clone` of someone else's repo, not even "just to test". Write it with Node built-ins, the Python standard library, and this project's own modules.
- **If a task seems to need third-party code, stop and ask.** Do not pick a library and add it, and do not add a dependency to get past a failing step. Say what you need and why, and wait for a fresh yes.
- **The only exceptions are the ones the owner named:** web search through an open-source SearXNG instance and an Ollama model reached over HTTP. Both are services the owner runs; nothing from them is vendored or imported. Build and test tools already present: `typescript`, `@types/node`, `vitest`.
- **No tokenizer.** Text, audio and images enter the mesh as raw bits through the Zip Loop. No tokenizers, outside embeddings or speech-to-text.
- **Check before claiming.** Look at the files before saying something is or is not third-party or in the repo. Do not describe code from memory.
- **The rule is enforced.** `node scripts/check-no-third-party.mjs` must pass before you commit or finish. Hooks in `.claude/settings.json` will block installs, clones and edits that add third-party code. If the check or a hook blocks you, remove the third-party code and tell the owner; never edit the guard files (`scripts/check-no-third-party.mjs`, `.third-party-allowlist.json`, `.githooks/`, `.claude/hooks/`, `.claude/settings.json`, the no-third-party workflow), widen the allow-list, use `--no-verify`, or find another route around the block.
- **Code that is the owner's, yours, or another AI's output is fine. Code written by someone else and published is not.** If you are unsure which a piece of code is, treat it as not allowed and ask.

See `AGENTS.md` for the visual style rules and the dev environment notes.
