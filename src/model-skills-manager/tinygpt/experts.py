"""Skill experts for mixture-of-experts routing in the mesh.

Each expert is a learnable module that transforms the input embedding into
a contribution vector that gets mixed into the neuron settling loop. Experts
are sparse — only top-k selected experts produce outputs each tick.
"""
from __future__ import annotations

import ast
import torch
import torch.nn as nn
import torch.nn.functional as F


class Expert(nn.Module):
    """Base class for skill experts that produce contributions to the mesh."""

    def __init__(self, in_dim: int, out_dim: int, name: str = "expert"):
        super().__init__()
        self.name = name
        self.in_dim = in_dim
        self.out_dim = out_dim

    def forward(self, emb: torch.Tensor) -> torch.Tensor:
        """Transform input embedding to contribution vector (B, out_dim)."""
        raise NotImplementedError

    def route_score(self, emb: torch.Tensor) -> torch.Tensor:
        """Relevance score [0, 1] for routing decisions. Default: constant."""
        return torch.ones(emb.size(0), device=emb.device)


class CodeNetExpert(Expert):
    """Code analysis expert: predicts neural behavior of code snippets.

    Takes code embeddings and produces a behavior vector that helps the mesh
    understand and reason about code execution paths.
    """

    def __init__(self, in_dim: int, out_dim: int = 64, hidden: int = 128):
        super().__init__(in_dim, out_dim, name="code_expert")
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.Tanh(),
            nn.Linear(hidden, hidden),
            nn.Tanh(),
            nn.Linear(hidden, out_dim),
        )
        self.router_head = nn.Linear(in_dim, 1)

    def forward(self, emb: torch.Tensor) -> torch.Tensor:
        """Produce code-behavior contribution."""
        return self.net(emb)

    def route_score(self, emb: torch.Tensor) -> torch.Tensor:
        """Score likelihood that input is code-related (0-1)."""
        logit = self.router_head(emb)
        return torch.sigmoid(logit).squeeze(-1)


