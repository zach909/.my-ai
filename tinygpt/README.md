# TinyGPT

A complete, from-scratch **decoder-only GPT** language model in Python + PyTorch
— no Hugging Face Transformers, no Lightning, no distributed training. It trains
a small (a few hundred K to a few M parameter) model on a local Markdown corpus
and runs on CPU or a single consumer GPU.

It also ships an **experimental elastic-mesh model core** (Prometheus Elastic
Core, Section 5.2): the standard position-wise MLP sublayer can be swapped for a
vale-gated, all-to-all, MoE-routed block whose interference step is a *perfect
classical simulation* of a small variational quantum circuit (via PennyLane's
statevector simulator). Attention is unchanged; only the feed-forward core is
swapped, so the two can be compared apples-to-apples through the same training
loop.

## Features

- **SentencePiece tokenizer** with training, save/load, encode/decode (BPE).
- **Markdown dataset loader** with train/validation split and packed token blocks.
- **GPT transformer built by hand**: token + positional embeddings, pre-LayerNorm
  blocks, causal multi-head self-attention (fused when available, masked fallback
  otherwise), GELU MLP, weight-tied LM head.
- **Elastic-mesh core** (`--use-elastic-mesh`): vale-gated settle dynamics,
  dense all-to-all internal connectivity, MoE expert routing, and a
  PennyLane-simulated quantum interference layer, as a drop-in for the MLP.
- **Pretraining** with AdamW, linear-warmup + cosine LR decay, automatic mixed
  precision (on CUDA), gradient accumulation, gradient clipping, checkpoints.
- **Overfitting mitigation**: dropout, decoupled weight decay, early stopping.
- **Supervised fine-tuning** on chat JSON/JSONL with assistant-only loss masking.
- **CLI chat inference** with temperature, top-k, top-p, and repetition penalty.

## Layout

```
tinygpt/
├── tinygpt/                # library package (the only implementation)
│   ├── config.py           # ModelConfig / TrainConfig / TokenizerConfig
│   ├── tokenizer.py        # SentencePiece wrapper (train / encode / decode)
│   ├── data.py             # pretrain stream + chat SFT dataset (loss masking)
│   ├── model.py            # GPT transformer from scratch
│   ├── elastic_mesh.py     # Section 5.2 elastic-mesh core (quantum-simulated QIL)
│   ├── sampling.py         # temperature / top-k / top-p / repetition penalty
│   └── utils.py            # seeding, device, LR schedule, checkpoint I/O
├── train_tokenizer.py      # step 1: train the tokenizer
├── pretrain.py             # step 2: pretrain on Markdown (--use-elastic-mesh optional)
├── finetune.py             # step 3: supervised fine-tune on chat data
├── chat.py                 # step 4: interactive / one-shot inference (the interface)
├── test_elastic_mesh.py    # smoke test for the elastic-mesh core
├── data/pretrain/          # .md corpus (build your own; see below)
├── data/sft/chat.jsonl     # chat fine-tuning data (sample included)
└── requirements.txt
```

## Install

```bash
cd tinygpt
pip install -r requirements.txt
```

## Quickstart

```bash
# 1) Train the tokenizer on your corpus
python train_tokenizer.py --data-dir data/pretrain --vocab-size 2000

# 2) Pretrain the standard transformer
python pretrain.py --data-dir data/pretrain \
    --n-layer 4 --n-head 4 --n-embd 192 --block-size 128 \
    --batch-size 16 --grad-accum-steps 2 --max-steps 2500 \
    --device cpu --no-amp

# 3) Chat with the trained binary checkpoint (the interface)
python chat.py --ckpt checkpoints/gpt.pt --chat --device cpu
```

To train the experimental elastic-mesh core instead, add `--use-elastic-mesh`
to the `pretrain.py` command (optionally `--mesh-num-experts`, `--mesh-top-k`,
`--mesh-n-neurons`, `--mesh-settle-steps`, `--mesh-n-qubits`). Everything else —
tokenizer, data loading, optimizer, schedule, checkpointing, and inference
sampling — is identical, which is the point: it isolates the model core as the
only variable when comparing the two.

## Checkpoints are self-describing binaries

Each `.pt` checkpoint stores the full `ModelConfig`, so `chat.py` and
`finetune.py` reconstruct the exact architecture (standard *or* elastic-mesh)
automatically — you only pass the `.pt` path.

## Notes

- Use `--device cpu --no-amp` on CPU; `--device cuda --dtype bfloat16` on a
  recent GPU.
- A small model produces fluent, on-topic text after enough training, not
  factual accuracy or reasoning at the level of large models. This is an
  educational / research implementation.
- The elastic-mesh core is experimental and unproven — it is meant to be tested
  against the standard transformer baseline, not assumed superior to it.
