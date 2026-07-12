# TinyGPT

A complete, from-scratch **decoder-only GPT** language model in Python + PyTorch
— no Hugging Face Transformers, no Lightning, no distributed training. It trains
a ~10–30M parameter model on a small English Markdown corpus and runs locally on
a single consumer GPU (e.g. an RTX 5070).

## Features

- **SentencePiece tokenizer** with training, save/load, encode/decode (BPE by default).
- **Markdown dataset loader** with train/validation split and packed token blocks.
- **GPT transformer built by hand**: token + positional embeddings, pre-LayerNorm
  blocks, causal multi-head self-attention (fused FlashAttention when available,
  explicit masked fallback otherwise), GELU MLP, weight-tied LM head.
- **Configurable hyperparameters** via `tinygpt/config.py` and CLI flags.
- **Pretraining** with AdamW, linear-warmup + cosine LR decay, automatic mixed
  precision (bf16/fp16), gradient accumulation, gradient clipping, checkpoints.
- **Overfitting mitigation**: dropout, decoupled weight decay, early stopping on
  validation loss.
- **Supervised fine-tuning** on chat JSON/JSONL with assistant-only loss masking.
- **CLI chat inference** with temperature, top-k, top-p, and repetition penalty.

## Layout

```
tinygpt/
├── tinygpt/                # library package
│   ├── config.py           # ModelConfig / TrainConfig / TokenizerConfig
│   ├── tokenizer.py        # SentencePiece wrapper (train / encode / decode)
│   ├── data.py             # pretrain stream + chat SFT dataset (loss masking)
│   ├── model.py            # GPT transformer from scratch
│   ├── sampling.py         # temperature / top-k / top-p / repetition penalty
│   └── utils.py            # seeding, device, LR schedule, checkpoint I/O
├── train_tokenizer.py      # step 1: train the tokenizer
├── pretrain.py             # step 2: pretrain on Markdown
├── finetune.py             # step 3: supervised fine-tune on chat data
├── chat.py                 # step 4: interactive / one-shot inference
├── data/pretrain/          # put your .md corpus here (sample included)
├── data/sft/chat.jsonl     # chat fine-tuning data (sample included)
└── requirements.txt
```

## Install

```bash
cd tinygpt
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# For a specific CUDA build (recommended on new GPUs like the RTX 5070), follow
# https://pytorch.org/get-started/locally/ instead of the default torch wheel.
```

## Quickstart (runs on the included sample data)

```bash
# 1) Train the tokenizer
python train_tokenizer.py --data-dir data/pretrain --vocab-size 8000

# 2) Pretrain (tiny settings just to see it work end-to-end on CPU/GPU)
python pretrain.py --data-dir data/pretrain \
    --n-layer 4 --n-head 4 --n-embd 128 --block-size 128 \
    --batch-size 8 --grad-accum-steps 1 --max-steps 200 \
    --eval-interval 50 --device cpu --no-amp

# 3) Fine-tune on chat data
python finetune.py --init checkpoints/gpt.pt --data data/sft/chat.jsonl \
    --max-steps 100 --device cpu --no-amp

# 4) Chat
python chat.py --ckpt checkpoints/gpt_sft.pt --chat --device cpu
```

## Real training run (RTX 5070, ~15M params)

```bash
# put a real .md corpus in data/pretrain/ first
python train_tokenizer.py --vocab-size 8000
python pretrain.py --n-layer 12 --n-head 6 --n-embd 384 --block-size 256 \
    --batch-size 32 --grad-accum-steps 4 --max-steps 5000 \
    --device cuda --dtype bfloat16
python finetune.py --init checkpoints/gpt.pt --data data/sft/chat.jsonl \
    --max-steps 1000 --device cuda --dtype bfloat16
python chat.py --ckpt checkpoints/gpt_sft.pt --chat
```

## Unified core (`core.py`)

`core.py` runs the whole thing as **one system**: the real TinyGPT model as the
language engine, wrapped by the genuinely-applicable Prometheus mechanisms as
real, working layers.

```bash
python core.py --ckpt checkpoints/gpt_sft.pt --candidates 5
```

- **Zip-loop memory** (§2) — a persistent ring buffer of the conversation
  (`tinygpt/memory.py`), reloaded across restarts.
- **Predict-before-commit** (§11) — generates N candidate replies and commits
  the one the model is most confident in (`tinygpt/selection.py`).
- **Alignment veto** (§3) + **human-in-the-loop action layer** — the model may
  propose `ACTION: time | system_info | list_dir <p> | read_file <p>`; each is
  vetoed and must be **approved by you** before it runs (`tinygpt/veto.py`,
  `tinygpt/actions.py`). Read-only actions only by default; there is **no
  autonomous execution** — this is the safe basis for computer control, not
  unattended control.

Run the core's tests (no checkpoint needed) with:

```bash
python test_core.py
```

## Model size

`GPT.num_params()` prints the parameter count at startup. Approximate sizes
(vocab 8000):

| n_layer | n_head | n_embd | block | ~params |
|--------:|-------:|-------:|------:|--------:|
| 6       | 6      | 384    | 256   | ~11M    |
| 12      | 6      | 384    | 256   | ~15M    |
| 8       | 8      | 512    | 256   | ~29M    |

## Notes

- Choose `--dtype bfloat16` on Ampere/Ada/Blackwell GPUs; use `float16` on older
  cards, or `--no-amp` on CPU.
- Checkpoints store the full `ModelConfig`, so `chat.py` and `finetune.py`
  reconstruct the architecture automatically — you only pass the `.pt` path.
- The included `data/pretrain/sample.md` is tiny on purpose: it proves the
  pipeline runs. Replace it with a real corpus for a useful model.
- This is an educational implementation. A 10–30M parameter model produces
  fluent, on-topic text after enough training, not factual accuracy or reasoning
  at the level of large models.
