"""Decoder-only GPT transformer, implemented from scratch in PyTorch.

No Hugging Face, no Lightning. Just nn.Module. The architecture follows the
GPT-2 family: learned token + positional embeddings, a stack of pre-LayerNorm
transformer blocks (causal multi-head self-attention + MLP with residuals),
a final LayerNorm, and a (optionally weight-tied) linear LM head.
"""
from __future__ import annotations

import math
from typing import Optional

import torch
import torch.nn as nn
from torch.nn import functional as F

from .config import ModelConfig
from .elastic_mesh import ElasticMeshFFN


class LayerNorm(nn.Module):
    """LayerNorm with an optional bias (nn.LayerNorm always has one)."""

    def __init__(self, ndim: int, bias: bool):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(ndim))
        self.bias = nn.Parameter(torch.zeros(ndim)) if bias else None

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return F.layer_norm(x, self.weight.shape, self.weight, self.bias, 1e-5)


class CausalSelfAttention(nn.Module):
    """Multi-head causal self-attention.

    Uses PyTorch's fused scaled_dot_product_attention (FlashAttention kernels)
    when available, and falls back to an explicit masked implementation
    otherwise, so the model runs on any PyTorch >= 1.12.
    """

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        assert cfg.n_embd % cfg.n_head == 0, "n_embd must be divisible by n_head"
        self.n_head = cfg.n_head
        self.n_embd = cfg.n_embd
        self.dropout = cfg.dropout

        # combined projection for query, key, value
        self.c_attn = nn.Linear(cfg.n_embd, 3 * cfg.n_embd, bias=cfg.bias)
        self.c_proj = nn.Linear(cfg.n_embd, cfg.n_embd, bias=cfg.bias)
        self.attn_dropout = nn.Dropout(cfg.dropout)
        self.resid_dropout = nn.Dropout(cfg.dropout)

        self.flash = hasattr(F, "scaled_dot_product_attention")
        if not self.flash:
            # causal mask (1, 1, T, T) registered as a buffer for the fallback path
            mask = torch.tril(torch.ones(cfg.block_size, cfg.block_size))
            self.register_buffer("causal_mask", mask.view(1, 1, cfg.block_size, cfg.block_size))

    def forward(self, x: torch.Tensor, past_kv=None, use_cache: bool = False):
        B, T, C = x.shape
        q, k, v = self.c_attn(x).split(self.n_embd, dim=2)
        # (B, nh, T, hd)
        head_dim = C // self.n_head
        q = q.view(B, T, self.n_head, head_dim).transpose(1, 2)
        k = k.view(B, T, self.n_head, head_dim).transpose(1, 2)
        v = v.view(B, T, self.n_head, head_dim).transpose(1, 2)

        # KV cache: prepend previously-computed keys/values so incremental
        # decoding attends to the whole context without recomputing it.
        if past_kv is not None:
            past_k, past_v = past_kv
            k = torch.cat((past_k, k), dim=2)
            v = torch.cat((past_v, v), dim=2)
        present = (k, v) if use_cache else None

        # When there is no cache we are processing a full (prefill) sequence and
        # need the causal mask; a single cached decode step (T==1) attends to all
        # cached keys with no mask, which is causal for the final position.
        causal = past_kv is None and T > 1
        if self.flash:
            y = F.scaled_dot_product_attention(
                q, k, v,
                attn_mask=None,
                dropout_p=self.dropout if self.training else 0.0,
                is_causal=causal,
            )
        else:
            att = (q @ k.transpose(-2, -1)) * (1.0 / math.sqrt(head_dim))
            if causal:
                att = att.masked_fill(self.causal_mask[:, :, :T, :T] == 0, float("-inf"))
            att = F.softmax(att, dim=-1)
            att = self.attn_dropout(att)
            y = att @ v

        y = y.transpose(1, 2).contiguous().view(B, T, C)
        y = self.resid_dropout(self.c_proj(y))
        return (y, present) if use_cache else y


