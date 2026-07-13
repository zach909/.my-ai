"""
NeuroLang Interpreter — single file v0.4
PyTorch-backed elastic neuron DSL with skills, script AI, and deep neural search.

Usage: python neurolang.py <file.nl>

Syntax:
  dims = N
  name="X"
  "X"@vale="0.9"
  "X"@connections=".Y/state"*w+b
  "X"@definishon="text"
  input "X" = [1.0, 0.5, -0.3]
  run N ticks
  show "X"
  code@name="mynet"
  "mynet"@code="def f(x): return x**2"
  "netsearch"@name="idx"
  "netsearch"@corpus="text..."
  "netsearch"@query="find something"      # hard TF-IDF search
  "netsearch"@neural="find something"     # deep learning neural search
  "netsearch"@neurons                     # index all neuron definitions
  "netsearch"@net="idx.netsearch"
  skill@name="myskill"
  "myskill"@skill_learn="corpus text..."  # train skill expert
  "myskill"@skill_query="question"        # query via deep learning
  script@learn                            # learn NeuriLang syntax from this script
  script@generate="hint"                  # generate new NeuriLang statements
  # comment
"""

import ast, hashlib, math, os, random, re, sys, time
from collections import Counter

import torch
import torch.nn as nn
import torch.optim as optim

# ══════════════════════════════════════════════════════════
#  NEURONS
# ══════════════════════════════════════════════════════════

DEFAULT_VALE, DEFAULT_DIM, DEFAULT_W, DEFAULT_B = 0.5, 3, 1.0, 0.0


class ElasticNeuron(nn.Module):
    def __init__(self, name, dims=DEFAULT_DIM, vale=DEFAULT_VALE):
        super().__init__()
        self.name = name
        self.dims = dims
        self.definition = ""
        self.vale = torch.tensor(vale, dtype=torch.float32).clamp(0, 1)
        self.register_buffer("state",      torch.zeros(dims))
        self.register_buffer("next_state", torch.zeros(dims))
        self.register_buffer("external",   torch.zeros(dims))
        self.ex_weights: dict[str, torch.Tensor] = {}
        self.ex_biases:  dict[str, torch.Tensor] = {}

    def set_connection(self, target, weight, bias):
        self.ex_weights[target] = torch.tensor(weight, dtype=torch.float32)
        self.ex_biases[target]  = torch.tensor(bias,   dtype=torch.float32)

    def compute_next(self, all_neurons):
        raw = self.external.clone()
        for name, other in all_neurons.items():
            if name == self.name: continue
            w = self.ex_weights.get(name, torch.tensor(DEFAULT_W))
            b = self.ex_biases.get(name,  torch.tensor(DEFAULT_B))
            raw = raw + other.state * w + b
        activated = torch.tanh(raw)
        self.next_state = self.vale * self.state + (1.0 - self.vale) * activated

    def apply_next(self):
        self.state = self.next_state.clone()

    def inject(self, values):
        v = torch.tensor(values, dtype=torch.float32)
        pad = max(0, self.dims - len(v))
        self.external = torch.cat([v[:self.dims], torch.zeros(pad)])

    def summary(self):
        lines = [
            f'\n── Neuron "{self.name}" ──',
            f'  vale       : {self.vale.item():.4f}',
            f'  dims       : {self.dims}',
            f'  state      : {_fv(self.state)}',
            f'  external   : {_fv(self.external)}',
        ]
        if self.definition: lines.append(f'  definition : "{self.definition}"')
        if self.ex_weights:
            for t, w in self.ex_weights.items():
                lines.append(f'  → "{t}"  w={w.item():.4f}  b={self.ex_biases[t].item():.4f}')
        else:
            lines.append('  connections: all-to-all (default)')
        return '\n'.join(lines)


def _fv(t): return '[' + '  '.join(f'{x:+.4f}' for x in t.tolist()) + ']'


# ══════════════════════════════════════════════════════════
#  CODE-TO-NET
# ══════════════════════════════════════════════════════════

