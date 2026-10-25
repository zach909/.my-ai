"""
NeuroLang Interpreter — single file v0.4
PyTorch-backed elastic neuron DSL with skills, script AI, and deep neural search.

Usage: python neurolang.py <file.nl>

Syntax:
  dims = N
  name="X"
  "X"@vale="0.9"
  "X"@reward="0.8"                         # zero-sum reinforce (+ locks in, - frees up)
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

import tensorlite as tl

# ══════════════════════════════════════════════════════════
#  NEURONS
# ══════════════════════════════════════════════════════════

DEFAULT_VALE, DEFAULT_DIM, DEFAULT_W, DEFAULT_B = 0.5, 3, 1.0, 0.0
# Connection weight auto-assigned between neurons whose definitions share a
# dictionary/thesaurus concept (see NeuroRuntime._link_by_dictionary) — softer
# than an explicit hand-authored @connections= weight, since it's inferred.
_DICT_LINK_WEIGHT = 0.5


def _clamp01(x): return max(0.0, min(1.0, float(x)))


class ElasticNeuron:
    def __init__(self, name, dims=DEFAULT_DIM, vale=DEFAULT_VALE):
        self.name = name
        self.dims = dims
        self.definition = ""
        self.vale = _clamp01(vale)
        self.state:      list[float] = [0.0] * dims
        self.next_state: list[float] = [0.0] * dims
        self.external:   list[float] = [0.0] * dims
        self.ex_weights: dict[str, float] = {}
        self.ex_biases:  dict[str, float] = {}
        # Higher-dimensional thinking: "each neuron maintains temporary state
        # variables describing every other neuron." A connection may target a
        # *named* state variable of another neuron (".other/variable"); each
        # neuron assigns its own variable names to its own state dimensions
        # here, so the same name always resolves to the same dimension.
        self.var_index: dict[str, int] = {}
        # target name -> which dimension of the target's state this connection
        # reads (None = the whole state vector, the default all-to-all behaviour).
        self.ex_vars:   dict[str, "int | None"] = {}

    def dim_for_var(self, varname):
        """Resolve one of *this* neuron's named state variables to a stable
        dimension index (assigned first-seen, wrapping at `dims`)."""
        if varname not in self.var_index:
            self.var_index[varname] = len(self.var_index) % self.dims
        return self.var_index[varname]

    def set_connection(self, target, weight, bias, var_dim=None):
        self.ex_weights[target] = float(weight)
        self.ex_biases[target]  = float(bias)
        self.ex_vars[target]    = var_dim

    def compute_next(self, all_neurons):
        raw = list(self.external)
        for name, other in all_neurons.items():
            if name == self.name: continue
            w = self.ex_weights.get(name, DEFAULT_W)
            b = self.ex_biases.get(name,  DEFAULT_B)
            dim = self.ex_vars.get(name)
            # Read the target's whole state (default) or just the one named
            # state variable (dimension) this connection selected; a selected
            # scalar broadcasts across the accumulator's dimensions.
            if dim is None:
                for i in range(self.dims):
                    raw[i] += other.state[i] * w + b
            else:
                contribution = other.state[dim] * w + b
                for i in range(self.dims):
                    raw[i] += contribution
        activated = [math.tanh(r) for r in raw]
        self.next_state = [self.vale * self.state[i] + (1.0 - self.vale) * activated[i] for i in range(self.dims)]

    def apply_next(self):
        self.state = list(self.next_state)

    def inject(self, values):
        v = [float(x) for x in values][:self.dims]
        v += [0.0] * (self.dims - len(v))
        self.external = v

    def plasticity(self):
        """How readily this neuron changes, in [0, 1].

        Spec Value System: "A higher-value neuron changes less easily, while a
        lower-value neuron is more capable of learning and changing." The
        state update in compute_next() already scales the *new* activation by
        (1 - vale), so plasticity is exactly that coefficient — a low-value
        neuron admits more of each new activation, a high-value neuron holds
        its state."""
        return _clamp01(1.0 - self.vale)

    def expected_change(self, input_magnitude):
        """Predicted magnitude of state change for a given input magnitude.

        Spec: "More input combined with lower value results in greater change.
        Less input combined with higher value results in less change." The
        settled update moves the state by (1 - vale) * activation, and the
        activation saturates through tanh, so the predicted change is the
        plasticity gated by how much input actually drives the neuron."""
        drive = abs(math.tanh(float(input_magnitude)))
        return self.plasticity() * drive

    def summary(self):
        lines = [
            f'\n── Neuron "{self.name}" ──',
            f'  vale       : {self.vale:.4f}',
            f'  plasticity : {self.plasticity():.4f}  (1 - vale; how readily it changes)',
            f'  dims       : {self.dims}',
            f'  state      : {_fv(self.state)}',
            f'  external   : {_fv(self.external)}',
        ]
        if self.definition: lines.append(f'  definition : "{self.definition}"')
        if self.ex_weights:
            for t, w in self.ex_weights.items():
                lines.append(f'  → "{t}"  w={w:.4f}  b={self.ex_biases[t]:.4f}')
        else:
            lines.append('  connections: all-to-all (default)')
        return '\n'.join(lines)


def _fv(t): return '[' + '  '.join(f'{x:+.4f}' for x in t) + ']'


# ══════════════════════════════════════════════════════════
#  CODE-TO-NET
# ══════════════════════════════════════════════════════════

ENCODE_LEN = 256


class CodeNet(tl.Module):
    def __init__(self, in_dim, out_dim, hidden=64):
        self.net = tl.Sequential(
            tl.Linear(in_dim, hidden), 'tanh',
            tl.Linear(hidden, hidden), 'tanh',
            tl.Linear(hidden, out_dim),
        )
    def __call__(self, x): return self.net(x)
    def parameters(self): return self.net.parameters()
    def state(self): return self.net.state()
    def load_state(self, s): self.net.load_state(s)


def _encode_code(code):
    b = code.encode('utf-8', errors='replace')
    hist = [0.0] * 256
    for byte in b: hist[byte] += 1
    total = sum(hist)
    if total > 0: hist = [h / total for h in hist]
    sampled = [0.0] * ENCODE_LEN
    if b:
        for i in range(ENCODE_LEN):
            sampled[i] = b[int(i * len(b) / ENCODE_LEN)] / 255.0
    return hist + sampled


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
                pairs.append((xs, [float(r)]))
            elif isinstance(r, (list, tuple)):
                pairs.append((xs, [float(v) for v in r]))
        except Exception: continue
    return pairs if len(pairs) > 10 else None


def _batch_mse(model, samples):
    """Average MSE over `samples` ((x, y) float-list pairs), one scalar graph --
    the pure-Python equivalent of torch's batched mse_loss(model(xs), ys)."""
    losses = [tl.mse_loss(model(tl.V.leaf(x)), tl.V.leaf(y)) for x, y in samples]
    total = losses[0]
    for l in losses[1:]: total = total + l
    return total * tl.V.leaf([1.0 / len(losses)])


