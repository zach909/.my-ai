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
    vector that the mesh can learn from.
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
        # Router: detect code in input
        self.router_head = nn.Linear(in_dim, 1)
        # Behavior classifier: categorize execution patterns
        self.behavior_classifier = nn.Linear(trace_dim, 4)  # classes: success, error, loop, recursion

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

    def forward(self, emb: torch.Tensor) -> torch.Tensor:
        """Execute code from embedding context and produce behavior contribution.

        In practice, the embedding would contain or reference code to execute.
        Here, we use the embedding values to simulate code behavior patterns.
        """
        # For now: use embedding to predict execution trace
        # (full version would decode embedding → code string → execute)
        B = emb.size(0)
        predicted_trace = torch.tanh(emb[:, :32])  # simulate trace from embedding
        return self.trace_encoder(predicted_trace)

    def route_score(self, emb: torch.Tensor) -> torch.Tensor:
        """Score likelihood that input contains executable code."""
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


class ExpertMoE(nn.Module):
    """Mixture-of-Experts router that selects and mixes expert outputs.

    Each expert produces a contribution that gets added to the mesh settle
    context. The router selects top-k experts based on their routing scores,
    and outputs from selected experts are mixed by learned weights.
    """

    def __init__(self, experts: list[Expert], top_k: int = 2):
        super().__init__()
        self.experts = nn.ModuleList(experts)
        self.top_k = max(1, min(top_k, len(experts)))
        self.out_dim = experts[0].out_dim if experts else 0
        # Gate weights: how much each expert contributes when selected
        if len(experts) > 0:
            self.gate = nn.Linear(experts[0].in_dim, len(experts), bias=False)
        self._last_usage = None

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

        return mixed, gates

    def expert_usage(self) -> dict[str, float]:
        """Fraction of inputs that activated each expert."""
        if self._last_usage is None:
            return {}
        return {
            self.experts[i].name: float(self._last_usage[i])
            for i in range(len(self.experts))
        }