ENCODE_LEN = 256


class CodeNet(nn.Module):
    def __init__(self, in_dim, out_dim, hidden=64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden), nn.Tanh(),
            nn.Linear(hidden, hidden), nn.Tanh(),
            nn.Linear(hidden, out_dim),
        )
    def forward(self, x): return self.net(x)


def _encode_code(code):
    b = code.encode('utf-8', errors='replace')
    hist = torch.zeros(256)
    for byte in b: hist[byte] += 1
    if hist.sum() > 0: hist /= hist.sum()
    sampled = torch.zeros(ENCODE_LEN)
    if b:
        for i in range(ENCODE_LEN):
            sampled[i] = b[int(i * len(b) / ENCODE_LEN)] / 255.0
    return torch.cat([hist, sampled])


def _probe_python(code, n=200):
    try: tree = ast.parse(code)
    except SyntaxError: return None
    funcs = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    if not funcs: return None
    ns = {}
    try: exec(compile(tree, '<cn>', 'exec'), ns)  # noqa: S102
    except Exception: return None
    fn = ns.get(funcs[0])
    if not callable(fn): return None
    try:
        import inspect
        arity = len(inspect.signature(fn).parameters)
    except Exception: arity = 1
    pairs = []
    for _ in range(n):
        xs = [random.uniform(-3, 3) for _ in range(arity)]
        try:
            r = fn(*xs)
            if isinstance(r, (int, float)):
                pairs.append((torch.tensor(xs, dtype=torch.float32),
                               torch.tensor([float(r)], dtype=torch.float32)))
            elif isinstance(r, (list, tuple)):
                pairs.append((torch.tensor(xs, dtype=torch.float32),
                               torch.tensor([float(v) for v in r], dtype=torch.float32)))
        except Exception: continue
    return pairs if len(pairs) > 10 else None


def train_codenet(name, code, save_dir='.', epochs=300, lr=1e-3):
    print(f'\n[CodeNet] Building "{name}"...')
    emb = _encode_code(code)
    pairs = _probe_python(code)

    if pairs:
        in_d, out_d = pairs[0][0].shape[0], pairs[0][1].shape[0]
        mode = 'function_approximation'
        print(f'  mode     : {mode}  ({len(pairs)} samples, arity={in_d})')
        model = CodeNet(in_d, out_d)
        xs = torch.stack([p[0] for p in pairs])
        ys = torch.stack([p[1] for p in pairs])
        opt = optim.Adam(model.parameters(), lr=lr)
        for ep in range(epochs):
            loss = nn.functional.mse_loss(model(xs), ys)
            opt.zero_grad(); loss.backward(); opt.step()
            if (ep + 1) % 100 == 0: print(f'  epoch {ep+1:>4}  loss={loss.item():.6f}')
        final = loss.item()
    else:
        in_d, out_d = 512, 64
        mode = 'embedding'
        print(f'  mode     : {mode}')
        model = CodeNet(in_d, out_d)
        tgt = emb.unsqueeze(0)[:, :out_d]
        opt = optim.Adam(model.parameters(), lr=lr)
        for ep in range(epochs):
            loss = nn.functional.mse_loss(model(emb.unsqueeze(0)), tgt)
            opt.zero_grad(); loss.backward(); opt.step()
        final = loss.item()
        print(f'  loss     : {final:.6f}')

    path = os.path.join(save_dir, f'{name}.codenet')
    meta = dict(name=name, mode=mode, in_dim=in_d, out_dim=out_d,
                loss=final, hash=hashlib.sha256(code.encode()).hexdigest()[:12])
    torch.save({'meta': meta, 'state': model.state_dict()}, path)
    print(f'  saved    : {path}')
    return meta


# ══════════════════════════════════════════════════════════
#  NETSEARCH
# ══════════════════════════════════════════════════════════

def _tok(text): return re.findall(r'[a-zA-Z0-9]+', text.lower())


