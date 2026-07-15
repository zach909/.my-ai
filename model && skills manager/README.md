# Prometheus Elastic Core — mesh AI (model & skills manager)

> **Note:** the decoder-only GPT transformer described in earlier revisions has
> been **retired**. The model is now the **all-to-all neuron mesh**
> (`tinygpt/mesh.py`, §1), which the same training/inference infrastructure
> trains unchanged (`build_model()` returns the mesh; `arch` defaults to
> `"mesh"`). See the repository root `README.md` for the nine mechanisms and
> honest limitations. The tokenizer / data loader / AdamW loop / sampling all
> still apply; only the core computation block changed from attention to the
> mesh.

No Hugging Face Transformers, no Lightning, no distributed training, no
external APIs. Runs locally on CPU or a single consumer GPU (e.g. an RTX 5070);
`python test_core.py` runs 105 checks with no checkpoint needed.

## Infrastructure (applies to the mesh unchanged)

- **SentencePiece tokenizer** with training, save/load, encode/decode (BPE).
- **Markdown dataset loader** with train/validation split and packed token blocks.
- **The mesh core** (`tinygpt/mesh.py`): true all-to-all connectivity where each
  connection is a D×D weight block, settle-to-convergence recurrence, a
  vale-gated plasticity budget (§2), skill-group routing (§3), and optional
  quantization-aware training (§8) — with a weight-tied readout head.
- **Elastic-mesh drop-in core** (`tinygpt/elastic_mesh.py`, `--use-elastic-mesh`):
  the Section 5.2 comparison block — vale-gated settle dynamics, dense
  all-to-all internal connectivity, MoE expert routing, and a PennyLane-simulated
  quantum interference layer.
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
│   ├── mesh.py             # MeshLM — the all-to-all neuron mesh (§1)
│   ├── model.py            # build_model(): constructs the mesh from a config
│   ├── elastic_mesh.py     # Section 5.2 drop-in core (quantum-simulated QIL)
│   ├── experts.py          # code-to-net + net-search skill experts (MoE)
│   ├── moe.py              # sparse Mixture-of-Experts layer ("skills")
│   ├── interference.py     # §5 answer selection by quantum interference
│   ├── empathy.py          # user mood + remembered preferences -> sampling
│   ├── rl.py               # RL: reasoning ledger + REINFORCE over candidates
│   ├── extension_builder.py# §4 definishon contracts; save vs quantized install
│   ├── memory.py           # §9 zip-loop ring-buffer memory (zlib-compressed)
│   ├── continuous.py       # §9 continuous operation / carried neuron state
│   ├── selection.py        # predict-before-commit best-of-N
│   ├── veto.py             # alignment veto (fails safe)
│   ├── actions.py          # human-in-the-loop action layer (gated terminal)
│   ├── live_guide.py       # §7 live correction while generating
│   ├── infer.py            # Generator + load_generator (checkpoint -> chat)
│   ├── sampling.py         # temperature / top-k / top-p / repetition penalty
│   └── utils.py            # seeding, device, LR schedule, checkpoint I/O
├── main.py                 # unified entry point: build / chat / test
├── build_corpus.py         # step 0: build a prose corpus from in-repo text
├── train_tokenizer.py      # step 1: train the tokenizer
├── pretrain.py             # step 2: pretrain the mesh on Markdown
├── finetune.py             # step 3: supervised fine-tune on chat data
├── chat.py                 # step 4: interactive / one-shot inference
├── core.py                 # the unified core (memory, veto, actions, guidance)
├── extend.py               # batch-teach definishon contracts
├── neurolang.py            # NeuroLang DSL -> trainable mesh (extension builder)
├── example_experts.nl      # sample NeuroLang program (code@/netsearch@ experts)
├── test_core.py            # 66 checks, no checkpoint needed
├── test_elastic_mesh.py    # smoke test for the Section 5.2 core
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

# 2) Pretrain the mesh (arch defaults to "mesh")
python pretrain.py --data-dir data/pretrain --tokenizer checkpoints_v2/spm.model \
    --mesh-neurons 24 --mesh-dims 4 --settle-ticks 4 --block-size 256 \
    --batch-size 16 --grad-accum-steps 4 --max-steps 4000 \
    --early-stopping-patience 8 \
    --out-dir checkpoints_v2 --ckpt-name gpt_v2.pt --device cpu --no-amp

