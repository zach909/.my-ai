"""Extension builder (Prometheus section 4) for TinyGPT — declarative training.

A "definishon" is a behavioural contract on the model:

    when "<prompt>"  then the model must continue with  "<required text>"

Training satisfies every contract by a constraint loss (cross-entropy of the
required continuation given the prompt) plus a *don't-forget* weight penalty —
the L2 distance from the model's weights before teaching, so satisfying new
contracts doesn't wipe out what pretraining learned (the notes' "learn but don't
forget"). Contradictory contracts (same/similar prompt, different required
output, or losses that trade off against each other) are detected and reported
so training doesn't loop forever chasing an impossible set.

This is the faithful transformer analog of the mesh's clamp->settle->check
neuron contracts: here the "settled read" is the model's greedy continuation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import torch
from torch.nn import functional as F


@dataclass
class Definishon:
    when: str
    then: str
    satisfied: bool = False
    final_loss: float = float("inf")


@dataclass
class TrainResult:
    converged: bool
    epochs: int
    satisfied: List[int]
    conflicts: List[Tuple[int, int, float]]   # (i, j, correlation)
    losses: List[float]                       # total loss per epoch


class ExtensionBuilder:
    def __init__(self, model, tokenizer, device: str = "cpu"):
        self.model = model
        self.tok = tokenizer
        self.device = device

    # ---- encoding ---------------------------------------------------------
    def _encode_contract(self, defn: Definishon) -> Tuple[torch.Tensor, torch.Tensor]:
        """Return (input_ids, targets) where targets are -1 on the prompt and the
        real token ids on the required continuation (loss only on the answer)."""
        when_ids = [self.tok.bos_id] + self.tok.encode(defn.when)
        then_ids = self.tok.encode(defn.then) + [self.tok.eos_id]
        ids = when_ids + then_ids
        ids = ids[: self.model.cfg.block_size + 1]
        x = torch.tensor(ids[:-1], dtype=torch.long, device=self.device)
        y = torch.full((len(ids) - 1,), -1, dtype=torch.long, device=self.device)
        # targets align to next-token: positions predicting the `then` tokens
        start = len(when_ids) - 1
        for i in range(start, len(ids) - 1):
            y[i] = ids[i + 1]
        return x.unsqueeze(0), y.unsqueeze(0)

    def _contract_loss(self, defn: Definishon) -> torch.Tensor:
        x, y = self._encode_contract(defn)
        _, loss = self.model(x, y)
        return loss

    @torch.no_grad()
    def is_satisfied(self, defn: Definishon, tolerance: float = 0.5) -> bool:
        """Satisfied iff the constraint loss is below tolerance (the model
        confidently produces the required continuation)."""
        was_training = self.model.training
        self.model.eval()
        loss = self._contract_loss(defn).item()
        if was_training:
            self.model.train()
        defn.final_loss = loss
        return loss < tolerance

    # ---- training ---------------------------------------------------------
    def train(self, contracts: List[Definishon], epochs: int = 200, lr: float = 1e-4,
              weight_penalty: float = 1e-3, tolerance: float = 0.5,
              freeze_when_satisfied: bool = True, verbose: bool = False) -> TrainResult:
        if not contracts:
            return TrainResult(True, 0, [], [], [])

        # structural conflict: identical prompt, different required output
        structural: List[Tuple[int, int, float]] = []
        for i in range(len(contracts)):
            for j in range(i + 1, len(contracts)):
                if contracts[i].when.strip() == contracts[j].when.strip() \
                        and contracts[i].then.strip() != contracts[j].then.strip():
                    structural.append((i, j, -1.0))

        # snapshot of pretrained weights for the don't-forget penalty
        anchor = {n: p.detach().clone() for n, p in self.model.named_parameters()}
        optimizer = torch.optim.AdamW(self.model.parameters(), lr=lr)

        self.model.train()
        loss_history: List[List[float]] = [[] for _ in contracts]
        total_history: List[float] = []
        ran = 0

        for epoch in range(epochs):
            ran = epoch + 1
            optimizer.zero_grad(set_to_none=True)

            per_contract = []
            active_losses = []
            for k, defn in enumerate(contracts):
                loss_k = self._contract_loss(defn)
                per_contract.append(loss_k.item())
                # once satisfied, optionally stop pushing it (freeze/lock, low weight)
                if not (freeze_when_satisfied and defn.satisfied):
                    active_losses.append(loss_k)

            constraint_loss = (torch.stack(active_losses).mean()
                               if active_losses else torch.zeros((), device=self.device))

            # don't-forget penalty: L2 distance from the pretrained weights
            penalty = torch.zeros((), device=self.device)
            for n, p in self.model.named_parameters():
                penalty = penalty + ((p - anchor[n]) ** 2).sum()
            total = constraint_loss + weight_penalty * penalty

            if active_losses:
                total.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                optimizer.step()

            for k in range(len(contracts)):
                loss_history[k].append(per_contract[k])
            total_history.append(float(total.item()))

            # update satisfaction flags
            for defn in contracts:
                defn.satisfied = self.is_satisfied(defn, tolerance)
                self.model.train()

            if verbose and epoch % max(1, epochs // 10) == 0:
                n_sat = sum(d.satisfied for d in contracts)
                print(f"  epoch {epoch:4d} | total {total.item():.4f} | satisfied {n_sat}/{len(contracts)}")

            if all(d.satisfied for d in contracts):
                break

        satisfied = [i for i, d in enumerate(contracts) if d.satisfied]

        # behavioural conflict: unsatisfied pairs whose loss trajectories are
        # strongly anti-correlated (pushing one down pushed the other up).
        conflicts = list(structural)
        for i in range(len(contracts)):
            for j in range(i + 1, len(contracts)):
                if contracts[i].satisfied and contracts[j].satisfied:
                    continue
                corr = _correlation(_deltas(loss_history[i]), _deltas(loss_history[j]))
                if corr < -0.5 and (i, j, -1.0) not in structural:
                    conflicts.append((i, j, corr))

        converged = len(satisfied) == len(contracts)
        return TrainResult(converged, ran, satisfied, conflicts, total_history)

    # ---- neuron inspection (Extension Builder tools) -----------------------
    def simulate_neuron(self, neuron_id: int, amplitude: float = 1.0):
        """Extension Builder "simulate the output produced by an individual
        neuron": drive one neuron and report what it produces / influences."""
        return self.model.simulate_neuron(neuron_id, amplitude=amplitude)

    def search_neurons(self, text: str, top_k: int = 5):
        """Extension Builder "search neurons within large models": return the
        neurons a given input most strongly recruits."""
        import torch
        ids = self.tok.encode(text) if hasattr(self.tok, "encode") else list(text)
        if not ids:
            return []
        return self.model.search_neurons(
            torch.tensor(ids, dtype=torch.long, device=self.device), top_k=top_k)

    # ---- projects: save (no quantization) vs install (quantized) -----------
    # Design notes: "Save projects without quantization. Install projects
    # using quantization." — saving keeps exact weights for further editing;
    # installing is deployment, so the extension is automatically quantized
    # first (faster to load, ~4x smaller, cheaper to keep resident).

    def _project_payload(self, contracts: Optional[List[Definishon]] = None) -> dict:
        from .config import config_to_dict
        return {
            "model_config": config_to_dict(self.model.cfg),
            "contracts": [{"when": c.when, "then": c.then, "satisfied": c.satisfied}
                          for c in (contracts or [])],
        }

    def save_project(self, path: str, contracts: Optional[List[Definishon]] = None) -> str:
        """Save the extension project at full precision (editable, exact)."""
        payload = self._project_payload(contracts)
        payload.update(format="ext-project", quantized=False,
                       model=self.model.state_dict())
        _atomic_torch_save(payload, path)
        return path

    def install(self, path: str, contracts: Optional[List[Definishon]] = None,
                bits: int = 8) -> str:
        """Install the extension: automatically quantize, then write."""
        payload = self._project_payload(contracts)
        payload.update(format="ext-install", quantized=True, bits=bits,
                       model=quantize_state_dict(self.model.state_dict(), bits=bits))
        _atomic_torch_save(payload, path)
        return path