class _TFIndex:
    def __init__(self):
        self.docs, self.tokens, self.vocab, self.idf, self.tfidf = [], [], [], {}, []

    def add(self, text):
        self.docs.append(text); self.tokens.append(_tok(text))

    def build(self):
        N = len(self.docs)
        df: Counter = Counter()
        for tl in self.tokens:
            for t in set(tl): df[t] += 1
        self.vocab = sorted(df)
        self.idf   = {t: math.log((N+1)/(df[t]+1)) for t in self.vocab}
        for tl in self.tokens:
            tf = Counter(tl); tot = max(len(tl), 1)
            self.tfidf.append({t: (tf[t]/tot)*self.idf[t] for t in tl if t in self.idf})

    def qvec(self, q):
        toks = _tok(q); tf = Counter(toks); tot = max(len(toks), 1)
        return {t: (tf[t]/tot)*self.idf.get(t, 0) for t in toks}

    def search(self, q, k=5):
        qv = self.qvec(q)
        out = [(sum(qv.get(t,0)*dv.get(t,0) for t in qv), self.docs[i])
               for i, dv in enumerate(self.tfidf)]
        out = [(s, d) for s, d in out if s > 0]
        out.sort(reverse=True)
        return out[:k]

    def tensor(self, vec):
        t = torch.zeros(len(self.vocab))
        for i, w in enumerate(self.vocab): t[i] = vec.get(w, 0)
        return t