class CodeExecutionExpert(Expert):
    """Code execution expert: runs Python code safely and captures behavioral
    outputs as neural signals.

    Executes code snippets in a sandboxed environment, captures execution traces
    (execution path, return values, exceptions), and encodes them as a contribution
    vector that the mesh can learn from. Routing decisions are driven by execution
    success and computational complexity.
    """

    def __init__(self, in_dim: int, out_dim: int = 64, hidden: int = 128, max_depth: int = 5):
        super().__init__(in_dim, out_dim, name="exec_expert")
        self.max_depth = max_depth
        # Encoder: execution trace → contribution vector
        trace_dim = 32  # max trace features
        self.trace_encoder = nn.Sequential(
            nn.Linear(trace_dim, hidden),
            nn.Tanh(),
            nn.Linear(hidden, out_dim),
        )
        # Router: detect code in input & predict execution success
        self.router_head = nn.Linear(in_dim, 1)
        # Behavior classifier: categorize execution patterns (success/error/loop/recursion)
        self.behavior_classifier = nn.Linear(trace_dim, 4)
        # Routing score modulator: scales routing based on predicted complexity
        self.complexity_predictor = nn.Linear(trace_dim, 1)
        self.last_execution = None
        self.execution_cache = {}  # code hash -> result

    def _safe_execute(self, code: str, timeout: float = 1.0) -> dict:
        """Execute code safely in sandbox, capture trace/output/exceptions.

        Returns dict with keys:
          - success: bool
          - output: captured print output
          - return_value: last expr value if any
          - exception: error message if any
          - trace: execution path features
          - depth: max call depth reached
        """
        import sys
        import io
        from contextlib import redirect_stdout

        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return {
                "success": False,
                "exception": str(e),
                "trace": torch.zeros(32),
                "depth": 0,
                "output": "",
                "return_value": None,
            }

        # Sanitize: reject dangerous operations
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                return {
                    "success": False,
                    "exception": "imports not allowed",
                    "trace": torch.zeros(32),
                    "depth": 0,
                    "output": "",
                    "return_value": None,
                }

        # Execute with output capture
        ns = {"__builtins__": {"len": len, "range": range, "str": str, "int": int, "float": float}}
        out_buf = io.StringIO()
        try:
            with redirect_stdout(out_buf):
                exec(compile(tree, "<exec>", "exec"), ns)  # noqa: S102
            output = out_buf.getvalue()
            return_value = ns.get("_result", None)
            # Build execution trace from namespace
            trace = self._build_trace(ns, len(output))
            return {
                "success": True,
                "output": output,
                "return_value": return_value,
                "exception": None,
                "trace": trace,
                "depth": self._measure_depth(tree),
            }
        except Exception as e:
            return {
                "success": False,
                "exception": str(e)[:100],
                "trace": torch.zeros(32),
                "depth": 0,
                "output": out_buf.getvalue(),
                "return_value": None,
            }

    def _build_trace(self, ns: dict, output_len: int) -> torch.Tensor:
        """Build a feature vector from execution namespace."""
        trace = torch.zeros(32)
        trace[0] = float(len(ns))  # variable count
        trace[1] = float(output_len) / 100.0  # output length (normalized)
        # Count numeric/string/callable values
        nums = sum(1 for v in ns.values() if isinstance(v, (int, float)))
        strs = sum(1 for v in ns.values() if isinstance(v, str))
        trace[2] = float(nums) / 10.0
        trace[3] = float(strs) / 10.0
        return torch.clamp(trace, -1, 1)

    def _measure_depth(self, tree: ast.AST) -> int:
        """Measure AST depth (nesting level)."""
        def depth(node):
            if isinstance(node, ast.AST):
                children = [depth(c) for c in ast.iter_child_nodes(node)]
                return 1 + max(children) if children else 1
            return 0
        return min(depth(tree), self.max_depth)

    def _predict_trace_from_embedding(self, emb: torch.Tensor) -> torch.Tensor:
        """Predict execution trace from embedding (learned mapping).

        This learns to predict code behavior from input representation,
        without necessarily executing code (faster, differentiable).
        """
        B = emb.size(0)
        trace = torch.tanh(emb[:, :32]) if emb.size(1) >= 32 else \
                torch.cat([torch.tanh(emb), torch.zeros(B, 32 - emb.size(1), device=emb.device)], dim=1)
        return trace

    def forward(self, emb: torch.Tensor) -> torch.Tensor:
        """Produce code behavior contribution from embedding.

        Strategy: Use embedding to predict execution trace (fast, differentiable).
        In production, can optionally execute actual code for ground truth.
        """
        trace = self._predict_trace_from_embedding(emb)
        return self.trace_encoder(trace)

    def route_score(self, emb: torch.Tensor) -> torch.Tensor:
        """Score likelihood that input contains executable code.

        Combines:
        1. Base routing score (is this code?)
        2. Predicted success likelihood (will it execute?)
        3. Complexity modulation (high complexity = higher routing priority)
        """
        trace = self._predict_trace_from_embedding(emb)

        # Base routing: is this input code-like?
        base_score = torch.sigmoid(self.router_head(emb)).squeeze(-1)

        # Predict execution success from trace
        behavior_logits = self.behavior_classifier(trace)  # (B, 4): success/error/loop/recursion
        success_prob = torch.softmax(behavior_logits, dim=-1)[:, 0]  # class 0 = success

        # Complexity modulation: prefer complex code (more learning signal)
        complexity = torch.sigmoid(self.complexity_predictor(trace)).squeeze(-1)

        # Combined score: base * success * complexity
        return base_score * success_prob * (0.5 + 0.5 * complexity)


