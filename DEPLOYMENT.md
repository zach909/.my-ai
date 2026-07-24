# Prometheus Elastic Core — Deployment Guide

Complete guide to deploying the mesh AI system on RTX 5070 hardware with code execution, multi-desktop support, and large-scale training.

## System Requirements

- **GPU**: NVIDIA RTX 5070 or better (Blackwell/Ada/Ampere architecture)
- **RAM**: 16+ GB system RAM
- **Storage**: 50+ GB for checkpoints and corpus
- **Display**: X11 or Wayland (for multi-desktop support)
- **OS**: Linux (tested on Ubuntu 22.04+, any modern distro works)

## Quick Start (CPU Training)

For CPU testing:

```bash
cd "model && skills manager"

# 1. Train tokenizer (fast)
python train_at_scale.py --data-dir data/pretrain --vocab-size 2000 \
    --max-steps 100 --device cpu --no-amp

# 2. Chat with tiny model
python chat.py --ckpt checkpoints/gpt_final.pt --device cpu
```

## RTX 5070 Deployment

### Setup

1. **Install CUDA 12+ and cuDNN**:
   ```bash
   # For RTX 5070 (Blackwell): use CUDA 12.8+
   # Follow https://pytorch.org/get-started/locally/
   ```

2. **Create Python environment**:
   ```bash
   python3.11 -m venv .venv
   source .venv/bin/activate
   pip install -U pip setuptools wheel
   
   # Install PyTorch with CUDA support
   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
   ```

3. **Install dependencies**:
   ```bash
   cd "model && skills manager"
   pip install -r requirements.txt
   ```

4. **Prepare corpus**:
   ```bash
   mkdir -p data/pretrain
   # Add your .md, .txt, or .json files here
   # Example: large markdown files, books, documentation, code repositories
   ```

### Training at Scale

```bash
python train_at_scale.py \
    --data-dir data/pretrain \
    --vocab-size 8000 \
    --block-size 256 \
    --mesh-neurons 24 \
    --batch-size 32 \
    --grad-accum-steps 4 \
    --max-steps 50000 \
    --eval-interval 500 \
    --learning-rate 3e-4 \
    --device cuda \
    --dtype bfloat16 \
    --out-dir checkpoints
```

`--n-layer`/`--n-head`/`--n-embd` are accepted for CLI compatibility with
`pretrain.py` but currently have no effect here — `train_at_scale.py`'s
`ModelConfig(...)` call never passes them through, and `build_model()`
always constructs the mesh (`MeshLM`) sized by `--mesh-neurons` (with
`mesh_dims`/`mesh_input`/`settle_ticks` hardcoded in this script, not
exposed as flags). At the defaults above (`mesh-neurons=24`,
`vocab-size=8000`, `block-size=256`) the model built is ~785K parameters,
not the 15M/29M figures an n_layer/n_embd-based recipe would suggest —
`train_at_scale.py` prints the real, measured parameter count
(`model.num_params()`) right after building it, so check that rather than
estimating from `--n-layer`/`--n-embd`.

**Performance estimates**:
- Throughput: ~500-800 tokens/sec (depends on batch size)
- 50k steps: ~50-100 hours on RTX 5070
- Best checkpoint: automatically saved when validation loss improves

**Tuning for your hardware**:
- **Lower memory**: reduce `batch-size` to 16
- **Faster training**: increase `batch-size` to 64 (requires more VRAM)
- **Larger model**: increase `--mesh-neurons` (the actual size knob this script reads)

### Interactive Chat

After training completes:

```bash
python chat.py \
    --ckpt checkpoints/gpt_best.pt \
    --device cuda \
    --temperature 0.8 \
    --top-k 40 \
    --top-p 0.95 \
    --chat
```

`chat.py --chat` is a lightweight, single-line REPL: it keeps an in-memory
chat history for the session (never persisted to disk) and rebuilds a chat
prompt from it each turn.

- **Reset**: type `reset` to clear the in-memory history
- **Quit**: type `quit` or `exit`

It has no `ACTION:` proposals and no `memory.json` persistence — those are
`core.py` features (see "Continuous Operation & Memory" below), not `chat.py`.

## Code Execution Expert

The mesh can now analyze and execute Python code safely:

```python
from tinygpt.experts import CodeExecutionExpert

expert = CodeExecutionExpert(in_dim=32, out_dim=16)

# Safe execution (imports blocked, timeout enforced)
result = expert._safe_execute("x = sum([1, 2, 3]); print(x)")
print(result["output"])    # "6"
print(result["trace"])     # Execution behavior as vector
```

Supported in DSL:
```
code@name="analyzer"
"analyzer"@code="def factorial(n): return 1 if n <= 1 else n * factorial(n-1)"
train
```

## Multi-Desktop Support

The mesh can interact with your desktop (X11/Wayland):

```bash
python -c "
from tinygpt.system_control import SystemControlHub

hub = SystemControlHub(enable_capture=True, enable_input=False)
print('Status:', hub.status())
print('Active window:', hub.get_state()['active_window'])

# Take a screenshot
path = hub.screen.screenshot('/tmp/screenshot.png')
# Type text
hub.keyboard.type_text('Hello, world!')
# Click mouse
hub.keyboard.mouse_click(button=1)
"
```

**Requirements**:
- X11: `wmctrl`, `xdotool`, `scrot` (most distros have these)
- Wayland: limited; X11 recommended for full features

