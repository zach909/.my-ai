"""
A from-scratch, pure-stdlib reverse-mode autodiff engine, just big enough for
neurolang.py's three small trainable nets (CodeNet, the retrieval net, the
char-LSTM). This replaces torch here: no third-party code (AGENTS.md).

Every value is a 1D vector of floats (a scalar is a length-1 vector), which is
all neurolang.py ever needs -- every training loop here already works one
sample at a time, so there is no batched/2D tensor to support. `V` is a node
in the computation graph: `.data` is its value, `.grad` accumulates dL/d(this)
after `.backward()`, and `._prev`/`._back` record how it was built so
`.backward()` can walk the graph in reverse and apply the chain rule.

This is standard reverse-mode autodiff (the technique under every modern deep
learning framework), written directly against this file's own needs rather
than adapted from any existing implementation.
"""
from __future__ import annotations

import math
import pickle
import random


class V:
    __slots__ = ("data", "grad", "_prev", "_back")

    def __init__(self, data, prev=()):
        self.data = [float(x) for x in data]
        self.grad = [0.0] * len(self.data)
        self._prev = prev
        self._back = lambda: None

    def __len__(self):
        return len(self.data)

    @staticmethod
    def leaf(data):
        """A value with no parents: either a trained parameter or a constant input."""
        return V(data)

    def zero_grad(self):
        self.grad = [0.0] * len(self.data)

    # ── elementwise ops (same length on both sides -- nothing here ever
    #    needs scalar-against-vector broadcasting) ──────────────────────

    def __add__(self, other):
        assert len(self) == len(other), "V.__add__ needs equal lengths"
        out = V([a + b for a, b in zip(self.data, other.data)], (self, other))

        def back():
            for i in range(len(out)):
                self.grad[i] += out.grad[i]
                other.grad[i] += out.grad[i]
        out._back = back
        return out

    def __sub__(self, other):
        return self + (other * V.leaf([-1.0] * len(other)))

    def __mul__(self, other):
        assert len(self) == len(other), "V.__mul__ needs equal lengths"
        out = V([a * b for a, b in zip(self.data, other.data)], (self, other))

        def back():
            for i in range(len(out)):
                self.grad[i] += out.grad[i] * other.data[i]
                other.grad[i] += out.grad[i] * self.data[i]
        out._back = back
        return out

    def tanh(self):
        t = [math.tanh(x) for x in self.data]
        out = V(t, (self,))

        def back():
            for i in range(len(out)):
                self.grad[i] += out.grad[i] * (1.0 - t[i] * t[i])
        out._back = back
        return out

    def sigmoid(self):
        s = [1.0 / (1.0 + math.exp(-x)) for x in self.data]
        out = V(s, (self,))

        def back():
            for i in range(len(out)):
                self.grad[i] += out.grad[i] * s[i] * (1.0 - s[i])
        out._back = back
        return out

    # ── reductions / shape ops ───────────────────────────────────────

    def sum(self):
        out = V([math.fsum(self.data)], (self,))

        def back():
            for i in range(len(self)):
                self.grad[i] += out.grad[0]
        out._back = back
        return out

    def slice(self, start, end):
        out = V(self.data[start:end], (self,))

        def back():
            for i in range(end - start):
                self.grad[start + i] += out.grad[i]
        out._back = back
        return out

    @staticmethod
    def cat(parts):
        data = []
        for p in parts:
            data.extend(p.data)
        out = V(data, tuple(parts))

        def back():
            i = 0
            for p in parts:
                for j in range(len(p)):
                    p.grad[j] += out.grad[i]
                    i += 1
        out._back = back
        return out

    def logsumexp(self):
        """log(sum(exp(x))), the max-subtracted stable way. d/dx_i = softmax(x)_i."""
        m = max(self.data)
        exps = [math.exp(x - m) for x in self.data]
        s = math.fsum(exps)
        out = V([math.log(s) + m], (self,))

        def back():
            for i in range(len(self)):
                self.grad[i] += out.grad[0] * (exps[i] / s)
        out._back = back
        return out

    def softmax(self):
        m = max(self.data)
        exps = [math.exp(x - m) for x in self.data]
        s = math.fsum(exps)
        probs = [e / s for e in exps]
        out = V(probs, (self,))

        def back():
            # d(softmax_i)/d(x_j) = softmax_i*(delta_ij - softmax_j)
            for i in range(len(self)):
                g = 0.0
                for j in range(len(self)):
                    g += out.grad[j] * (probs[j] * ((1.0 if i == j else 0.0) - probs[i]))
                self.grad[i] += g
        out._back = back
        return out

    # ── graph walk ───────────────────────────────────────────────────

    def backward(self):
        assert len(self) == 1, "backward() is only defined on a scalar (length-1) V"
        order = []
        seen = set()

        def visit(node):
            if id(node) in seen:
                return
            seen.add(id(node))
            for p in node._prev:
                visit(p)
            order.append(node)
        visit(self)
        self.grad = [1.0]
        for node in reversed(order):
            node._back()

    def item(self):
        assert len(self) == 1
        return self.data[0]

    def tolist(self):
        return list(self.data)


