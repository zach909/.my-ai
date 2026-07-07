# TinyGPT → Prometheus Integration Guide

## Overview

TinyGPT is integrated into Prometheus Elastic Core as a **learned expert** that:

1. **Registers as MoE Skill** — Router selects TinyGPT when language generation needed
2. **Feeds Hyperdimensional Mesh** — Quantized embeddings become mesh neuron states
3. **Extension Builder Contracts** — Verifiable neuron-level unit tests (interpretability)
4. **Vale System Wiring** — Elastic value budgets lock satisfied neurons
5. **QAT Loop** — Quantization-aware training with error feedback
6. **Ring Buffer Compression** — Continuous state cycling with disk snapshots
7. **Live Correction** — Self-model monitors during execution, intervenes on divergence

---

## File Structure

```
tinygpt/
├── config.py                    # Model, tokenizer, training configs
├── tokenizer.py                 # SentencePiece tokenizer
├── dataset.py                   # Markdown + chat dataset loaders
├── model.py                     # GPT Transformer architecture
├── trainer.py                   # Training loop (AdamW, AMP, etc.)
├── inference.py                 # Inference utilities
├── train.py                     # Training entry point
├── cli.py                       # Chat CLI interface
│
├── prometheus_integration.py     # ← INTEGRATION LAYER
│   ├── TinyGPTExpertContract    # Extension builder contracts
│   ├── QuantizationAwareTraining # QAT + error feedback (Section 6)
│   ├── MeshContextEmbedding      # Project to mesh space (Section 7-8)
│   ├── ValeAwareLearning        # Elastic value budgeting (Section 1)
│   ├── LiveCorrectionMonitor    # Self-model + divergence detection (Section 12)
│   └── TinyGPTExpert            # Full MoE expert wrapper
│
├── compression_codec.py         # ← PERSISTENCE LAYER
│   ├── LearnedCompressionCodec  # Semantic compression (not ZIP)
│   ├── RingBufferWithCheckpoint # Zip I/O loop + snapshots (Section 2)
│   └── DualNumberDifferentiator # Value + derivative encoding (Section 13)
│
├── prometheus_integration.py    # Main integration module
├── INTEGRATION_GUIDE.md         # This file
└── requirements.txt
```

---

## Architecture Mapping

### Section 1: Vale/Value-Budget System

**File:** `prometheus_integration.py::ValeAwareLearning`

Wires vale into the learning loop:

```python
vale_learning = ValeAwareLearning(num_neurons=64)

# Compute per-neuron learning rates (high vale = less plastic)
adaptive_lr = vale_learning.compute_adaptive_learning_rates()

# Lock neurons when contracts verified
satisfied = expert.verify_contract(output)
vale_learning.update_vale_from_contracts(satisfied)
```

**Mechanism:**
- Each neuron has a vale value (0 = plastic, 1 = locked)
- High-vale neurons get lower learning rates (change less)
- When extension builder contract is satisfied → raise vale (lock it)
- When contract fails → lower vale (unlock for learning)
- Result: "Learn but don't forget" emerges naturally

### Section 2: Zip I/O Loop — Continuous State

**File:** `compression_codec.py::RingBufferWithCheckpoint`

Continuous ring buffer with periodic snapshots:

```python
ring_buffer = RingBufferWithCheckpoint(
    buffer_size=50_000,
    checkpoint_interval=5_000,
)

# Write new state (cycles, overwrites oldest)
ring_buffer.write(mesh_state)

# Read recent context for mesh input
context = ring_buffer.get_context_window(context_size=1024)

# Periodic snapshots for long-term persistence
ring_buffer.save_checkpoint()  # Auto-called every 5K iterations
ring_buffer.load_checkpoint(path)  # Restore on reboot
```

**Mechanism:**
- Ring buffer cycles (1, 0, 1, 0...) as new input arrives
- Old content falls off when buffer full (50K chunks)
- Every 5K iterations, snapshot to disk for persistence beyond buffer
- On restart, reload latest checkpoint to restore state

### Section 3: Alignment — Idealized-User Model (CEV)

**File:** `prometheus_integration.py::TinyGPTExpertContract`

Define extension builder contracts:

```python
contract = TinyGPTExpertContract(
    name="language_generation",
    exclusive_inputs=["user_query", "context_buffer"],
    expected_outputs={
        "logits": "float32[vocab_size]",
        "embeddings": "float32[hidden_dim]",
        "attention_weights": "float32[num_heads, seq_len, seq_len]",
    },
    assertions=[
        "logits.sum(dim=-1) ≈ 1.0 (probability distribution)",
        "embeddings.norm() ∈ [0.5, 2.0] (normalized state)",
        "attention_weights.sum(dim=-1) ≈ 1.0 per head",
    ]
)
```