# 3) Chat with the trained binary checkpoint (the interface)
python chat.py --ckpt checkpoints_v2/gpt_v2.pt --chat --device cpu
```

The prose corpus matters far more than model size for fluency. A smaller/faster
smoke config (`--vocab-size 2000 --block-size 128 --max-steps 2500`, default
`checkpoints/`) still works for a quick end-to-end check.

To train the experimental Section 5.2 elastic-mesh drop-in core instead, add
`--use-elastic-mesh` to the `pretrain.py` command (optionally
`--mesh-num-experts`, `--mesh-top-k`, `--mesh-n-neurons`, `--mesh-settle-steps`,
`--mesh-n-qubits`). Everything else — tokenizer, data loading, optimizer,
schedule, checkpointing, and inference sampling — is identical, which is the
point: it isolates the model core as the only variable when comparing the two.

## Unified core (`core.py`)

`core.py` runs the whole thing as **one system**: the trained mesh as the
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
- **Mixture-of-Experts / skills** (§1.5) — enable `--use-moe` to route through
  a sparse MoE of named experts ("skills") top-k (`tinygpt/moe.py`), with a
  load-balancing auxiliary loss and per-skill usage tracking. Train with
  `python pretrain.py --use-moe --n-experts 8 --moe-top-k 2`.
- **Extension builder** (§4) — teach the model declarative *definishon*
  contracts (`tinygpt/extension_builder.py`): `when "X" then it must reply "Y"`,
  trained with a constraint loss plus a don't-forget weight penalty, with
  contradiction detection. Batch-teach with `extend.py`, or live in the core:
  `teach: <prompt> => <required reply>`. Projects **save** at full precision
  (`save_project`, editable) and **install** with automatic int8 quantization
  (`install` — the design notes' quantize-before-installation).
- **Empathy engine** — `tinygpt/empathy.py` reads each user turn's emotional
  state (valence/arousal/dominance), remembers stated preferences ("keep it
  short") and adapts sampling so alignment doesn't need repeated instructions.
  Type `mood` in the core chat for the current read; `--no-empathy` disables.
- **Reinforcement learning** — `tinygpt/rl.py`: a persistent `ReasoningLedger`
  records completed reasoning steps so candidates that merely repeat them are
  scored down before committing (`--no-ledger` disables), and `reinforce_step`
  runs a genuine REINFORCE update toward above-baseline candidates.
- **§5 interference selection** — every mesh neuron carries a unique wave
  signature; `--select interference` commits the reply by phase consensus over
  each candidate's settled-state phase, then Born-rule collapse
  (`tinygpt/selection.select_by_interference`).
- **Neuron inspection** (extension-builder tools) — `simulate: <id>` drives an
  individual neuron and reports its output amplitude, wave signature, and the
  neurons it influenced (`MeshLM.simulate_neuron`); `neurons: <text>` searches
  the mesh for the neurons a given input most recruits (`MeshLM.search_neurons`).
- **Compressed circular I/O** (§9) — `ContinuousRunner` runs input and output as
  two bounded ring buffers (oldest overwritten at capacity), so the mesh keeps
  operating continuously without unbounded growth (`tinygpt/continuous.py`).
- **Neural language refinement** — NeuroLang definitions are connected by both
  thesaurus relationships and dictionary meanings, so semantically related
  neurons wire together automatically (`neurolang.py`).

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
`finetune.py` reconstruct the exact architecture (mesh *or* the Section 5.2
elastic-mesh drop-in) automatically — you only pass the `.pt` path.

## The surrounding Go tree (the model & skills manager)

The Go / llama.cpp code in this directory is a vendored, locally-run model
manager derived from [Ollama](https://github.com/ollama/ollama) (MIT licensed;
see `LICENSE`). It serves and manages local model binaries — no external APIs
are required at inference time. Build it with `cmake -B build . && cmake
--build build` or `go build .` (see `AGENTS.md` and `docs/development.md`).
The Python mesh AI above is independent of it: the mesh trains and chats with
nothing but `requirements.txt`.

## Notes

- Use `--device cpu --no-amp` on CPU; `--device cuda --dtype bfloat16` on a
  recent GPU.
- A small model produces fluent, on-topic text after enough training, not
  factual accuracy or reasoning at the level of large models. This is an
  educational / research implementation.
- The mesh is experimental and unproven — it is meant to be tested against a
  standard transformer baseline, not assumed superior to it.