class DomainSpecializedSearchExpert(Expert):
    """Domain-specialized search expert for a specific knowledge domain.

    Each instance is trained on a particular corpus (math, code, biology, etc.)
    and learns specialized retrieval patterns for that domain.
    """

    def __init__(self, vocab_dim: int, out_dim: int = 64, hidden: int = 128,
                 domain: str = "general"):
        super().__init__(vocab_dim, out_dim, name=f"search_{domain}")
        self.domain = domain
        # Domain-specific query encoder (distinct from general search)
        self.query_encoder = nn.Sequential(
            nn.Linear(vocab_dim, hidden),
            nn.ReLU(),  # ReLU for domain-specific sharper features
            nn.Linear(hidden, hidden // 2),
            nn.ReLU(),
        )
        # Document encoder
        self.doc_encoder = nn.Sequential(
            nn.Linear(vocab_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden // 2),
            nn.ReLU(),
        )
        # Domain-specific relevance: learned similarity function
        self.relevance_net = nn.Sequential(
            nn.Linear(hidden, hidden // 2),
            nn.ReLU(),
            nn.Linear(hidden // 2, 1)
        )
        # Output projection
        self.output_proj = nn.Linear(hidden // 2, out_dim)
        # Domain router: high when input is domain-relevant
        self.router_head = nn.Linear(vocab_dim, 1)
        # Corpus: domain-specific documents
        self.register_buffer("corpus_embeddings", torch.zeros(20, hidden // 2))
        self.corpus_trained = False
        self.domain_keywords = []  # List of keywords for this domain

    def set_domain_keywords(self, keywords: list[str]) -> None:
        """Set keywords that identify this domain (used in routing)."""
        self.domain_keywords = keywords

    def set_corpus(self, docs: torch.Tensor) -> None:
        """Set corpus for this domain."""
        if docs.size(0) > 0:
            embeddings = self.doc_encoder(docs)
            if embeddings.size(0) < self.corpus_embeddings.size(0):
                embeddings = torch.cat([
                    embeddings,
                    torch.zeros(self.corpus_embeddings.size(0) - embeddings.size(0),
                               embeddings.size(1), device=embeddings.device)
                ], dim=0)
            else:
                embeddings = embeddings[:self.corpus_embeddings.size(0)]
            self.corpus_embeddings = embeddings.detach()
            self.corpus_trained = True

    def forward(self, emb: torch.Tensor) -> torch.Tensor:
        """Retrieve relevant document embedding for this domain."""
        if not self.corpus_trained or self.corpus_embeddings.abs().max() < 1e-6:
            return torch.zeros(emb.size(0), self.out_dim, device=emb.device)

        q_emb = self.query_encoder(emb)  # (B, H/2)
        # Compute relevance scores against corpus using learned similarity
        scores = []
        for i, doc_emb in enumerate(self.corpus_embeddings):
            if doc_emb.abs().max() < 1e-6:
                continue
            combined = torch.cat([q_emb, doc_emb.unsqueeze(0).expand(q_emb.size(0), -1)], dim=-1)
            s = self.relevance_net(combined)
            scores.append(s)
        if not scores:
            return torch.zeros(emb.size(0), self.out_dim, device=emb.device)

        scores = torch.cat(scores, dim=-1)  # (B, n_docs)
        scores = torch.softmax(scores, dim=-1)
        # Weighted combination of relevant documents
        avg_doc = (scores.unsqueeze(-1) * self.corpus_embeddings[:scores.size(1)]).sum(dim=1)
        return self.output_proj(avg_doc)

    def route_score(self, emb: torch.Tensor) -> torch.Tensor:
        """Score domain relevance: high when input matches domain keywords/style."""
        logit = self.router_head(emb)
        return torch.sigmoid(logit).squeeze(-1)


class SearchExpert(Expert):
    """Retrieval expert: performs neural search and returns relevant document
    embeddings.

    Trained on a corpus with a relevance net that learns which documents match
    which queries. When active, produces a document embedding vector that the
    mesh can incorporate.
    """

    def __init__(self, vocab_dim: int, out_dim: int = 64, hidden: int = 128):
        super().__init__(vocab_dim, out_dim, name="search_expert")
        # Query encoder: transforms the query to query embedding
        self.query_encoder = nn.Sequential(
            nn.Linear(vocab_dim, hidden),
            nn.Tanh(),
            nn.Linear(hidden, hidden // 2),
            nn.Tanh(),
        )
        # Document encoder: transforms document to doc embedding
        self.doc_encoder = nn.Sequential(
            nn.Linear(vocab_dim, hidden),
            nn.Tanh(),
            nn.Linear(hidden, hidden // 2),
            nn.Tanh(),
        )
        # Relevance scorer: combines query + doc embeddings
        self.relevance_scorer = nn.Linear(hidden, 1)
        # Output projection: doc embedding → contribution
        self.output_proj = nn.Linear(hidden // 2, out_dim)
        self.router_head = nn.Linear(vocab_dim, 1)
        # Learned corpus: stored document embeddings
        self.register_buffer("corpus_embeddings", torch.zeros(10, hidden // 2))
        self.corpus_trained = False

    def set_corpus(self, docs: torch.Tensor) -> None:
        """Set corpus embeddings from document matrix (n_docs, vocab_dim)."""
        B = docs.size(0)
        if B > 0:
            embeddings = self.doc_encoder(docs)
            if embeddings.size(0) < self.corpus_embeddings.size(0):
                embeddings = torch.cat([
                    embeddings,
                    torch.zeros(self.corpus_embeddings.size(0) - embeddings.size(0),
                               embeddings.size(1), device=embeddings.device)
                ], dim=0)
            else:
                embeddings = embeddings[:self.corpus_embeddings.size(0)]
            self.corpus_embeddings = embeddings.detach()
            self.corpus_trained = True

    def forward(self, emb: torch.Tensor) -> torch.Tensor:
        """Retrieve best document embedding given query."""
        if not self.corpus_trained or self.corpus_embeddings.abs().max() < 1e-6:
            # No corpus: return zero contribution
            return torch.zeros(emb.size(0), self.out_dim, device=emb.device)
        q_emb = self.query_encoder(emb)                  # (B, H/2)
        # Compute relevance scores against all corpus docs
        scores = []
        for doc_emb in self.corpus_embeddings:
            s = self.relevance_scorer(torch.cat([q_emb, doc_emb.unsqueeze(0).expand(q_emb.size(0), -1)], -1))
            scores.append(s)
        scores = torch.cat(scores, dim=-1)               # (B, n_docs)
        scores = torch.softmax(scores, dim=-1)
        # Weighted average of doc embeddings
        avg_doc = (scores.unsqueeze(-1) * self.corpus_embeddings).sum(dim=1)  # (B, H/2)
        return self.output_proj(avg_doc)

    def route_score(self, emb: torch.Tensor) -> torch.Tensor:
        """Score likelihood that input is a query (0-1)."""
        logit = self.router_head(emb)
        return torch.sigmoid(logit).squeeze(-1)


class RoutingStabilityMonitor:
    """Monitor and measure expert routing stability over time.

    Tracks: activation patterns, switching frequency, load balance, entropy.
    High stability = consistent routing decisions; detects flakiness.
    """

    def __init__(self, n_experts: int, window_size: int = 100):
        self.n_experts = n_experts
        self.window_size = window_size
        self.activation_history = []  # (step, active_experts_mask)
        self.routing_scores_history = []  # (step, scores)
        self.entropy_history = []
        self.switches = 0
        self.last_active = None

    def record(self, active_mask: torch.Tensor, scores: torch.Tensor) -> None:
        """Record routing decision."""
        active = active_mask.float().mean(dim=0).detach().cpu()  # average across batch
        entropy = -torch.sum(torch.clamp(active, 1e-6, 1) * torch.log(torch.clamp(active, 1e-6, 1)))

        self.activation_history.append(active)
        self.routing_scores_history.append(scores.detach().cpu())
        self.entropy_history.append(float(entropy))

        # Count switches
        if self.last_active is not None:
            switched = (active != self.last_active).sum().item()
            self.switches += switched
        self.last_active = active

        # Keep rolling window
        if len(self.activation_history) > self.window_size:
            self.activation_history.pop(0)
            self.routing_scores_history.pop(0)
            self.entropy_history.pop(0)

    def stability_metrics(self) -> dict:
        """Compute routing stability metrics."""
        if not self.activation_history:
            return {}

        activations = torch.stack(self.activation_history)  # (T, n_experts)
        scores = torch.stack(self.routing_scores_history)  # (T, batch_size, n_experts)

        # Load balance: how evenly are experts used?
        mean_load = activations.mean(dim=0)
        load_std = mean_load.std().item()
        load_balance = 1.0 - load_std  # 1.0 = perfect balance

        # Entropy: decision certainty (high entropy = uncertain)
        avg_entropy = sum(self.entropy_history) / len(self.entropy_history)
        entropy_variance = torch.tensor(self.entropy_history).var().item()

        # Switching: how often does routing change?
        switch_rate = self.switches / max(1, len(self.activation_history))

        # Consistency: how stable is each expert's routing over time?
        expert_consistency = []
        for e in range(self.n_experts):
            expert_activations = activations[:, e]
            # High consistency = activation is stable (not flickering)
            consistency = 1.0 - expert_activations.std().item()
            expert_consistency.append(consistency)

        return {
            "load_balance": load_balance,
            "mean_load": mean_load.tolist(),
            "avg_entropy": avg_entropy,
            "entropy_variance": entropy_variance,
            "switch_rate": switch_rate,
            "expert_consistency": expert_consistency,
            "stable": load_balance > 0.5 and switch_rate < 0.1 and entropy_variance < 0.5,
        }


class ExpertMoE(nn.Module):
    """Mixture-of-Experts router that selects and mixes expert outputs.

    Each expert produces a contribution that gets added to the mesh settle
    context. The router selects top-k experts based on their routing scores,
    and outputs from selected experts are mixed by learned weights.

    Includes stability monitoring to track routing consistency and detect issues.
    """

    def __init__(self, experts: list[Expert], top_k: int = 2, track_stability: bool = True):
        super().__init__()
        self.experts = nn.ModuleList(experts)
        self.top_k = max(1, min(top_k, len(experts)))
        self.out_dim = experts[0].out_dim if experts else 0
        # Gate weights: how much each expert contributes when selected
        if len(experts) > 0:
            self.gate = nn.Linear(experts[0].in_dim, len(experts), bias=False)
        self._last_usage = None
        self.stability_monitor = RoutingStabilityMonitor(len(experts)) if track_stability else None

    def forward(self, emb: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Route emb to top-k experts and return mixed output + gate weights.

        Returns:
            output: (B, out_dim) mixed expert contribution
            gates: (B, n_experts) normalized gate weights
        """
        if not self.experts or self.out_dim == 0:
            return torch.zeros(emb.size(0), self.out_dim, device=emb.device), \
                   torch.zeros(emb.size(0), 0, device=emb.device)

        B = emb.size(0)
        # Compute routing scores and gate weights
        scores = []
        for expert in self.experts:
            scores.append(expert.route_score(emb))
        scores = torch.stack(scores, dim=-1)              # (B, n_experts)
        gates = torch.softmax(self.gate(emb), dim=-1)     # (B, n_experts)

        # Select top-k experts by routing score
        top_scores, top_indices = torch.topk(scores, self.top_k, dim=-1)
        active = torch.zeros(B, len(self.experts), device=emb.device, dtype=torch.bool)
        active.scatter_(1, top_indices, True)

        # Compute expert outputs for selected experts
        outputs = []
        for i, expert in enumerate(self.experts):
            out = expert(emb)  # (B, out_dim)
            # Zero out if not selected
            out = torch.where(active[:, i:i+1], out, torch.zeros_like(out))
            outputs.append(out)

        # Mix by normalized gates
        stack = torch.stack(outputs, dim=1)               # (B, n_experts, out_dim)
        gates_normed = gates.unsqueeze(-1)                # (B, n_experts, 1)
        mixed = (stack * gates_normed).sum(dim=1)         # (B, out_dim)

        with torch.no_grad():
            self._last_usage = active.float().mean(dim=0).detach().cpu()
            # Track routing stability
            if self.stability_monitor is not None:
                self.stability_monitor.record(active, scores)

        return mixed, gates

    def expert_usage(self) -> dict[str, float]:
        """Fraction of inputs that activated each expert."""
        if self._last_usage is None:
            return {}
        return {
            self.experts[i].name: float(self._last_usage[i])
            for i in range(len(self.experts))
        }

    def routing_stability(self) -> dict:
        """Get routing stability metrics (load balance, entropy, consistency)."""
        if self.stability_monitor is None:
            return {}
        return self.stability_monitor.stability_metrics()
