# NO THIRD-PARTY CODE (standing rule from the owner; read this first)

The owner has said this many times and it must never need saying again.

- **Never add third-party code of any kind.** No npm, pip or cargo packages; no vendored or cloned source; no SDKs, CLIs, apps or models; no `npm install <pkg>` or `pip install` to make something work, not even "just to test". Write it with Node built-ins, the Python standard library, and this project's own modules.
- **If a task seems to need third-party code, stop and ask.** Do not pick a library and add it. Do not add a dependency to get past a failing step.
- **The only exceptions are ones the owner named:** web search through an open-source SearXNG instance, and an Ollama model reached over HTTP. Both are services the owner runs; nothing from them is vendored or imported. Everything else needs a fresh yes.
- **No tokenizer.** Text enters the mesh as its UTF-8 bytes through the Zip Loop, and audio and images enter as the bits they already are. Do not add word or subword tokenizers, outside embeddings, or speech-to-text (no Whisper, Vosk, Wispr Flow or similar).
- **Check before claiming.** Before saying something is or is not third-party, or is or is not in the repo, look at the files. Do not describe code from memory.
- Already present and not to be added to: `typescript`, `@types/node` and `vitest` as build and test tools. Known leftovers still to be removed: `torch` imports in `model && skills manager/neurolang.py` and the `torch`, `numpy`, `sentencepiece` lines in that folder's `requirements.txt`.

# Git Workflow Policy

- `main` is the only long-lived branch.
- When a change is needed, open it as a pull request: create exactly one branch for that PR, and delete the branch once the PR merges (or closes). Don't create branches "just in case" or leave extra branches sitting around unmerged.
- Don't create sub-branches off of other topic branches — branch from `main`, merge back into `main`.
- Never push directly to `main`; all changes land through a reviewed pull request.