class MLP(nn.Module):
    """Position-wise feed-forward network with GELU (4x expansion)."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.c_fc = nn.Linear(cfg.n_embd, 4 * cfg.n_embd, bias=cfg.bias)
        self.c_proj = nn.Linear(4 * cfg.n_embd, cfg.n_embd, bias=cfg.bias)
        self.dropout = nn.Dropout(cfg.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.dropout(self.c_proj(F.gelu(self.c_fc(x))))


class Block(nn.Module):
    """Pre-LN transformer block: x = x + attn(ln1(x)); x = x + mlp(ln2(x)).

    Section 5.2: `mlp` is either the standard 2-layer GELU MLP or the
    elastic mesh block (ModelConfig.use_elastic_mesh), swapped in as the
    only architectural difference — attention, embeddings, and everything
    outside this module are identical between the two configurations.
    """

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.ln_1 = LayerNorm(cfg.n_embd, cfg.bias)
        self.attn = CausalSelfAttention(cfg)
        self.ln_2 = LayerNorm(cfg.n_embd, cfg.bias)
        self.mlp = (
            ElasticMeshFFN(
                cfg,
                num_experts=cfg.mesh_num_experts,
                top_k=cfg.mesh_top_k,
                n_neurons=cfg.mesh_n_neurons,
                settle_steps=cfg.mesh_settle_steps,
                n_qubits=cfg.mesh_n_qubits,
            )
            if cfg.use_elastic_mesh
            else MLP(cfg)
        )

    def forward(self, x: torch.Tensor, past_kv=None, use_cache: bool = False):
        if use_cache:
            attn_out, present = self.attn(self.ln_1(x), past_kv, use_cache=True)
            x = x + attn_out
            x = x + self.mlp(self.ln_2(x))
            return x, present
        x = x + self.attn(self.ln_1(x))
        x = x + self.mlp(self.ln_2(x))
        return x


class GPT(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.cfg = cfg
        self.transformer = nn.ModuleDict(dict(
            wte=nn.Embedding(cfg.vocab_size, cfg.n_embd),
            wpe=nn.Embedding(cfg.block_size, cfg.n_embd),
            drop=nn.Dropout(cfg.dropout),
            h=nn.ModuleList([Block(cfg) for _ in range(cfg.n_layer)]),
            ln_f=LayerNorm(cfg.n_embd, cfg.bias),
        ))
        self.lm_head = nn.Linear(cfg.n_embd, cfg.vocab_size, bias=False)
        if cfg.tie_weights:
            # weight tying (Press & Wolf) — the head reuses the token embedding
            self.transformer.wte.weight = self.lm_head.weight

        self.apply(self._init_weights)
        # scaled init for residual projections (GPT-2 trick)
        for name, p in self.named_parameters():
            if name.endswith("c_proj.weight"):
                nn.init.normal_(p, mean=0.0, std=0.02 / math.sqrt(2 * cfg.n_layer))

    def _init_weights(self, module: nn.Module):
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def num_params(self, non_embedding: bool = True) -> int:
        """Total parameter count. By default excludes the (tied) position
        embedding to match the convention used when quoting model sizes."""
        n = sum(p.numel() for p in self.parameters())
        if non_embedding:
            n -= self.transformer.wpe.weight.numel()
        return n

    def forward(self, idx: torch.Tensor, targets: Optional[torch.Tensor] = None,
                past_kvs=None, use_cache: bool = False):
        B, T = idx.shape
        # position offset so cached decode steps get their true absolute position
        past_len = past_kvs[0][0].size(2) if past_kvs is not None else 0
        assert past_len + T <= self.cfg.block_size, \
            f"sequence length {past_len + T} exceeds block_size {self.cfg.block_size}"
        pos = torch.arange(past_len, past_len + T, dtype=torch.long, device=idx.device)

        tok_emb = self.transformer.wte(idx)          # (B, T, C)
        pos_emb = self.transformer.wpe(pos)          # (T, C)
        x = self.transformer.drop(tok_emb + pos_emb)

        if use_cache:
            presents = []
            for i, block in enumerate(self.transformer.h):
                past = past_kvs[i] if past_kvs is not None else None
                x, present = block(x, past, use_cache=True)
                presents.append(present)
            x = self.transformer.ln_f(x)
            logits = self.lm_head(x[:, [-1], :])
            return logits, presents

        for block in self.transformer.h:
            x = block(x)
        x = self.transformer.ln_f(x)

        if targets is not None:
            logits = self.lm_head(x)
            loss = F.cross_entropy(
                logits.view(-1, logits.size(-1)),
                targets.view(-1),
                ignore_index=-1,
            )
            return logits, loss

        # inference: only compute logits for the final position
        logits = self.lm_head(x[:, [-1], :])
        return logits, None

    def configure_optimizers(self, weight_decay: float, learning_rate: float,
                             betas: tuple[float, float], device_type: str):
        """AdamW with decay applied only to 2D+ weights (matmuls/embeddings),
        not to biases and LayerNorm gains."""
        decay, no_decay = [], []
        for p in self.parameters():
            if not p.requires_grad:
                continue
            (decay if p.dim() >= 2 else no_decay).append(p)
        groups = [
            {"params": decay, "weight_decay": weight_decay},
            {"params": no_decay, "weight_decay": 0.0},
        ]
        fused = device_type == "cuda" and "fused" in torch.optim.AdamW.__init__.__code__.co_varnames
        extra = {"fused": True} if fused else {}
        return torch.optim.AdamW(groups, lr=learning_rate, betas=betas, **extra)

    @torch.no_grad()
    def generate(self, idx: torch.Tensor, max_new_tokens: int,
                 temperature: float = 1.0, top_k: Optional[int] = None,
                 top_p: Optional[float] = None, repetition_penalty: float = 1.0,
                 eos_id: Optional[int] = None, stop_fn=None):
        """Autoregressive sampling. See tinygpt.sampling for the token-level logic.

        `stop_fn(idx)` is an optional predicate checked after each new token; when
        it returns True generation stops early (e.g. once the reply forms enough
        complete sentences), so no compute is spent past a natural stopping point.
        """
        from .sampling import sample_next_token
        block_size = self.cfg.block_size
        past_kvs = None
        for _ in range(max_new_tokens):
            if past_kvs is None:
                # prefill: process the whole (possibly truncated) prompt once
                idx_cond = idx if idx.size(1) <= block_size else idx[:, -block_size:]
                logits, past_kvs = self(idx_cond, use_cache=True)
            elif past_kvs[0][0].size(2) >= block_size:
                # context window full — re-prefill the last block_size tokens
                past_kvs = None
                idx_cond = idx[:, -block_size:]
                logits, past_kvs = self(idx_cond, use_cache=True)
            else:
                # decode: feed only the newest token, reuse cached keys/values
                logits, past_kvs = self(idx[:, -1:], past_kvs=past_kvs, use_cache=True)
            logits = logits[:, -1, :]
            next_id = sample_next_token(
                logits, idx,
                temperature=temperature, top_k=top_k, top_p=top_p,
                repetition_penalty=repetition_penalty,
            )
            idx = torch.cat((idx, next_id), dim=1)
            if eos_id is not None and (next_id == eos_id).all():
                break
            if stop_fn is not None and stop_fn(idx):
                break
        return idx
