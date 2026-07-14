"""Configuration dataclasses for TinyGPT.

All hyperparameters live here so training/inference scripts stay thin and every
run is fully described by a single config object that can be saved next to a
checkpoint.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class ModelConfig:
    """Architecture of the decoder-only transformer.

    Default (~15M params with vocab_size=8000):
        token emb  : 8000 * 384                 =  3.07M
        pos  emb   : 256  * 384                 =  0.10M
        12 blocks  : 12 * (~0.59M attn + ~1.18M mlp + tiny LN) ~ 10.6M
        LM head    : weight-tied to token emb   =  0
        total      : ~14M
    Scale n_embd / n_layer up toward the 30M end for a bigger model.
    """
    vocab_size: int = 8000
    block_size: int = 256          # max context length in tokens
    n_layer: int = 12
    n_head: int = 6
    n_embd: int = 384
    dropout: float = 0.1
    bias: bool = True              # bias in Linear/LayerNorm layers
    tie_weights: bool = True       # share token embedding with the LM head
    # Mixture-of-Experts (skills). When use_moe is True, each block's MLP is
    # replaced by a sparse MoE layer of n_experts experts routed top-k.
    use_moe: bool = False
    n_experts: int = 4
    moe_top_k: int = 2
    moe_aux_weight: float = 0.01   # weight of the load-balancing auxiliary loss
    skills: Optional[list] = None  # optional expert/skill names (len == n_experts)
    # Architecture: "transformer" (default GPT) or "mesh" (the all-to-all
    # neuron mesh, §1). Mesh hyperparameters are ignored when arch is transformer.
    arch: str = "mesh"
    mesh_neurons: int = 24
    mesh_dims: int = 4             # state dimensions per neuron (dim 0 = input flag)
    mesh_input: int = 8           # number of externally-driven input neurons
    settle_ticks: int = 4         # propagation ticks per reasoning step
    vale_init: float = 0.1        # §2 initial per-neuron vale (plasticity budget)
    divergence_tolerance: float = 0.5      # §7 per-tick divergence above this is "off track"
    sustained_divergence_ticks: int = 3    # §7 consecutive off-track ticks before damping
    skill_groups: int = 1                  # §3 partition neurons into this many skill groups (1 = no routing)
    skill_top_k: int = 1                   # §3 number of skill groups active per input
    quant_enabled: bool = False            # §8 quantization-aware training (fake-quant W in forward)
    quant_bits: int = 8                    # §8 bit-width for QAT
    expert_moe: Optional[object] = None    # optional ExpertMoE module for learned routing


@dataclass
class TrainConfig:
    """Optimisation / training-loop hyperparameters (pretraining + SFT share this)."""
    # data
    data_dir: str = "data/pretrain"
    val_fraction: float = 0.02
    # io
    out_dir: str = "checkpoints"
    ckpt_name: str = "gpt.pt"
    # optimisation
    batch_size: int = 32
    grad_accum_steps: int = 4      # effective batch = batch_size * grad_accum_steps
    max_steps: int = 5000
    learning_rate: float = 3e-4
    min_learning_rate: float = 3e-5
    warmup_steps: int = 200
    lr_decay_steps: Optional[int] = None   # defaults to max_steps if None
    weight_decay: float = 0.1
    beta1: float = 0.9
    beta2: float = 0.95
    grad_clip: float = 1.0
    # regularisation / early stopping
    eval_interval: int = 250
    eval_iters: int = 100
    early_stopping_patience: int = 5       # eval rounds without val improvement
    # runtime
    device: str = "cuda"           # "cuda" | "cpu" | "mps"; auto-fallback in code
    amp: bool = True               # automatic mixed precision (fp16/bf16) on CUDA
    dtype: str = "bfloat16"        # "bfloat16" | "float16" | "float32"
    compile: bool = False          # torch.compile (PyTorch 2.x)
    seed: int = 1337
    num_workers: int = 2
    log_interval: int = 20

    def resolved_decay_steps(self) -> int:
        return self.lr_decay_steps if self.lr_decay_steps is not None else self.max_steps


@dataclass
class TokenizerConfig:
    """SentencePiece tokenizer training parameters."""
    model_prefix: str = "checkpoints/spm"
    vocab_size: int = 8000
    model_type: str = "bpe"        # "bpe" | "unigram" | "char" | "word"
    character_coverage: float = 1.0
    input_sentence_size: int = 1_000_000
    # special tokens — ids are fixed so pretraining and SFT agree
    pad_id: int = 0
    unk_id: int = 1
    bos_id: int = 2
    eos_id: int = 3
    user_token: str = "<|user|>"
    assistant_token: str = "<|assistant|>"
    system_token: str = "<|system|>"


def config_to_dict(cfg) -> dict:
    return asdict(cfg)