def train_codenet(name, code, save_dir='.', epochs=300, lr=1e-3):
    print(f'\n[CodeNet] Building "{name}"...')
    emb = _encode_code(code)
    pairs = _probe_python(code)

    if pairs:
        in_d, out_d = len(pairs[0][0]), len(pairs[0][1])
        mode = 'function_approximation'
        print(f'  mode     : {mode}  ({len(pairs)} samples, arity={in_d})')
        model = CodeNet(in_d, out_d)
        opt = tl.Adam(model.parameters(), lr=lr)
        loss = None
        for ep in range(epochs):
            opt.zero_grad()
            loss = _batch_mse(model, pairs)
            loss.backward(); opt.step()
            if (ep + 1) % 100 == 0: print(f'  epoch {ep+1:>4}  loss={loss.item():.6f}')
        final = loss.item()
    else:
        in_d, out_d = 512, 64
        mode = 'embedding'
        print(f'  mode     : {mode}')
        model = CodeNet(in_d, out_d)
        tgt = emb[:out_d]
        opt = tl.Adam(model.parameters(), lr=lr)
        loss = None
        for ep in range(epochs):
            opt.zero_grad()
            loss = tl.mse_loss(model(tl.V.leaf(emb)), tl.V.leaf(tgt))
            loss.backward(); opt.step()
        final = loss.item()
        print(f'  loss     : {final:.6f}')

    path = os.path.join(save_dir, f'{name}.codenet')
    meta = dict(name=name, mode=mode, in_dim=in_d, out_dim=out_d,
                loss=final, hash=hashlib.sha256(code.encode()).hexdigest()[:12])
    tl.save({'meta': meta, 'state': model.state()}, path)
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
        # rebuild from scratch — build() is called after every add_corpus, so
        # appending here would accumulate stale rows (more tfidf entries than
        # docs) and make idx.search index past the end of self.docs.
        self.tfidf = []
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
        return [float(vec.get(w, 0)) for w in self.vocab]