@dataclass
class Endpoint:
    """A local, API-shaped output endpoint (no external services). `handler`
    takes the structured payload and returns a result string."""
    name: str
    handler: object                       # Callable[[dict], str]
    capabilities: List[str] = field(default_factory=list)
    reversible: bool = True
    external_effect: bool = False


@dataclass
class OutputCall:
    endpoint: str
    payload: dict
    ok: bool = False
    output: str = ""
    reason: str = ""


class OutputLayer:
    """Extension Builder: "create output layers capable of API communication".

    An output layer turns mesh neuron activations into structured, API-shaped
    calls to named LOCAL endpoints, each gated by the alignment veto — so a
    trained mesh can *act* through a clean call interface without any external
    API. Bind a neuron to an endpoint; when that neuron's settled amplitude
    crosses its threshold, the layer emits `{endpoint, payload}` and (if the
    veto allows) runs the local handler.
    """

    def __init__(self, model, veto=None):
        self.model = model
        self.endpoints: Dict[str, Endpoint] = {}
        self.bindings: List[tuple] = []       # (neuron_id, endpoint_name, threshold)
        if veto is None:
            from .veto import AlignmentVeto
            veto = AlignmentVeto()
        self.veto = veto

    def add_endpoint(self, name: str, handler, capabilities: Optional[List[str]] = None,
                     reversible: bool = True, external_effect: bool = False) -> "OutputLayer":
        self.endpoints[name] = Endpoint(name, handler, capabilities or [], reversible,
                                        external_effect)
        return self

    def bind(self, neuron_id: int, endpoint: str, threshold: float = 0.5) -> "OutputLayer":
        if endpoint not in self.endpoints:
            raise KeyError(f"no endpoint {endpoint!r}")
        self.bindings.append((neuron_id, endpoint, threshold))
        return self

    def call(self, endpoint: str, payload: Optional[dict] = None) -> OutputCall:
        """Invoke one endpoint through the veto (the API-communication path)."""
        from .veto import ProposedAction
        ep = self.endpoints.get(endpoint)
        if ep is None:
            return OutputCall(endpoint, payload or {}, ok=False, reason="unknown endpoint")
        decision = self.veto.evaluate(ProposedAction(
            id=endpoint, name=endpoint, capabilities=ep.capabilities,
            reversible=ep.reversible, external_effect=ep.external_effect))
        if not decision.allowed:
            return OutputCall(endpoint, payload or {}, ok=False,
                              reason="vetoed: " + "; ".join(decision.reasons))
        try:
            out = ep.handler(payload or {})
            return OutputCall(endpoint, payload or {}, ok=True, output=str(out))
        except Exception as e:
            return OutputCall(endpoint, payload or {}, ok=False, reason=str(e))

    def emit(self, threshold_scale: float = 1.0) -> List[OutputCall]:
        """Read the mesh's last settled per-neuron amplitudes and fire every
        binding whose neuron is above threshold, as structured calls."""
        waves = {i: a for i, _, a in self.model.neuron_waves()}
        calls: List[OutputCall] = []
        for neuron_id, endpoint, threshold in self.bindings:
            amp = waves.get(neuron_id, 0.0)
            if amp >= threshold * threshold_scale:
                calls.append(self.call(endpoint, {"neuron": neuron_id, "amplitude": amp}))
        return calls