class _RetrievalNet(nn.Module):
    def __init__(self, V, h=128):
        super().__init__()
        self.qe = nn.Sequential(nn.Linear(V,h),nn.Tanh(),nn.Linear(h,h//2),nn.Tanh())
        self.de = nn.Sequential(nn.Linear(V,h),nn.Tanh(),nn.Linear(h,h//2),nn.Tanh())
        self.sc = nn.Linear(h, 1)
    def forward(self, q, d):
        return torch.sigmoid(self.sc(torch.cat([self.qe(q), self.de(d)], -1)))


class NetSearchManager:
    def __init__(self, name):
        self.name = name; self.idx = _TFIndex()
        self.model = None; self.trained = False

    def add_corpus(self, text):
        for s in re.split(r'[.!?\n]+', text):
            s = s.strip()
            if len(s) > 5: self.idx.add(s)
        self.idx.build()
        print(f'[NetSearch] Indexed {len(self.idx.docs)} passages.')

    def train(self, epochs=200, lr=1e-3):
        if not self.idx.vocab: print('[NetSearch] No corpus.'); return
        V = len(self.idx.vocab)
        self.model = _RetrievalNet(V)
        opt = optim.Adam(self.model.parameters(), lr=lr)
        pairs = []
        for i, doc in enumerate(self.idx.docs):
            qv = self.idx.tensor(self.idx.qvec(doc))
            dv = self.idx.tensor(self.idx.tfidf[i])
            dn = self.idx.tensor(self.idx.tfidf[(i+1)%len(self.idx.docs)])
            pairs += [(qv, dv, 1.0), (qv, dn, 0.0)]
        print(f'[NetSearch] Training  vocab={V}  pairs={len(pairs)}')
        for ep in range(epochs):
            total = 0.0
            for q, d, lbl in pairs:
                p = self.model(q.unsqueeze(0), d.unsqueeze(0)).squeeze()
                loss = nn.functional.binary_cross_entropy(p, torch.tensor(lbl))
                opt.zero_grad(); loss.backward(); opt.step(); total += loss.item()
            if (ep+1) % 50 == 0: print(f'  epoch {ep+1:>4}  loss={total/len(pairs):.4f}')
        self.trained = True; print('[NetSearch] Training complete.')

    def hard_search(self, query, k=5):
        print(f'\n[NetSearch] Hard search: "{query}"')
        for score, doc in self.idx.search(query, k):
            print(f'  {score:.4f}  {doc[:80]}')

    def neural_search(self, query, k=5):
        if not self.trained: print('[NetSearch] Not trained.'); return
        V = len(self.idx.vocab); qv = self.idx.tensor(self.idx.qvec(query))
        scores = []
        self.model.eval()
        with torch.no_grad():
            for i, doc in enumerate(self.idx.docs):
                dv = self.idx.tensor(self.idx.tfidf[i])
                scores.append((self.model(qv.unsqueeze(0), dv.unsqueeze(0)).item(), doc))
        scores.sort(reverse=True)
        print(f'\n[NetSearch] Neural search: "{query}"')
        for s, d in scores[:k]: print(f'  {s:.4f}  {d[:80]}')

    def save(self, path):
        if not self.model: return
        torch.save({'vocab':self.idx.vocab,'idf':self.idx.idf,'docs':self.idx.docs,
                    'tfidf':self.idx.tfidf,'model':self.model.state_dict()}, path)
        print(f'[NetSearch] Saved → {path}')

    def load(self, path):
        ck = torch.load(path, weights_only=False)
        self.idx.vocab=ck['vocab']; self.idx.idf=ck['idf']
        self.idx.docs=ck['docs'];   self.idx.tfidf=ck['tfidf']
        V = len(self.idx.vocab)
        self.model = _RetrievalNet(V)
        self.model.load_state_dict(ck['model']); self.model.eval()
        self.trained = True
        print(f'[NetSearch] Loaded from {path}')


# ══════════════════════════════════════════════════════════
#  SKILL SYSTEM  (MoE experts declared in NeuriLang)
# ══════════════════════════════════════════════════════════

class SkillExpert:
    """A named MoE expert that learns a knowledge corpus and answers via deep learning."""

    def __init__(self, name: str):
        self.name = name
        self._search = NetSearchManager(name)
        self.trained = False

    def learn(self, corpus: str):
        self._search.add_corpus(corpus)
        self._search.train()
        self.trained = True

    def query(self, question: str, k: int = 3):
        print(f'\n[Skill:{self.name}] Query: "{question}"')
        if self.trained:
            self._search.neural_search(question, k)
        else:
            self._search.hard_search(question, k)

    def route(self, text: str) -> float:
        """Return a relevance score 0-1 for MoE routing decisions."""
        if not self.trained or not self._search.idx.vocab:
            return 0.0
        qv = self._search.idx.tensor(self._search.idx.qvec(text))
        self._search.model.eval()
        with torch.no_grad():
            scores = []
            for i in range(min(5, len(self._search.idx.docs))):
                dv = self._search.idx.tensor(self._search.idx.tfidf[i])
                s = self._search.model(qv.unsqueeze(0), dv.unsqueeze(0)).item()
                scores.append(s)
        return max(scores) if scores else 0.0


# ══════════════════════════════════════════════════════════
#  SCRIPT AI  (char-LSTM learns and generates NeuriLang)
# ══════════════════════════════════════════════════════════

class _CharLSTM(nn.Module):
    def __init__(self, vocab_size: int, hidden: int = 128, layers: int = 2):
        super().__init__()
        self.emb  = nn.Embedding(vocab_size, 32)
        self.lstm = nn.LSTM(32, hidden, layers, batch_first=True)
        self.head = nn.Linear(hidden, vocab_size)

    def forward(self, x, h=None):
        out, h = self.lstm(self.emb(x), h)
        return self.head(out), h


class ScriptAI:
    """Train on source text, generate new NeuriLang statements."""

    def __init__(self):
        self.model: _CharLSTM | None = None
        self.char2idx: dict[str, int] = {}
        self.idx2char: list[str] = []
        self.trained = False

    def learn(self, source: str, epochs: int = 400, lr: float = 1e-3):
        chars = sorted(set(source))
        chars.append('\x00')  # unknown token
        self.char2idx = {c: i for i, c in enumerate(chars)}
        self.idx2char = chars
        V = len(chars)
        self.model = _CharLSTM(V)
        opt = optim.Adam(self.model.parameters(), lr=lr)
        enc = [self.char2idx.get(c, V - 1) for c in source]
        xs = torch.tensor(enc[:-1]).unsqueeze(0)
        ys = torch.tensor(enc[1:]).unsqueeze(0)
        print(f'[ScriptAI] Learning from {len(source)} chars, vocab={V}')
        for ep in range(epochs):
            logits, _ = self.model(xs)
            loss = nn.functional.cross_entropy(logits.squeeze(0), ys.squeeze(0))
            opt.zero_grad(); loss.backward(); opt.step()
            if (ep + 1) % 100 == 0:
                print(f'  epoch {ep+1:>4}  loss={loss.item():.4f}')
        self.trained = True
        print('[ScriptAI] Ready — use: script@generate="hint"')

    def generate(self, seed: str = '', max_len: int = 120, temp: float = 0.8) -> str:
        if not self.trained:
            print('[ScriptAI] Not trained. Use: script@learn'); return ''
        if not seed:
            seed = random.choice([c for c in self.char2idx if c not in ('\x00', '\n')])
        self.model.eval()
        enc = [self.char2idx.get(c, len(self.char2idx) - 1) for c in seed]
        x = torch.tensor(enc).unsqueeze(0)
        out = list(seed)
        h = None
        with torch.no_grad():
            logits, h = self.model(x, h)
            for _ in range(max_len - len(seed)):
                last = logits[:, -1, :] / max(temp, 1e-6)
                idx = torch.multinomial(torch.softmax(last, -1), 1).item()
                ch = self.idx2char[idx]
                out.append(ch)
                if ch == '\n' and len(out) > len(seed) + 6:
                    break
                x = torch.tensor([[idx]])
                logits, h = self.model(x, h)
        result = ''.join(out).strip()
        print(f'[ScriptAI] Generated: {result}')
        return result


# ══════════════════════════════════════════════════════════
#  RUNTIME
# ══════════════════════════════════════════════════════════

class ParseError(Exception): pass


class _MeshCharTok:
    """Minimal char tokenizer that bridges NeuroLang programs to the trainable
    mesh (no external deps, no spm model needed)."""
    bos_id, eos_id, pad_id = 0, 1, 2

    def encode(self, s, bos=False, eos=False):
        ids = [3 + (ord(c) % 120) for c in str(s)]
        if bos:
            ids = [self.bos_id] + ids
        if eos:
            ids = ids + [self.eos_id]
        return ids

    def decode(self, ids):
        # inverse of encode for ASCII (ord < 120); ids are 3 + ord(c) % 120
        return "".join(chr((int(i) - 3) % 120) for i in ids if int(i) >= 3)


class NeuroRuntime:
    def __init__(self, dims=DEFAULT_DIM, save_dir='.'):
        self.dims = dims; self.save_dir = save_dir; self.tick = 0
        self.neurons:  dict[str, ElasticNeuron]    = {}
        self.codenets: dict[str, dict]              = {}
        self.searches: dict[str, NetSearchManager]  = {}
        self.skills:   dict[str, SkillExpert]       = {}
        self.script_ai = ScriptAI()
        self._search: str | None = None
        self._source: str = ''

    def declare(self, name):
        if name not in self.neurons:
            self.neurons[name] = ElasticNeuron(name, self.dims, DEFAULT_VALE)

    def set_vale(self, name, v):
        self._req(name); self.neurons[name].vale = torch.tensor(v).clamp(0, 1)

    def set_conn(self, src, tgt, weight, bias):
        self._req(src); self._req(tgt); self.neurons[src].set_connection(tgt, weight, bias)

    def set_def(self, name, text):
        self._req(name); self.neurons[name].definition = text

    def train_as_mesh(self, epochs=300, lr=5e-3, tolerance=0.25):
        """Connect the NeuroLang extension builder to the trainable mesh.

        Every neuron carrying a @definishon becomes a contract "when this neuron
        is the input, the network's output must be its definishon" (§4). Those
        contracts are compiled into the ExtensionBuilder and trained on a real
        MeshLM (§1) until they hold; satisfied contracts raise the mesh vale so
        they lock in (§2). This is what "the model is made in extension builder"
        means concretely — the DSL builds and trains the mesh.

        Returns the ExtensionBuilder TrainResult (or None if no definishons),
        and stores the trained mesh on self._mesh / tokenizer on self._mesh_tok.
        """
        from tinygpt.config import ModelConfig
        from tinygpt.model import build_model
        from tinygpt.extension_builder import Definishon, ExtensionBuilder

        contracts_src = [(nm, n.definition) for nm, n in self.neurons.items()
                         if getattr(n, "definition", "")]
        if not contracts_src:
            print("[neurolang] no @definishon contracts to train"); return None

        tok = _MeshCharTok()
        n_neurons = max(16, len(self.neurons) * 2)
        cfg = ModelConfig(vocab_size=128, block_size=64, arch="mesh",
                          mesh_neurons=n_neurons, mesh_dims=4, mesh_input=6, settle_ticks=3)
        mesh = build_model(cfg)
        eb = ExtensionBuilder(mesh, tok, device="cpu")
        contracts = [Definishon(when=nm, then=text) for nm, text in contracts_src]
        print(f"[neurolang] training {len(contracts)} definishon(s) into the mesh...")
        result = eb.train(contracts, epochs=epochs, lr=lr, weight_penalty=1e-4,
                          tolerance=tolerance, verbose=False)

        # §2: lock in satisfied contracts by raising the vale of the mesh neurons
        # (approximate: one mesh neuron per satisfied contract).
        for k in result.satisfied:
            mesh.raise_vale([k % mesh.N], amount=0.3)
        if result.conflicts:
            for i, j, _ in result.conflicts:
                print(f"[neurolang] CONFLICT: definishon {i!r} vs {j!r} cannot both hold")

        self._mesh = mesh
        self._mesh_tok = tok
        print(f"[neurolang] converged={result.converged} "
              f"satisfied {len(result.satisfied)}/{len(contracts)} in {result.epochs} epochs")
        return result

    def inject(self, name, vals):
        self._req(name); self.neurons[name].inject(vals)

    def step(self):
        for n in self.neurons.values(): n.compute_next(self.neurons)
        for n in self.neurons.values(): n.apply_next()
        self.tick += 1
        return {nm: n.state.tolist() for nm, n in self.neurons.items()}

    def run(self, ticks):
        results = []
        for _ in range(ticks): results.append((self.tick+1, self.step()))
        _print_trace(results)

    def show(self, name):
        self._req(name); print(self.neurons[name].summary())

    def declare_codenet(self, name):
        self.codenets[name] = {}; print(f'[CodeNet] Declared "{name}"')

    def set_code(self, name, code):
        self.codenets[name] = train_codenet(name, code, self.save_dir)

    def declare_search(self, name):
        self._search = name
        if name not in self.searches: self.searches[name] = NetSearchManager(name)

    def corpus(self, text):
        nm = self._search or self._no_search()
        self.searches[nm].add_corpus(text); self.searches[nm].train()

    def hard_query(self, q):
        (self.searches[self._search or self._no_search()]).hard_search(q)

    def net_path(self, path):
        nm = self._search or self._no_search(); mgr = self.searches[nm]
        if os.path.exists(path): mgr.load(path)
        elif mgr.trained: mgr.save(path)
        else: raise ParseError(f'Net file not found: {path}')

    def neural_query(self, q):
        """Deep learning neural search (trained retrieval net)."""
        (self.searches[self._search or self._no_search()]).neural_search(q)

    def neurons_to_corpus(self):
        """Index all neuron names + definitions into the active netsearch."""
        nm = self._search or self._no_search()
        texts = []
        for n in self.neurons.values():
            entry = n.name
            if n.definition:
                entry += ': ' + n.definition
            texts.append(entry)
        if not texts:
            print('[NetSearch] No neurons to index.'); return
        self.searches[nm].add_corpus('  '.join(texts))
        self.searches[nm].train()

    # ── skill / expert ──────────────────────────────────────

    def declare_skill(self, name: str):
        if name not in self.skills:
            self.skills[name] = SkillExpert(name)
        print(f'[Skill] Declared expert "{name}"')

    def skill_learn(self, name: str, corpus: str):
        if name not in self.skills:
            raise ParseError(f'Skill "{name}" not declared. Use: skill@name="{name}"')
        self.skills[name].learn(corpus)

    def skill_query(self, name: str, question: str):
        if name not in self.skills:
            raise ParseError(f'Skill "{name}" not declared.')
        self.skills[name].query(question)

    def moe_route(self, text: str):
        """Show which skills are most relevant (MoE routing)."""
        if not self.skills:
            print('[MoE] No skills declared.'); return
        scores = [(sk.route(text), nm) for nm, sk in self.skills.items()]
        scores.sort(reverse=True)
        print(f'\n[MoE] Routing "{text[:60]}"')
        for s, nm in scores:
            print(f'  {s:.4f}  {nm}')

    # ── script AI ───────────────────────────────────────────

    def script_learn(self):
        if self._source:
            self.script_ai.learn(self._source)
        else:
            print('[ScriptAI] No source loaded.')

    def script_generate(self, hint: str):
        self.script_ai.generate(hint)

    def _req(self, name):
        if name not in self.neurons:
            raise ParseError(f'Neuron "{name}" not declared. Use: name="{name}"')
    def _no_search(self):
        raise ParseError('No active netsearch. Use: "netsearch"@name="..."')


def _print_trace(results):
    print()
    for tick, snap in results:
        print(f'=== TICK {tick:>4} ===')
        for name, state in snap.items():
            print(f'  {name:>16}.state = {_fv(torch.tensor(state))}')
    print()


# ══════════════════════════════════════════════════════════
#  PARSER
# ══════════════════════════════════════════════════════════

P_DIM    = re.compile(r'^dims\s*=\s*(\d+)$')
P_DECL   = re.compile(r'^name\s*=\s*"([^"]+)"$')
P_VALE   = re.compile(r'^"([^"]+)"\s*@vale\s*=\s*"?([0-9.]+)"?$')
P_CONN   = re.compile(r'^"([^"]+)"\s*@connections\s*=\s*"\.\s*([^/]+)/([^"]+)"\s*\*\s*([0-9.]+)\s*\+\s*([0-9.]+)$')
P_DEFN   = re.compile(r'^"([^"]+)"\s*@definishon\s*=\s*"([^"]+)"$')
P_INPUT  = re.compile(r'^input\s+"([^"]+)"\s*=\s*\[([^\]]+)\]$')
P_RUN    = re.compile(r'^run\s+(\d+)\s*ticks?$')
P_TRAIN  = re.compile(r'^train(?:\s+mesh)?$')
P_SHOW   = re.compile(r'^show\s+"([^"]+)"$')
P_CDECL  = re.compile(r'^code@name\s*=\s*"([^"]+)"$')
P_CODE   = re.compile(r'^"([^"]+)"\s*@code\s*=\s*"(.*)"$', re.DOTALL)
P_NSDECL = re.compile(r'^"netsearch"\s*@name\s*=\s*"([^"]+)"$')
P_CORP   = re.compile(r'^"netsearch"\s*@corpus\s*=\s*"(.*)"$', re.DOTALL)
P_QUERY  = re.compile(r'^"netsearch"\s*@query\s*=\s*"([^"]+)"$')
P_NEURAL = re.compile(r'^"netsearch"\s*@neural\s*=\s*"([^"]+)"$')   # deep-learning search
P_NEURONS= re.compile(r'^"netsearch"\s*@neurons$')                   # index all neurons
P_NET    = re.compile(r'^"netsearch"\s*@net\s*=\s*"([^"]+)"$')
P_SKDECL = re.compile(r'^skill@name\s*=\s*"([^"]+)"$')              # declare skill expert
P_SKLEARN= re.compile(r'^"([^"]+)"\s*@skill_learn\s*=\s*"(.*)"$', re.DOTALL)
P_SKQUER = re.compile(r'^"([^"]+)"\s*@skill_query\s*=\s*"([^"]+)"$')
P_SCLEARN= re.compile(r'^script@learn$')                              # ScriptAI learn
P_SCGEN  = re.compile(r'^script@generate\s*=\s*"([^"]*)"$')         # ScriptAI generate


def interpret(source, save_dir='.'):
    rt = NeuroRuntime(save_dir=save_dir)
    rt._source = source
    lines = source.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip(); i += 1
        if not line or line.startswith('#'): continue
        try:
            m = P_DIM.match(line);    m and (setattr(rt,'dims',int(m.group(1))),) or None
            if m: continue
            m = P_DECL.match(line);   m and rt.declare(m.group(1))
            if m: continue
            m = P_VALE.match(line);   m and rt.set_vale(m.group(1),float(m.group(2)))
            if m: continue
            m = P_CONN.match(line);   m and rt.set_conn(m.group(1),m.group(2).strip(),float(m.group(4)),float(m.group(5)))
            if m: continue
            m = P_DEFN.match(line);   m and rt.set_def(m.group(1),m.group(2))
            if m: continue
            m = P_INPUT.match(line);  m and rt.inject(m.group(1),[float(v.strip()) for v in m.group(2).split(',')])
            if m: continue
            m = P_RUN.match(line);    m and rt.run(int(m.group(1)))
            if m: continue
            m = P_TRAIN.match(line);  m and rt.train_as_mesh()
            if m: continue
            m = P_SHOW.match(line);   m and rt.show(m.group(1))
            if m: continue
            m = P_CDECL.match(line);  m and rt.declare_codenet(m.group(1))
            if m: continue
            m = P_CODE.match(line);   m and rt.set_code(m.group(1),m.group(2))
            if m: continue
            m = P_NSDECL.match(line); m and rt.declare_search(m.group(1))
            if m: continue
            m = P_CORP.match(line);   m and rt.corpus(m.group(1))
            if m: continue
            m = P_QUERY.match(line);  m and rt.hard_query(m.group(1))
            if m: continue
            m = P_NEURAL.match(line); m and rt.neural_query(m.group(1))
            if m: continue
            m = P_NEURONS.match(line); m and rt.neurons_to_corpus()
            if m: continue
            m = P_NET.match(line);    m and rt.net_path(m.group(1))
            if m: continue
            m = P_SKDECL.match(line); m and rt.declare_skill(m.group(1))
            if m: continue
            m = P_SKLEARN.match(line); m and rt.skill_learn(m.group(1), m.group(2))
            if m: continue
            m = P_SKQUER.match(line); m and rt.skill_query(m.group(1), m.group(2))
            if m: continue
            m = P_SCLEARN.match(line); m and rt.script_learn()
            if m: continue
            m = P_SCGEN.match(line);  m and rt.script_generate(m.group(1))
            if m: continue
            raise ParseError(f'Unknown statement: {line!r}')
        except ParseError as e:
            print(f'[Line {i}] ERROR: {e}'); sys.exit(1)
    return rt


# ══════════════════════════════════════════════════════════
#  CLI
# ══════════════════════════════════════════════════════════

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python neurolang.py <file.nl>'); sys.exit(1)
    src = sys.argv[1]
    with open(src) as f: source = f.read()
    rt = interpret(source, save_dir=os.path.dirname(os.path.abspath(src)) or '.')
    print(f'\nDone. {len(rt.neurons)} neuron(s)  {len(rt.codenets)} codenet(s)  '
          f'{len(rt.searches)} search(es)  {len(rt.skills)} skill(s)  {rt.tick} tick(s)')