**Veto mechanism:**
- User requests "simulate happiness for the user" → Check against idealized user model
- If CEV rejects ("real problem-solving is better") → Block action
- Veto is conservative, fails safe (never accepts shortcuts the idealized user would reject)

### Section 4: Extension Builder — Declarative Neural Programming

**File:** `prometheus_integration.py::TinyGPTExpert.verify_contract()`

Neuron-level unit testing:

```python
# Forward pass
output = expert.forward(user_query, context)

# Verify contract (exclusive-input → settled-state → check output)
satisfied = expert.verify_contract(output)
# Returns binary mask: which neurons satisfy their contracts?

# Contradictory definitions detected by anti-correlated loss
if loss_1 > threshold and loss_2 > threshold and corr(grad_1, grad_2) < 0:
    print("Conflicting contracts detected!")

# Underdetermined: regularize toward smallest weights
loss = main_loss + 0.01 * model.parameters().norm()
```

### Section 5: Hyperdimensional Self-Reading — Input-Source Awareness

**File:** `prometheus_integration.py::MeshContextEmbedding.forward()`

Reserved input-flag dimension per neuron:

```python
mesh_states, input_flags = embedding_layer(
    tinygpt_embeddings,
    is_external_input=True,  # This tick externally driven?
)

# input_flags: [batch, num_neurons]
# 1.0 = neuron is externally driven this tick
# 0.0 = neuron state is mesh-echo (internal)
# Propagates through mesh → every neuron sees full input topography

# Formalizes "exclusive input":
exclusive = (input_flags.sum(dim=1) == 1)  # Exactly one neuron is external
```

### Section 6: Quantization — Native Internal Language

**File:** `compression_codec.py::LearnedCompressionCodec`

Quantization-Aware Training (QAT) + error feedback:

```python
qat = QuantizationAwareTraining(num_bits=4)

# Forward pass: quantize inside training loop
quantized, error = qat(logits, return_error=True)

# Error feedback: feed quantization error back to neurons
# (full_precision - quantized) fed into next-tick input
contributing_neurons.receive(error)

# Network learns to think in compressed representation from start
# (not post-hoc lossy quantization that changes outputs)
```

### Section 7-8: Whole-Network Context & Per-Connection Weights

**File:** `prometheus_integration.py::MeshContextEmbedding`

Project TinyGPT embeddings to mesh state matrix:

```python
# Per-connection: D×D weight blocks (D=hidden_dim)
# Full network: N×N×D×D tensor
# Computation: S ← activate(W @ S) repeated to convergence

mesh_states, input_flags = embedding_layer(
    tinygpt_embeddings,  # [batch, seq_len, hidden_dim]
)
# Result: [batch, num_neurons, mesh_hidden_dim]

# Vectorized tensor ops, not scalar weights
# Bounded density for Pi-class (diagonal-plus-few cross-terms)
```

### Section 9: Symbolic State — On-Demand Tracing

**Roadmap:** Add `SymbolicTracer` class

```python
# Not implemented yet, but hook ready:
# Walk backward through attention/feedforward weights
# Format as algebra on demand (user asks: "why did you generate X?")
# Uses autograd graph as substrate (already present)
```

### Section 10: Meta-Awareness — Approximate Self-Model

**File:** `prometheus_integration.py::LiveCorrectionMonitor`

Compressed self-model for drift detection:

```python
correction_monitor = LiveCorrectionMonitor(num_neurons=64, hidden_dim=256)

# Predict next state (cheap, approximate)
predicted = correction_monitor.predict_next_state(current_state)

# Compare to actual
sustained, magnitude = correction_monitor.detect_divergence(predicted, actual)

# Signal: |predicted - actual| → feeds to noveltyDecay field
if sustained:
    correction_signal = correction_monitor.compute_correction_signal(
        predicted, actual
    )
```

**Why approximate?**
- Exact self-model costs as much as network itself (duplication)
- Exact self-prediction that's part of own computation → infinite regress (Löb's theorem)
- Approximate gap (surprise) is the meta-awareness signal
- Fails safe: approximate can't become arbitrarily good without data feedback

### Section 11: Predict-Before-Commit — Multi-Candidate Selection

**Roadmap:** Hook into RLMTrainer.selectAction()

```python
# Current: thinkingSteps are logged as trace
# Needed: Score each step, commit only best

thinking_steps = rlm.generate_candidates(num=5)
scores = [simulator.evaluate(step) for step in thinking_steps]
best_idx = argmax(scores)
action = thinking_steps[best_idx]
commit(action)
```

### Section 12: Live Correction — Mid-Flight Intervention

**File:** `prometheus_integration.py::LiveCorrectionMonitor`

Tolerance band to avoid noise-triggered false corrections:

