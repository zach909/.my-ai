# TinyGPT — Production-Grade Language Model from Scratch

A complete, fully runnable GPT-style autoregressive language model (10-30M parameters) built from scratch in Python + PyTorch. No Hugging Face, no Lightning, no distributed training framework.

## Features

✅ **Complete Stack:**
- SentencePiece tokenizer with training, save/load, encode/decode
- Markdown dataset loader with train/validation split  
- Decoder-only GPT Transformer (manual PyTorch implementation)
- Rotary positional embeddings (RoPE) for better long-context handling
- Multi-head self-attention with causal masking
- Pre-normalization (better scaling than post-norm)

✅ **Production Training:**
- AdamW optimizer with weight decay
- Cosine annealing learning rate schedule with warmup
- Automatic Mixed Precision (AMP) for speed and memory efficiency
- Gradient accumulation for larger effective batch sizes
- Gradient clipping and checkpointing
- Validation monitoring and best-model checkpointing

✅ **Inference & Chat:**
- CLI chat interface
- Top-k and top-p (nucleus) sampling
- Temperature control
- Repetition penalty
- Batch generation support

✅ **Fine-tuning:**
- Supervised fine-tuning on JSON chat data
- Resume training from checkpoints

## Quick Start

### 1. Install Dependencies

```bash
cd tinygpt
pip install -r requirements.txt
```

### 2. Prepare Training Data

Create a directory with Markdown files:

```bash
mkdir data
cp your_training_files.md data/
```

### 3. Train the Model

**Pretraining on Markdown data:**

```bash
python train.py \
  --mode pretrain \
  --data-dir data \
  --output-dir output \
  --epochs 3 \
  --batch-size 32 \
  --device cuda  # or 'cpu'
```

**Fine-tuning on chat data:**

First create a `data/chat.json`:

```json
[
  {"user": "What is machine learning?", "assistant": "Machine learning is..."},
  {"user": "How do neural networks work?", "assistant": "Neural networks..."}
]
```

Then fine-tune:

```bash
python train.py \
  --mode finetune \
  --data-dir data \
  --output-dir output_finetuned \
  --epochs 1 \
  --batch-size 16
```

### 4. Chat with the Model

```bash
python -m cli \
  --model output/final_model.pt \
  --tokenizer output/tokenizer \
  --device cuda \
  --temperature 0.7 \
  --top-k 50 \
  --top-p 0.9
```

Then type prompts:

```
You: What is artificial intelligence?
Assistant: [model response]

You: Tell me a joke.
Assistant: [model response]

You: exit
Goodbye!
```

## Architecture Details

### Model Config (config.py)

```python
ModelConfig(
    vocab_size=8192,              # SentencePiece vocab size
    context_length=1024,          # Max sequence length
    hidden_dim=768,               # Embedding dimension
    num_layers=12,                # Number of transformer blocks
    num_heads=12,                 # Attention heads (head_dim = 768/12 = 64)
    mlp_dim=3072,                 # Feed-forward inner dim (4x hidden_dim)
    dropout=0.1,                  # Dropout rate
)
```

### Transformer Block

Each block contains:
1. **Layer Norm** → **Multi-Head Self-Attention** (with RoPE) + Residual
2. **Layer Norm** → **Feed-Forward Network** (GELU + Linear) + Residual

Pre-normalization (applying LayerNorm before sublayers) is used for better training stability.

### Multi-Head Attention

- **Rotary Positional Embeddings (RoPE):** Encodes position as rotation matrices, avoiding the need for explicit position embeddings. Better for long sequences and extrapolation.
- **Causal Masking:** Prevents the model from looking at future tokens during training.
- **Dropout:** Applied to attention weights for regularization.

### Training Loop

- **AdamW:** Momentum-based optimizer with weight decay (not applied to biases and norms).
- **Warmup + Cosine Annealing:** Learning rate grows linearly for 1000 steps, then decays with cosine annealing.
- **Mixed Precision (AMP):** Forward pass in FP16, loss scaling, backward in FP16, optimizer step in FP32.
- **Gradient Accumulation:** Simulates larger batch sizes without requiring more memory.
- **Gradient Clipping:** Prevents exploding gradients.

## File Structure

```
tinygpt/
├── config.py              # Model, tokenizer, training configs
├── tokenizer.py           # SentencePiece tokenizer wrapper
├── dataset.py             # Markdown and chat dataset loaders
├── model.py               # GPT architecture (Transformer blocks, attention, etc.)
├── trainer.py             # Training loop and checkpointing
├── inference.py           # Inference utilities
├── train.py               # Training script entry point
├── cli.py                 # Chat CLI interface
├── requirements.txt       # Dependencies
└── README.md              # This file
```

## Training Tips

1. **Start with CPU:** Test on a small dataset with `--device cpu` first.
2. **Monitor Validation Loss:** Best model is automatically saved when val loss improves.
3. **Adjust Batch Size:** Larger batches → faster training but more memory. Start with 16-32 and increase if you have GPU memory.
4. **Learning Rate:** Default (1e-3) works well. Reduce if loss oscillates, increase if training is slow.
5. **Context Length:** Longer context = more memory. Start with 512, increase to 1024+ as needed.
6. **Gradient Accumulation:** If OOM, increase `gradient_accumulation_steps` to simulate larger batches.

## Generation Parameters

- **temperature:** Higher = more creative/random, Lower = more deterministic. (0.7 is good default)
- **top_k:** Keep only top-k most likely next tokens. (50 is typical)
- **top_p:** Keep tokens with cumulative prob ≤ top_p. (0.9 is typical)
- **repetition_penalty:** Penalize repeated tokens. (1.0 = no penalty, >1.0 = penalize)

## Integration with Prometheus Elastic Core

Once trained, TinyGPT can be integrated into Prometheus as:

1. **Expert in Mixture of Experts (MoE):** Register as a routing-selectable expert.
2. **Embedding Layer:** Feed TinyGPT embeddings into the hyperdimensional mesh.
3. **Extension Builder:** Define TinyGPT's contract as a neuron outputting logits/probabilities.
4. **Quantization:** Apply 4-bit quantization for efficient inference on Pi-class hardware.
5. **Vale System:** Wire TinyGPT's loss into the elastic value budget.

## Performance

- **Model Size:** ~180M parameters (with config above)
- **Training Time:** ~2-4 hours per epoch on RTX 3070 (32 batch size)
- **Inference:** ~100-200 ms per token on GPU, ~1-2 sec on CPU
- **Memory:** ~8-12 GB GPU memory for batch_size=32, ~2 GB for batch_size=4

## Troubleshooting

**"CUDA out of memory":**
- Reduce `--batch-size` (e.g., 16 → 8)
- Increase `gradient_accumulation_steps` to maintain effective batch size
- Reduce `context_length` in ModelConfig
- Use `--device cpu` for testing (slow but memory-safe)

**"Loss not decreasing":**
- Check learning rate (default 1e-3 is often good)
- Increase `warmup_steps` (default 1000)
- Check data quality — remove corrupted or very short files
- Ensure vocab size matches tokenizer

**"Tokenizer not found":**
- Run pretraining first (generates tokenizer)
- Or explicitly pass `--tokenizer output/tokenizer`

## Next Steps

1. ✅ Train on your own Markdown data
2. ✅ Fine-tune on specialized chat data
3. ✅ Integrate into Prometheus Elastic Core
4. ✅ Apply 4-bit quantization for Pi-class deployment
5. ✅ Register as MoE expert with extension builder contracts

## License

Part of Prometheus Elastic Core (Zach's personal AI system).
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