**Safety**: These calls run immediately, with no confirmation step — `SystemControlHub`'s keyboard/mouse/window/screen methods (`tinygpt/system_control.py`) are not gated by the alignment veto and have no live caller anywhere in this codebase beyond their own self-check in `test_core.py`. This is unlike `core.py`'s separate, opt-in `--enable-shell` terminal action, which always requires human confirmation before running. Treat this API as trusted-caller-only until it's wired through a real gate.

## Continuous Operation & Memory

The mesh can run continuously, maintaining state between calls:

```bash
python core.py \
    --ckpt checkpoints/gpt_best.pt \
    --candidates 5 \
    --idle-timeout 120 \
    --enable-shell
```

- **State carry**: Neuron state persists across inputs (§9)
- **Memory**: Saved to `memory.json`, reloads on restart
- **Shell actions**: Must approve each command (terminal off by default)
- **Live guidance**: Steers generation when confidence drops (on by default; disable with `--no-guide`)

## Extension Builder (Teaching New Behavior)

Teach the mesh specific behaviors:

```bash
# Batch teaching
python extend.py \
    --ckpt checkpoints/gpt_best.pt \
    --contracts data/contracts.json \
    --out checkpoints/gpt_extended.pt

# Live teaching (in core chat):
# you> teach: who are you? => I am TinyGPT, trained on your corpus.
```

Format for `contracts.json`:
```json
[
  {"when": "what is 2+2?", "then": "4"},
  {"when": "list primes up to 10", "then": "2, 3, 5, 7"}
]
```

The model trains until contracts hold, then locks them in (raises vale to freeze those neurons).

## Skill Experts & MoE

Train specialized skill experts:

```
# NeuroLang DSL
skill@name="math"
"math"@skill_learn="Factorial: n! = n*(n-1)!. Base case: 0!=1. Compute 5!."

skill@name="code"
code@name="analyzer"
"analyzer"@code="def fibonacci(n): ..."

train
```

The mesh automatically:
- Creates CodeNetExpert, SearchExpert for each skill
- Trains ExpertMoE router to select relevant experts
- Routes inputs to top-k experts during inference
- Tracks usage statistics per expert

## Monitoring & Debugging

**Training logs**:
```bash
tail -f checkpoints/training.log
```

**Mesh introspection**:
```python
from tinygpt.model import build_model
from tinygpt.config import ModelConfig

m = build_model(ModelConfig(arch="mesh"))
print(f"Parameters: {m.num_params():,}")
print(f"Skill usage: {m.skill_usage()}")
print(f"Expert usage: {m.expert_usage()}")
print(f"Quantization error: {m.quantization_error():.6f}")
print(f"Vale budget: {m.get_vale()}")
```

**Live correction diagnostics**:
```python
# After forward pass
print(f"Live corrections applied: {m._live_corrections}")
print(f"Last tick divergence: {m._last_surprise:.4f}")
```

## Production Deployment

For always-on deployment:

```bash
# Systemd service example
sudo tee /etc/systemd/system/mesh-core.service > /dev/null <<EOF
[Unit]
Description=Prometheus Elastic Core
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which python) core.py --ckpt checkpoints/gpt_best.pt --device cuda
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mesh-core
sudo systemctl start mesh-core
```

Monitor logs:
```bash
sudo journalctl -u mesh-core -f
```

## Performance Tips

- **Throughput**: Mixed precision (bfloat16) + gradient accumulation
- **Memory**: Use `mesh-neurons=16` or `--batch-size=16` if OOM
- **Latency**: Set `settle_ticks=2` for faster inference (slightly less accuracy)
- **VRAM**: Monitor with `nvidia-smi`; aim for 80%+ utilization during training

## Troubleshooting

**CUDA out of memory**:
```bash
# Reduce batch size or accumulation steps
--batch-size 16 --grad-accum-steps 2
```

**Slow training**:
- Enable mixed precision: remove `--no-amp`
- Check tokenizer is trained (if new corpus): `ls checkpoints/tokenizer.model`
- Verify GPU is being used: `nvidia-smi` (should show high utilization)

**Desktop actions not working**:
```bash
# Check for required tools
which wmctrl xdotool scrot

# If missing, install:
sudo apt install wmctrl xdotool scrot  # Ubuntu/Debian
```

**Memory not persisting**:
- Ensure `memory.json` is writable in the current directory
- Set explicit path: `--memory /path/to/persistent/storage/memory.json`

## References

- [Model architecture (mesh.py)](tinygpt/mesh.py) — all-to-all neuron network
- [Extension builder (extension_builder.py)](tinygpt/extension_builder.py) — teaching via contracts
- [Experts (experts.py)](tinygpt/experts.py) — learnable skill experts
- [System control (system_control.py)](tinygpt/system_control.py) — desktop integration
- [Root README.md](../README.md) — nine mechanisms overview

## Questions?

This is an experimental system. It learns from your corpus, not from a pre-trained model. Honesty about limitations:
- **Unproven**: The mesh hasn't been validated on large-scale benchmarks
- **Not a product**: This is research and education, not production ML
- **Your corpus matters**: Quality/size of corpus dominates model quality
- **No magic**: Like any LLM, it can hallucinate, contradict, or fail unexpectedly

Good luck, and enjoy exploring the Prometheus Elastic Core on your RTX 5070!