class _RetrievalNet(tl.Module):
    def __init__(self, vocab_size, h=128):
        self.qe = tl.Sequential(tl.Linear(vocab_size,h),'tanh',tl.Linear(h,h//2),'tanh')
        self.de = tl.Sequential(tl.Linear(vocab_size,h),'tanh',tl.Linear(h,h//2),'tanh')
        self.sc = tl.Linear(h, 1)
    def __call__(self, q, d):
        return self.sc(tl.V.cat([self.qe(q), self.de(d)])).sigmoid()
    def parameters(self):
        return self.qe.parameters() + self.de.parameters() + self.sc.parameters()
    def state(self):
        return {'qe': self.qe.state(), 'de': self.de.state(), 'sc': self.sc.state()}
    def load_state(self, s):
        self.qe.load_state(s['qe']); self.de.load_state(s['de']); self.sc.load_state(s['sc'])


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
        opt = tl.Adam(self.model.parameters(), lr=lr)
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
                opt.zero_grad()
                p = self.model(tl.V.leaf(q), tl.V.leaf(d))
                loss = tl.bce_loss(p, lbl)
                loss.backward(); opt.step(); total += loss.item()
            if (ep+1) % 50 == 0: print(f'  epoch {ep+1:>4}  loss={total/len(pairs):.4f}')
        self.trained = True; print('[NetSearch] Training complete.')

    def hard_search(self, query, k=5):
        print(f'\n[NetSearch] Hard search: "{query}"')
        results = list(self.idx.search(query, k))
        for score, doc in results:
            print(f'  {score:.4f}  {doc[:80]}')
        return results

    def neural_search(self, query, k=5):
        if not self.trained: print('[NetSearch] Not trained.'); return []
        qv = self.idx.tensor(self.idx.qvec(query))
        scores = []
        for i, doc in enumerate(self.idx.docs):
            dv = self.idx.tensor(self.idx.tfidf[i])
            scores.append((self.model(tl.V.leaf(qv), tl.V.leaf(dv)).item(), doc))
        scores.sort(reverse=True)
        print(f'\n[NetSearch] Neural search: "{query}"')
        for s, d in scores[:k]: print(f'  {s:.4f}  {d[:80]}')
        return scores[:k]

    def save(self, path):
        if not self.model: return
        tl.save({'vocab':self.idx.vocab,'idf':self.idx.idf,'docs':self.idx.docs,
                 'tfidf':self.idx.tfidf,'model':self.model.state()}, path)
        print(f'[NetSearch] Saved → {path}')

    def load(self, path):
        ck = tl.load(path)
        self.idx.vocab=ck['vocab']; self.idx.idf=ck['idf']
        self.idx.docs=ck['docs'];   self.idx.tfidf=ck['tfidf']
        V = len(self.idx.vocab)
        self.model = _RetrievalNet(V)
        self.model.load_state(ck['model'])
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
        scores = []
        for i in range(min(5, len(self._search.idx.docs))):
            dv = self._search.idx.tensor(self._search.idx.tfidf[i])
            s = self._search.model(tl.V.leaf(qv), tl.V.leaf(dv)).item()
            scores.append(s)
        return max(scores) if scores else 0.0


# ══════════════════════════════════════════════════════════
#  SCRIPT AI  (char-LSTM learns and generates NeuriLang)
# ══════════════════════════════════════════════════════════

class _CharLSTM(tl.Module):
    def __init__(self, vocab_size: int, hidden: int = 128, layers: int = 2):
        self.emb  = tl.Embedding(vocab_size, 32)
        self.lstm = tl.LSTMStack(32, hidden, layers)
        self.head = tl.Linear(hidden, vocab_size)

    def step(self, idx: int, state):
        """One token in, logits + the updated (h, c) per layer out -- the
        incremental form torch's nn.LSTM gave via forward(x, h), used both for
        a whole sequence (called once per position) and for generation (called
        once per newly sampled token, reusing the running state)."""
        h, state = self.lstm.step(self.emb(idx), state)
        return self.head(h), state

    def parameters(self):
        return self.emb.parameters() + self.lstm.parameters() + self.head.parameters()


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
        opt = tl.Adam(self.model.parameters(), lr=lr)
        enc = [self.char2idx.get(c, V - 1) for c in source]
        xs, ys = enc[:-1], enc[1:]
        print(f'[ScriptAI] Learning from {len(source)} chars, vocab={V}')
        loss = None
        for ep in range(epochs):
            opt.zero_grad()
            state = self.model.lstm.init_state()
            losses = []
            for xi, yi in zip(xs, ys):
                logits, state = self.model.step(xi, state)
                losses.append(tl.cross_entropy(logits, yi))
            loss = losses[0]
            for l in losses[1:]: loss = loss + l
            loss = loss * tl.V.leaf([1.0 / len(losses)])
            loss.backward(); opt.step()
            if (ep + 1) % 100 == 0:
                print(f'  epoch {ep+1:>4}  loss={loss.item():.4f}')
        self.trained = True
        print('[ScriptAI] Ready — use: script@generate="hint"')

    def generate(self, seed: str = '', max_len: int = 120, temp: float = 0.8) -> str:
        if not self.trained:
            print('[ScriptAI] Not trained. Use: script@learn'); return ''
        if not seed:
            seed = random.choice([c for c in self.char2idx if c not in ('\x00', '\n')])
        enc = [self.char2idx.get(c, len(self.char2idx) - 1) for c in seed]
        out = list(seed)
        state = self.model.lstm.init_state()
        logits = None
        for idx in enc:
            logits, state = self.model.step(idx, state)
        for _ in range(max_len - len(seed)):
            scaled = [x / max(temp, 1e-6) for x in logits.data]
            m = max(scaled)
            weights = [math.exp(s - m) for s in scaled]  # sample_categorical normalises
            idx = tl.sample_categorical(weights)
            ch = self.idx2char[idx]
            out.append(ch)
            if ch == '\n' and len(out) > len(seed) + 6:
                break
            logits, state = self.model.step(idx, state)
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


# ── thesaurus relationships for definition refinement ────────────────────
# Words in one group count as the same concept when comparing definitions.
# Compact and offline (no external APIs); extend freely.
_THESAURUS = [
    {"happy", "glad", "joyful", "cheerful", "pleased", "content"},
    {"sad", "unhappy", "sorrowful", "gloomy", "miserable"},
    {"big", "large", "huge", "great", "enormous", "vast"},
    {"small", "little", "tiny", "minor", "slight"},
    {"fast", "quick", "rapid", "swift", "speedy"},
    {"slow", "sluggish", "gradual", "unhurried"},
    {"smart", "clever", "intelligent", "bright", "wise"},
    {"begin", "start", "commence", "initiate", "launch"},
    {"end", "finish", "stop", "conclude", "terminate", "halt"},
    {"make", "create", "build", "construct", "produce", "generate"},
    {"destroy", "ruin", "demolish", "wreck", "break"},
    {"say", "tell", "speak", "state", "reply", "answer", "respond"},
    {"see", "look", "view", "observe", "watch", "notice"},
    {"think", "reason", "ponder", "consider", "reflect"},
    {"remember", "recall", "memorize", "retain", "store"},
    {"learn", "study", "train", "acquire", "absorb"},
    {"search", "find", "seek", "locate", "discover", "query"},
    {"connect", "link", "join", "attach", "wire", "couple"},
    {"signal", "wave", "pulse", "impulse", "spike"},
    {"neuron", "cell", "node", "unit"},
    {"greeting", "hello", "hi", "welcome", "salutation"},
    {"error", "mistake", "fault", "bug", "flaw"},
    {"correct", "right", "accurate", "true", "valid"},
]
_SYN_OF = {w: i for i, group in enumerate(_THESAURUS) for w in group}
_STOPWORDS = {"a", "an", "the", "is", "are", "was", "were", "be", "been", "it",
              "its", "of", "to", "in", "on", "at", "and", "or", "for", "with",
              "that", "this", "when", "then", "must", "should", "will", "can"}

# Dictionary meanings: a compact gloss that expands a word into the concept
# words of its definition. Combined with the thesaurus, this connects terms
# that mean related things without being listed synonyms (the design notes:
# "refined using thesaurus relationships AND dictionary meanings"). Each gloss
# word is itself thesaurus-folded, so "code" -> program/instruction/logic
# meets "software" -> program/... on the shared concept.
_DICTIONARY = {
    "code": {"program", "instruction", "logic", "software"},
    "program": {"code", "instruction", "software", "run"},
    "software": {"program", "code", "application"},
    "ai": {"intelligence", "learn", "reason", "neuron", "model"},
    "model": {"neuron", "learn", "reason", "network"},
    "network": {"neuron", "connect", "node", "graph"},
    "memory": {"remember", "store", "recall", "buffer"},
    "buffer": {"memory", "store", "queue"},
    "quantum": {"wave", "signal", "amplitude", "phase", "interference"},
    "interference": {"wave", "phase", "amplitude", "quantum"},
    "expert": {"skill", "specialist", "neuron", "route"},
    "skill": {"expert", "learn", "ability", "specialist"},
    "plugin": {"connect", "service", "extension", "external"},
    "empathy": {"emotion", "feel", "mood", "align"},
    "reason": {"think", "logic", "infer", "consider"},
    "greeting": {"hello", "welcome", "hi"},
    "hello": {"greeting", "welcome", "hi"},
    "encrypt": {"secure", "private", "protect", "cipher"},
    "quantize": {"compress", "shrink", "reduce", "deploy"},
    "compress": {"quantize", "shrink", "zip", "reduce"},
}


def _fold(word):
    """Fold a word to its thesaurus-group token, or itself if not in a group."""
    return f"syn:{_SYN_OF[word]}" if word in _SYN_OF else word


def _expand_synonyms(text):
    """Content-concept tokens of `text`. Each content word is folded to its
    thesaurus group, then expanded with its dictionary-gloss concepts (also
    folded), so definitions that share meaning — via synonyms OR via dictionary
    relationships — end up with overlapping token sets."""
    words = re.findall(r"[a-z']+", str(text).lower())
    out = set()
    for w in words:
        if w in _STOPWORDS or len(w) < 2:
            continue
        out.add(_fold(w))
        for gloss in _DICTIONARY.get(w, ()):       # dictionary meanings
            out.add(_fold(gloss))
    return out


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
        self._req(name); self.neurons[name].vale = _clamp01(v)

    def total_value(self):
        """Sum of all neuron values — the conserved quantity of the zero-sum
        Value System."""
        return float(sum(n.vale for n in self.neurons.values()))

    def reward(self, name, r, rate=0.2):
        """Reinforce or punish a neuron, conserving total value (zero-sum).

        Spec Value System: the total value distributed across all neurons is
        constant, and "If a neuron repeatedly produces poor results, the system
        can reduce its value, making it more adaptable to new information."

        A positive reward ``r`` raises the target's value (locking in a neuron
        that produced a good result, so it changes less); a negative reward
        lowers it (making a neuron that produced poor results more plastic).
        Whatever value the target gains is drawn — in equal shares — from every
        other neuron, and whatever it loses is redistributed back to them, so
        ``total_value()`` is invariant. Clamping to [0, 1] is honoured by only
        moving as much value as the donors/recipients can actually absorb.
        """
        self._req(name)
        others = [n for nm, n in self.neurons.items() if nm != name]
        target = self.neurons[name]
        desired = float(max(-1.0, min(1.0, r))) * rate
        if not others:
            # Nothing to trade with; value is trivially conserved by staying put.
            return self.total_value()

        # 1. Clamp the target move to what its own [0, 1] range allows.
        cur = float(target.vale)
        applied = max(-cur, min(1.0 - cur, desired))
        # 2. Donors must collectively move by -applied (they give value when the
        #    target gains, receive it when the target loses). Spread that across
        #    the donors, iterating so a donor hitting its [0, 1] clamp hands its
        #    unmet share to the donors that still have headroom — no value leaks.
        donor_needed = -applied           # total remaining donor movement
        donor_moved = 0.0                 # what donors actually moved so far
        pool = list(others)
        while abs(donor_needed) > 1e-9 and pool:
            share = donor_needed / len(pool)
            still = []
            for n in pool:
                v = float(n.vale)
                move = max(-v, min(1.0 - v, share))
                n.vale = _clamp01(v + move)
                donor_moved += move
                donor_needed -= move
                if abs(share - move) > 1e-9:   # donor clamped; still has a deficit share
                    still.append(n)
            if len(still) == len(pool):
                break  # no donor could absorb more — avoid an infinite loop
            pool = still
        # 3. Move the target by exactly the negative of what donors moved, so
        #    total_value() is invariant even when some donors were clamped.
        target.vale = _clamp01(cur - donor_moved)
        return self.total_value()

    def set_conn(self, src, tgt, weight, bias, varname=None):
        self._req(src); self._req(tgt)
        # ".tgt/variable" reads one named state variable (dimension) of the
        # target; a plain ".tgt" (or the sentinel whole-state names) reads the
        # target's whole state, as before.
        var_dim = None
        if varname and varname.strip() and varname.strip().lower() not in ("state", "all", "*"):
            var_dim = self.neurons[tgt].dim_for_var(varname.strip())
        self.neurons[src].set_connection(tgt, weight, bias, var_dim=var_dim)

    def set_def(self, name, text):
        self._req(name); self.neurons[name].definition = text
        self._link_by_dictionary(name)

    def _link_by_dictionary(self, name):
        """Neural Language: "definitions are refined using thesaurus
        relationships and dictionary meanings to create semantically
        connected neural structures." Any two neurons whose definitions share
        a folded thesaurus/dictionary concept (e.g. "code" and "software" both
        gloss onto {program, ...}) get an explicit two-way connection, even
        though the words themselves are not listed synonyms — the dictionary
        is what bridges them. Explicit @connections= (or @vale=-gated
        relationships) are left untouched; this only adds links for pairs
        that don't already have one."""
        concepts = _expand_synonyms(self.neurons[name].definition)
        if not concepts:
            return
        for other_name, other in self.neurons.items():
            if other_name == name or not other.definition:
                continue
            if other_name in self.neurons[name].ex_weights:
                continue  # an explicit connection already exists; don't override it
            if concepts & _expand_synonyms(other.definition):
                self.set_conn(name, other_name, _DICT_LINK_WEIGHT, 0.0)
                self.set_conn(other_name, name, _DICT_LINK_WEIGHT, 0.0)

    def train_as_mesh(self, epochs=300, lr=5e-3, tolerance=0.25):
        """Removed with the TinyGPT track.

        This compiled every @definishon into a contract and trained it into a
        mesh built by tinygpt.model.build_model(arch="mesh"). TinyGPT is gone,
        and with it the only trainer this had. The DSL itself is untouched:
        parsing, connections, @definishon and the zero-sum value system all
        still work, and the TypeScript side (models && skills/core/neuro-lang.ts)
        materialises the same DSL into the one live network, which is where
        definitions are trained now.
        """
        raise NotImplementedError(
            "train_as_mesh() went with the TinyGPT track. Definitions are "
            "trained into the live network on the TypeScript side "
            "(models && skills/core/neuro-lang.ts)."
        )

    def inject(self, name, vals):
        self._req(name); self.neurons[name].inject(vals)

    def step(self):
        for n in self.neurons.values(): n.compute_next(self.neurons)
        for n in self.neurons.values(): n.apply_next()
        self.tick += 1
        return {nm: list(n.state) for nm, n in self.neurons.items()}

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
            print(f'  {name:>16}.state = {_fv(state)}')
    print()


# ══════════════════════════════════════════════════════════
#  PARSER
# ══════════════════════════════════════════════════════════

P_DIM    = re.compile(r'^dims\s*=\s*(\d+)$')
P_DECL   = re.compile(r'^name\s*=\s*"([^"]+)"$')
P_VALE   = re.compile(r'^"([^"]+)"\s*@vale\s*=\s*"?([0-9.]+)"?$')
# Spec-literal alias: the design doc's Neural Definition Format spells the
# elastic-core value directive "@value=" (this codebase's own dialect calls
# it "@vale="). Both parse to the same rt.set_vale() call.
P_VALUE  = re.compile(r'^"([^"]+)"\s*@value\s*=\s*"?([0-9.]+)"?$')
# Value System reinforcement: reward (or punish) a neuron in [-1, 1]. Positive
# raises its value (locks it in — it changes less); negative lowers it (makes it
# more plastic). The opposite amount is redistributed across the mesh so the
# total value stays constant (zero-sum). Sign is allowed here, so match it
# before the unsigned @value= alias would swallow the number.
P_REWARD = re.compile(r'^"([^"]+)"\s*@reward\s*=\s*"?(-?[0-9.]+)"?$')
# The design doc's Neural Definition Format quotes every placeholder value,
# including the connection's bias/weight ("...*"bias"+"weight""), the same way
# it quotes @value="number". Accept the numbers with or without surrounding
# quotes so the literal spec syntax parses (matching P_VALUE's "?...."? form).
P_CONN   = re.compile(r'^"([^"]+)"\s*@connections\s*=\s*"\.\s*([^/]+)/([^"]+)"\s*\*\s*"?([0-9.]+)"?\s*\+\s*"?([0-9.]+)"?$')
P_DEFN   = re.compile(r'^"([^"]+)"\s*@definishon\s*=\s*"([^"]+)"$')
# Spec-literal alias: the design doc spells this directive "@definition="
# (this codebase's own dialect calls it "@definishon="). Both parse to the
# same rt.set_def() call.
P_DEFINITION = re.compile(r'^"([^"]+)"\s*@definition\s*=\s*"([^"]+)"$')
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
            m = P_REWARD.match(line); m and rt.reward(m.group(1),float(m.group(2)))
            if m: continue
            m = P_VALUE.match(line);  m and rt.set_vale(m.group(1),float(m.group(2)))
            if m: continue
            m = P_CONN.match(line);   m and rt.set_conn(m.group(1),m.group(2).strip(),float(m.group(4)),float(m.group(5)),varname=m.group(3))
            if m: continue
            m = P_DEFN.match(line);   m and rt.set_def(m.group(1),m.group(2))
            if m: continue
            m = P_DEFINITION.match(line); m and rt.set_def(m.group(1),m.group(2))
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