def mse_loss(pred: V, target: V) -> V:
    diff = pred - target
    sq = diff * diff
    n = float(len(pred))
    return sq.sum() * V.leaf([1.0 / n])


def bce_loss(pred: V, target: float) -> V:
    """Binary cross entropy; pred is a length-1 probability in (0, 1)."""
    p = min(max(pred.data[0], 1e-7), 1 - 1e-7)
    out = V([-(target * math.log(p) + (1 - target) * math.log(1 - p))], (pred,))

    def back():
        p_ = pred.data[0]
        pred.grad[0] += out.grad[0] * (-(target / max(p_, 1e-7)) + (1 - target) / max(1 - p_, 1e-7))
    out._back = back
    return out


def cross_entropy(logits: V, target_index: int) -> V:
    return logits.logsumexp() - logits.slice(target_index, target_index + 1)


def matvec(weight: V, out_dim: int, in_dim: int, x: V) -> V:
    """y = W @ x, where `weight` is a flattened (out_dim*in_dim) row-major V."""
    assert len(x) == in_dim
    data = []
    for i in range(out_dim):
        row = weight.data[i * in_dim:(i + 1) * in_dim]
        data.append(math.fsum(row[j] * x.data[j] for j in range(in_dim)))
    out = V(data, (weight, x))

    def back():
        for i in range(out_dim):
            g = out.grad[i]
            if g == 0.0:
                continue
            base = i * in_dim
            for j in range(in_dim):
                weight.grad[base + j] += g * x.data[j]
                x.grad[j] += g * weight.data[base + j]
    out._back = back
    return out


def embedding_lookup(table: V, dim: int, index: int) -> V:
    row = table.data[index * dim:(index + 1) * dim]
    out = V(row, (table,))

    def back():
        base = index * dim
        for j in range(dim):
            table.grad[base + j] += out.grad[j]
    out._back = back
    return out


def sample_categorical(probs, rng=random) -> int:
    """Index sampled from a plain-float probability list (torch.multinomial, n=1)."""
    r = rng.random() * math.fsum(probs)
    acc = 0.0
    for i, p in enumerate(probs):
        acc += p
        if r <= acc:
            return i
    return len(probs) - 1


def _init(n, fan_in):
    """Xavier/Glorot-ish uniform init, independent of any library's exact scheme."""
    k = 1.0 / math.sqrt(max(fan_in, 1))
    return [random.uniform(-k, k) for _ in range(n)]


class Module:
    def parameters(self):
        out = []
        for v in vars(self).values():
            if isinstance(v, V):
                out.append(v)
            elif isinstance(v, Module):
                out.extend(v.parameters())
            elif isinstance(v, (list, tuple)):
                for item in v:
                    if isinstance(item, Module):
                        out.extend(item.parameters())
        return out

    def state(self):
        raise NotImplementedError

    def load_state(self, state):
        raise NotImplementedError


class Linear(Module):
    def __init__(self, in_dim, out_dim):
        self.in_dim, self.out_dim = in_dim, out_dim
        self.W = V.leaf(_init(out_dim * in_dim, in_dim))
        self.b = V.leaf([0.0] * out_dim)

    def __call__(self, x: V) -> V:
        return matvec(self.W, self.out_dim, self.in_dim, x) + self.b

    def state(self):
        return {"W": self.W.tolist(), "b": self.b.tolist(), "in": self.in_dim, "out": self.out_dim}

    def load_state(self, s):
        self.W = V.leaf(s["W"]); self.b = V.leaf(s["b"])
        self.in_dim, self.out_dim = s["in"], s["out"]