```python
# Per-tick divergence check
for tick in range(num_ticks):
    predicted = self_model.predict(state)
    actual = mesh.propagate_one_tick()
    
    sustained, mag = correction_monitor.detect_divergence(
        predicted, actual
    )
    
    if sustained:  # Sustained across ≥3 ticks, not noise
        signal = correction_monitor.compute_correction_signal(
            predicted, actual
        )
        mesh.apply_correction(signal)
        break  # Re-route trajectory
```

### Section 13: Multiple Number Systems — Division Algebras

**File:** `compression_codec.py::DualNumberDifferentiator`

Dual numbers for value + derivative encoding:

```python
differentiator = DualNumberDifferentiator(input_dim=768, hidden_dim=256)

# Single forward pass yields both f and f' (value and derivative)
value, derivative = differentiator(x)

# Used in self-model / live correction:
# Predicted state includes rate of change → detect drift faster
# No separate derivative computation needed

# Complex numbers (future): phase + height for QIL
# Quaternions (future): spatial orientation for multi-desktop coordination
```

---

## Usage Example

### 1. Train TinyGPT

```bash
cd tinygpt
python train.py \
  --mode pretrain \
  --data-dir data \
  --output-dir output \
  --epochs 3
```

### 2. Register as Prometheus Expert

```python
from tinygpt.prometheus_integration import TinyGPTExpert
from pathlib import Path

expert = TinyGPTExpert(
    model_checkpoint=Path("output/final_model.pt"),
    tokenizer_checkpoint=Path("output/tokenizer"),
    mesh_config={
        "hidden_dim": 256,
        "num_neurons": 64,
    },
    device="cuda",
)

# Register in Prometheus MoE router
router.register_expert("language_generation", expert)
```

### 3. Use in Mesh

```python
# User query arrives
user_query = "What is machine learning?"

# MoE router selects TinyGPT expert
output = expert.forward(user_query, context_buffer)

# Verify contracts (neuron-level unit testing)
satisfied = expert.verify_contract(output)

# Update vale (lock satisfied neurons)
vale_learning.update_vale_from_contracts(satisfied)

# Project to mesh states
mesh_states = output["mesh_states"]  # [batch, 64, 256]
input_flags = output["input_flags"]  # [batch, 64] binary

# Feed into hyperdimensional mesh
mesh.inject_states(mesh_states, input_flags)

# Monitor for divergence during execution
predicted = correction_monitor.predict_next_state(current)
actual = mesh.tick()  # One propagation cycle
sustained, mag = correction_monitor.detect_divergence(predicted, actual)
if sustained:
    mesh.apply_correction(correction_monitor.compute_correction_signal(
        predicted, actual
    ))

# Periodic checkpoint for ring buffer persistence
ring_buffer.write(mesh.current_state)
if iteration % checkpoint_interval == 0:
    ring_buffer.save_checkpoint()
```

---

## Next Steps

1. ✅ Complete TinyGPT implementation (DONE)
2. ✅ Integration layer (DONE)
3. **↓ Wire into Prometheus main codebase**
   - Connect to `plugins/index.ts` (MoE router)
   - Replace `pipeline.ts` vale/mesh with integration layer
   - Fix TypeScript build errors
4. Fix Prometheus audit findings (from architecture notes):
   - Mesh density: 0.3 → 1.0 (all-to-all)
   - QIL initialization: 0 → random phases
   - Ring buffer: implement Zip I/O cycling
5. Register plugins as real MoE experts
6. Collapse Python/TS duplication via server.py bridge

---

## Testing

```python
# Unit test: Contract verification
def test_tinygpt_contract():
    expert = TinyGPTExpert(...)
    output = expert.forward("test query", [])
    satisfied = expert.verify_contract(output)
    assert satisfied.all(), "All neurons should satisfy contracts"

# Integration test: Vale locking
def test_vale_learning():
    vale_learning = ValeAwareLearning(num_neurons=64)
    initial_vale = vale_learning.vale.clone()
    
    # Verify contracts
    satisfied = torch.ones(64, dtype=torch.bool)
    vale_learning.update_vale_from_contracts(satisfied)
    
    # High-vale neurons should increase
    assert (vale_learning.vale > initial_vale).any()

# Ring buffer test: Cyclic write/read
def test_ring_buffer():
    ring_buffer = RingBufferWithCheckpoint(buffer_size=100)
    states = torch.randn(150, 256)  # More than buffer size
    
    for state in states:
        ring_buffer.write(state)
    
    # Oldest states should be overwritten
    recent = ring_buffer.read(50)
    assert recent.shape == (50, 256)
```

---

## References

- **Section references:** Prometheus Elastic Core architecture notes (Sections 1-13)
- **Hurwitz theorem:** Only 1, 2, 4, 8-dimensional division algebras exist
- **CEV:** Coherent Extrapolated Volition (Yudkowsky, 2004)
- **Löb's theorem:** Exact self-prediction leads to infinite regress
- **QAT:** Quantization-Aware Training (Jacob et al., 2018)