def quantize_state_dict(sd: Dict[str, torch.Tensor], bits: int = 8) -> Dict[str, dict]:
    """Symmetric per-tensor affine quantization of every float tensor.

    Each entry becomes {"q": int8 tensor, "scale": float} (or {"raw": tensor}
    for non-float tensors, kept exact). Matches the mesh's §8 fake-quant
    grid, so a QAT-trained mesh loses almost nothing on install."""
    qmax = 2 ** (bits - 1) - 1
    out: Dict[str, dict] = {}
    for name, t in sd.items():
        if not torch.is_floating_point(t):
            out[name] = {"raw": t}
            continue
        scale = float(t.abs().max()) / qmax if t.numel() else 0.0
        if scale <= 0:
            out[name] = {"q": torch.zeros_like(t, dtype=torch.int8), "scale": 1.0}
            continue
        q = torch.clamp(torch.round(t / scale), -qmax - 1, qmax).to(torch.int8)
        out[name] = {"q": q, "scale": scale}
    return out


def dequantize_state_dict(qsd: Dict[str, dict]) -> Dict[str, torch.Tensor]:
    """Inverse of `quantize_state_dict` (float32 reconstruction)."""
    out: Dict[str, torch.Tensor] = {}
    for name, entry in qsd.items():
        if "raw" in entry:
            out[name] = entry["raw"]
        else:
            out[name] = entry["q"].to(torch.float32) * entry["scale"]
    return out


def load_extension(path: str, model) -> dict:
    """Load a saved project or an installed (quantized) extension into `model`.
    Returns the stored payload (config, contracts, format)."""
    payload = torch.load(path, map_location="cpu", weights_only=False)
    state = payload["model"]
    if payload.get("quantized"):
        state = dequantize_state_dict(state)
    model.load_state_dict(state)
    return payload


def _atomic_torch_save(payload: dict, path: str) -> None:
    import os
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    torch.save(payload, tmp)
    os.replace(tmp, path)


def _deltas(xs: List[float]) -> List[float]:
    return [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]


def _correlation(a: List[float], b: List[float]) -> float:
    n = min(len(a), len(b))
    if n < 2:
        return 0.0
    a, b = a[:n], b[:n]
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va == 0 or vb == 0:
        return 0.0
    cov = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    return cov / (va ** 0.5 * vb ** 0.5)
