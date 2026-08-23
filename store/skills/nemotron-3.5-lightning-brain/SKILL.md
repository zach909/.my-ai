# Nemotron 3.5 Lightning — external brain (UNOFFICIAL)

**This is a community skill. It is not official, and it is not affiliated with
or endorsed by NVIDIA.** It points at a model NVIDIA publishes; it does not
redistribute it.

Model: [`nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4`](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4)
· 17.8B parameters (~3B active, MoE) · `nemotron_h` · NVFP4 quantised

## What it does

Attaches a large external language model to OneBrain as one more expert. The
mesh keeps doing what it does — routing, settling, learning — and gains the
option of delegating a generation to a much larger model when it is installed
and the router selects it.

The mesh is not replaced. If this skill is absent, uninstalled, or the model
fails to load, the agent falls back to its own generation exactly as before.
That is deliberate: an expert that can disappear must never be load-bearing.

## What is NOT in this package

The weights. They are roughly 10 GB and this store is bounded at 32 MB per
item, because everyone who clones the repository pays for whatever anyone
pushes into it. More importantly, NVIDIA publishes this model under its own
licence ("other" on the Hub) and redistributing the weights inside somebody
else's repository is not ours to do.

So this package contains the bridge and the recipe. Installing fetches the
weights from Hugging Face onto **your** machine, under NVIDIA's licence, which
you should read first.

## What it costs to run

Be realistic before installing:

- ~10 GB of disk for the weights
- a GPU for anything resembling interactive speed. NVFP4 runs natively on
  Blackwell-class hardware; elsewhere it is dequantised and needs considerably
  more memory than the file size suggests
- CPU-only will load and technically generate, slowly enough that you will not
  want to chat with it

## Install

```bash
pip install -r requirements.txt
# Reads and accepts NVIDIA's licence on the model page first.
huggingface-cli download nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 \
  --local-dir ./nemotron-3.5-lightning
```

Then point the bridge at it:

```bash
export NEUROCLAW_NEMOTRON_PATH=./nemotron-3.5-lightning
```

## How it attaches

`nemotron_bridge.py` is a persistent stdin/stdout JSON-line worker, the same
shape as this repo's existing PyTorch worker — one process, loaded once,
answering many requests, rather than paying model load on every call.

```
{"op": "load"}                          -> {"ok": true, "device": "cuda"}
{"op": "generate", "prompt": "...", "max_tokens": 256}
                                        -> {"ok": true, "text": "..."}
{"op": "status"}                        -> {"ok": true, "loaded": true, ...}
```

Everything runs on your machine. The download is the only network step, and it
happens once, when you choose it.

## Licence

The model is NVIDIA's, under its own terms — see the model card. This skill is
only the adapter around it.
