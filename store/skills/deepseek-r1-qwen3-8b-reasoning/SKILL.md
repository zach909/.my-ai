# DeepSeek-R1 (Qwen3-8B distill) — reasoning expert (OPEN, unofficial)

**MIT licensed.** Community skill — not affiliated with or endorsed by
DeepSeek. It points at a model they publish; it does not redistribute it.

Model: [`deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`](https://huggingface.co/deepseek-ai/DeepSeek-R1-0528-Qwen3-8B)
· 8.19B parameters · `qwen3` · MIT · 7.0M downloads

## Why this one

The store already has a Nemotron skill at 17.8B, which realistically needs a
datacentre GPU. That makes it useless to most people who pull this repository,
so this is deliberately the opposite trade:

- **8B, not 30B** — runs on a consumer GPU, and on CPU it is slow but genuinely
  usable rather than theoretical
- **MIT, not "other"** — actually open. You can use, modify and redistribute it
  under plain MIT terms, which is not true of every "open weights" model
- **Reasoning-distilled** — R1's chain-of-thought training distilled into Qwen3,
  so it is strong at exactly the multi-step work OneBrain's reasoning engine
  decomposes into sub-problems

## What it does

Attaches as one more expert. The mesh keeps routing, settling and learning; it
gains the option of delegating a hard reasoning step. If this skill is absent,
uninstalled, or the model will not load, the agent falls back to its own
generation exactly as before — an expert that can disappear must never be
load-bearing.

## Reasoning output

R1-family models emit their working inside `<think>` … `</think>` before the
answer. The bridge separates the two and returns them as distinct fields:

```json
{"ok": true, "reasoning": "...the model's working...", "text": "the answer"}
```

They are kept apart on purpose. Splicing reasoning into the answer is how these
models end up looking like they are rambling, and the reasoning is genuinely
useful on its own — it is what you read when you want to know *why* it
concluded something.

## What is NOT in this package

The weights, ~16 GB in bf16. The store caps items at 32 MB because everyone who
clones this repository pays for whatever anyone pushes into it. Installing
fetches them to **your** machine.

## Install

```bash
pip install -r requirements.txt
huggingface-cli download deepseek-ai/DeepSeek-R1-0528-Qwen3-8B \
  --local-dir ./deepseek-r1-qwen3-8b
export NEUROCLAW_DEEPSEEK_PATH=./deepseek-r1-qwen3-8b
```

Roughly 16 GB of disk. ~16 GB VRAM in bf16, about 5 GB at 4-bit, and CPU-only
works if you are patient.

## Bridge protocol

A persistent stdin/stdout JSON-line worker — one process, model loaded once,
answering many requests.

```
{"op": "status"}                                  -> {"ok": true, "loaded": false, ...}
{"op": "load"}                                    -> {"ok": true, "device": "cuda"}
{"op": "generate", "prompt": "...", "max_tokens": 512}
                                                  -> {"ok": true, "reasoning": "...", "text": "..."}
```

Nothing calls a network service at run time. The download is the only network
step, and it happens once, when you choose it.
