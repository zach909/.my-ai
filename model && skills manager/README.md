# Prometheus Elastic Core — mesh AI

> **Note:** the decoder-only GPT transformer described below has been **retired**.
> The model is now the **all-to-all neuron mesh** (`tinygpt/mesh.py`, §1), which
> the same training/inference infrastructure trains unchanged (`build_model()`
> returns the mesh; `arch` defaults to `"mesh"`). See the repository root
> `README.md` for the nine mechanisms and honest limitations. The
> tokenizer / data loader / AdamW loop / sampling below all still apply; only the
> core computation block changed from attention to the mesh.

A complete, from-scratch model stack in Python + PyTorch — no Hugging Face
Transformers, no Lightning, no distributed training. It trains a small (a few
hundred K to a few M parameter) model on a local Markdown corpus and runs
locally on CPU or a single consumer GPU (e.g. an RTX 5070);
`python test_core.py` runs the full check suite with no checkpoint needed.

The elastic-mesh core is vale-gated and all-to-all with MoE expert routing;
its interference step is a *perfect classical simulation* of a small
variational quantum circuit (via PennyLane's statevector simulator). Because
the surrounding training loop never changes, the mesh and the retired
transformer baseline can be compared apples-to-apples.

## Infrastructure (applies to the mesh unchanged)

- **SentencePiece tokenizer** with training, save/load, encode/decode (BPE).
- **Markdown dataset loader** with train/validation split and packed token blocks.
- **The mesh** (retired transformer kept for reference/baseline): token +
  positional embeddings, pre-LayerNorm blocks, causal multi-head self-attention
  (fused FlashAttention when available, explicit masked fallback otherwise),
  GELU MLP, weight-tied LM head.
- **Elastic-mesh core** (`--use-elastic-mesh`): vale-gated settle dynamics,
  dense all-to-all internal connectivity, MoE expert routing, and a
  PennyLane-simulated quantum interference layer, as a drop-in for the MLP.
- **Configurable hyperparameters** via `tinygpt/config.py` and CLI flags.
- **Pretraining** with AdamW, linear-warmup + cosine LR decay, automatic mixed
  precision (on CUDA), gradient accumulation, gradient clipping, checkpoints.
- **Overfitting mitigation**: dropout, decoupled weight decay, early stopping.
- **Supervised fine-tuning** on chat JSON/JSONL with assistant-only loss masking.
- **CLI chat inference** with temperature, top-k, top-p, and repetition penalty.

## Layout

```
model && skills manager/
├── tinygpt/                # library package (the only implementation)
│   ├── config.py           # ModelConfig / TrainConfig / TokenizerConfig
│   ├── tokenizer.py        # SentencePiece wrapper (train / encode / decode)
│   ├── data.py             # pretrain stream + chat SFT dataset (loss masking)
│   ├── mesh.py             # the all-to-all neuron mesh (the model, §1)
│   ├── model.py            # build_model() — returns the mesh
│   ├── elastic_mesh.py     # Section 5.2 elastic-mesh core (quantum-simulated QIL)
│   ├── sampling.py         # temperature / top-k / top-p / repetition penalty
│   └── utils.py            # seeding, device, LR schedule, checkpoint I/O
├── train_tokenizer.py      # step 1: train the tokenizer
├── pretrain.py             # step 2: pretrain on Markdown (--use-moe / --use-elastic-mesh optional)
├── finetune.py             # step 3: supervised fine-tune on chat data
├── chat.py                 # step 4: interactive / one-shot inference (the interface)
├── core.py                 # the unified core: model + memory + veto + actions
├── test_core.py            # unified-core check suite (no checkpoint needed)
├── test_elastic_mesh.py    # smoke test for the elastic-mesh core
├── data/pretrain/          # .md corpus (build your own; see below)
├── data/sft/chat.jsonl     # chat fine-tuning data (sample included)
└── requirements.txt
```

## Install

```bash
cd "model && skills manager"
pip install -r requirements.txt
```

## Quickstart

```bash
# 0) Build a prose-heavy corpus from in-repo text (Shakespeare + War and Peace
#    test fixtures + repo docs; ~1.5M words). No external downloads.
python build_corpus.py

# 1) Train the tokenizer on the corpus
python train_tokenizer.py --data-dir data/pretrain --vocab-size 8000 \
    --model-prefix checkpoints_v2/spm

# 2) Pretrain the mesh
python pretrain.py --data-dir data/pretrain --tokenizer checkpoints_v2/spm.model \
    --n-layer 6 --n-head 6 --n-embd 384 --block-size 256 --dropout 0.1 \
    --batch-size 16 --grad-accum-steps 4 --max-steps 4000 \
    --early-stopping-patience 8 \
    --out-dir checkpoints_v2 --ckpt-name gpt_v2.pt --device cpu --no-amp

# 3) Chat with the trained binary checkpoint (the interface)
python chat.py --ckpt checkpoints_v2/gpt_v2.pt --chat --device cpu
```

The prose corpus matters far more than model size for fluency: on CPU this
~14M-param model reaches recognizable dramatic English — character speech tags
and stage directions — within ~1500 steps, where an earlier 2.2M-param model on
82K words of terse Markdown only produced disconnected keywords. A smaller/faster
smoke config (`--vocab-size 2000`, `--n-layer 4 --n-head 4 --n-embd 192
--block-size 128 --max-steps 2500`, default `checkpoints/`) still works for a
quick end-to-end check.

To exercise the elastic-mesh expert core explicitly, add `--use-elastic-mesh`
to the `pretrain.py` command (optionally `--mesh-num-experts`, `--mesh-top-k`,
`--mesh-n-neurons`, `--mesh-settle-steps`, `--mesh-n-qubits`). Everything else —
tokenizer, data loading, optimizer, schedule, checkpointing, and inference
sampling — is identical, which is the point: it isolates the model core as the
only variable when comparing configurations.

## Unified core (`core.py`)

`core.py` runs the whole thing as **one system**: the real trained model as the
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
- **Terminal / gnome control** — pass `--enable-shell` to register an
  `ACTION: terminal <command>` action (covers gnome/desktop via
  `gsettings`/`wmctrl`/`xdotool`). It is **off by default** and **always
  requires your explicit confirmation** before running anything.
- **Live guidance** (§7) — `tinygpt/live_guide.py` steers generation *while it
  runs*: when the model drifts into sustained low confidence, sampling tightens
  (lower temperature, tighter nucleus) to pull it back on track instead of
  stopping. A tolerance band means a single noisy token doesn't over-correct.
  On by default; `--no-guide` to disable.
- **Idle power-save** (the kill switch) — when there's nothing to do, the core
  releases GPU memory to save power and wakes instantly on the next input
  (`--idle-timeout`, default 120s; type `sleep` to trigger now). It only stops
  to save power when idle — never on drift.
- **Mixture-of-Experts / skills** (§1.5) — enable `--use-moe` to replace each
  block's MLP with a sparse MoE of named experts ("skills") routed top-k
  (`tinygpt/moe.py`), with a load-balancing auxiliary loss and per-skill usage
  tracking. Train with `python pretrain.py --use-moe --n-experts 8 --moe-top-k 2`.
- **Extension builder** (§4) — teach the model declarative *definishon*
  contracts (`tinygpt/extension_builder.py`): `when "X" then it must reply "Y"`,
  trained with a constraint loss plus a don't-forget weight penalty, with
  contradiction detection. Batch-teach with `extend.py`, or live in the core:
  `teach: <prompt> => <required reply>`.

Run the core's tests (no checkpoint needed) with:

```bash
python test_core.py
```

### Teaching the model new behaviour (extension builder)

```bash
# batch: teach a JSON list of contracts and save an extended model
python extend.py --ckpt checkpoints/gpt_sft.pt --contracts data/contracts.json \
    --out checkpoints/gpt_extended.pt

# live, inside the core chat:
#   you> teach: who are you? => I am TinyGPT.
# the model trains on the contract, saves, and now answers that way.
```

A contract holds when the model actually produces the required continuation
(verified by greedy generation). Contradictory contracts (same prompt, different
required replies) are detected and reported instead of looping forever.

## Checkpoints are self-describing binaries

Each `.pt` checkpoint stores the full `ModelConfig`, so `chat.py` and
`finetune.py` reconstruct the exact architecture (mesh, MoE, or elastic-mesh
configuration) automatically — you only pass the `.pt` path.

## Vendored local runtime

Alongside the Python stack, this directory vendors the Ollama runtime (the Go
tree: `main.go`, `llama/`, `server/`, …) as an optional local inference backend
for pre-quantized GGUF models. It is upstream code — see its `docs/` folder for
usage; it is not part of the mesh implementation.

## Notes

- Use `--device cpu --no-amp` on CPU; `--device cuda --dtype bfloat16` on a
  recent GPU.
- A small model produces fluent, on-topic text after enough training, not
  factual accuracy or reasoning at the level of large models. This is an
  educational / research implementation.
- The elastic-mesh core is experimental and unproven — it is meant to be tested
  against the standard transformer baseline, not assumed superior to it.