class Sequential(Module):
    """Layers and activation functions ('tanh', 'sigmoid'), alternating, matching
    nn.Sequential(nn.Linear, nn.Tanh, ...) call sites in neurolang.py."""

    def __init__(self, *layers):
        self.layers = list(layers)

    def __call__(self, x: V) -> V:
        for layer in self.layers:
            x = layer(x) if isinstance(layer, Module) else _ACTIVATIONS[layer](x)
        return x

    def parameters(self):
        out = []
        for layer in self.layers:
            if isinstance(layer, Module):
                out.extend(layer.parameters())
        return out

    def state(self):
        return [layer.state() for layer in self.layers if isinstance(layer, Module)]

    def load_state(self, states):
        i = 0
        for layer in self.layers:
            if isinstance(layer, Module):
                layer.load_state(states[i]); i += 1


_ACTIVATIONS = {"tanh": lambda x: x.tanh(), "sigmoid": lambda x: x.sigmoid()}


class Embedding(Module):
    def __init__(self, vocab, dim):
        self.vocab, self.dim = vocab, dim
        self.table = V.leaf(_init(vocab * dim, dim))

    def __call__(self, index: int) -> V:
        return embedding_lookup(self.table, self.dim, index)

    def state(self):
        return {"table": self.table.tolist(), "vocab": self.vocab, "dim": self.dim}

    def load_state(self, s):
        self.table = V.leaf(s["table"]); self.vocab, self.dim = s["vocab"], s["dim"]


class LSTMCell(Module):
    """One LSTM layer, one timestep at a time (the standard 4-gate equations)."""

    def __init__(self, in_dim, hidden):
        self.in_dim, self.hidden = in_dim, hidden
        self.gates = Linear(in_dim + hidden, 4 * hidden)

    def step(self, x: V, h: V, c: V):
        z = V.cat([x, h])
        g = self.gates(z)
        i = g.slice(0, self.hidden).sigmoid()
        f = g.slice(self.hidden, 2 * self.hidden).sigmoid()
        gt = g.slice(2 * self.hidden, 3 * self.hidden).tanh()
        o = g.slice(3 * self.hidden, 4 * self.hidden).sigmoid()
        c2 = f * c + i * gt
        h2 = o * c2.tanh()
        return h2, c2

    def state(self):
        return self.gates.state()

    def load_state(self, s):
        self.gates.load_state(s)


class LSTMStack(Module):
    """`layers` stacked LSTMCells, each timestep's hidden output feeding the next layer."""

    def __init__(self, in_dim, hidden, layers):
        self.hidden, self.n_layers = hidden, layers
        self.cells = [LSTMCell(in_dim if i == 0 else hidden, hidden) for i in range(layers)]

    def init_state(self):
        zero = lambda: V.leaf([0.0] * self.hidden)
        return [(zero(), zero()) for _ in range(self.n_layers)]

    def step(self, x: V, state):
        new_state = []
        for cell, (h, c) in zip(self.cells, state):
            h, c = cell.step(x, h, c)
            new_state.append((h, c))
            x = h
        return x, new_state

    def parameters(self):
        out = []
        for cell in self.cells:
            out.extend(cell.parameters())
        return out

    def state(self):
        return [c.state() for c in self.cells]

    def load_state(self, states):
        for c, s in zip(self.cells, states):
            c.load_state(s)


class Adam:
    def __init__(self, params, lr=1e-3, betas=(0.9, 0.999), eps=1e-8):
        self.params, self.lr, self.b1, self.b2, self.eps = params, lr, betas[0], betas[1], eps
        self.m = [[0.0] * len(p) for p in params]
        self.v = [[0.0] * len(p) for p in params]
        self.t = 0

    def zero_grad(self):
        for p in self.params:
            p.zero_grad()

    def step(self):
        self.t += 1
        bc1 = 1 - self.b1 ** self.t
        bc2 = 1 - self.b2 ** self.t
        for p, m, v in zip(self.params, self.m, self.v):
            for i in range(len(p)):
                g = p.grad[i]
                m[i] = self.b1 * m[i] + (1 - self.b1) * g
                v[i] = self.b2 * v[i] + (1 - self.b2) * g * g
                mhat = m[i] / bc1
                vhat = v[i] / bc2
                p.data[i] -= self.lr * mhat / (math.sqrt(vhat) + self.eps)


def save(obj, path):
    """Drop-in for torch.save: `obj` is a plain dict of JSON/pickle-safe values
    (never a live V, which holds unpicklable closures -- callers pass `.state()`)."""
    with open(path, "wb") as f:
        pickle.dump(obj, f)


def load(path):
    with open(path, "rb") as f:
        return pickle.load(f)
