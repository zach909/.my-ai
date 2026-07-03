"""
NeuroLang Interpreter v0.1
AI / data-focused DSL — interpreted, Python-style execution.
Each neuron holds a vector (multi-ball) state, elastic inertia (vale),
and all-to-all weighted connections.
"""

import math
import re
import sys
from typing import Optional


# ─────────────────────────────────────────────
#  NEURON
# ─────────────────────────────────────────────

DEFAULT_VALE       = 0.5    # elasticity resistance (0 = instant, 1 = no change)
DEFAULT_DIM        = 3      # number of state balls (vector dimensions)
DEFAULT_BIAS       = 0.0
DEFAULT_WEIGHT     = 1.0


class Neuron:
    def __init__(self, name: str, dims: int = DEFAULT_DIM):
        self.name        = name
        self.vale        = DEFAULT_VALE
        self.dims        = dims
        self.state       = [0.0] * dims          # multi-ball state vector
        self.next_state  = [0.0] * dims          # staging buffer for sync update
        self.connections = {}                    # {target_name: (variable_ref, bias, weight)}
        self.external    = [0.0] * dims          # injected external input

    # Non-linear activation applied per ball
    @staticmethod
    def activate(x: float) -> float:
        return math.tanh(x)

    def compute_next(self, neurons: dict):
        """
        For each ball dimension d:
          raw[d]  = external[d]
                  + Σ_j( neurons[j].state[d] * weight_ij + bias_ij )
          new[d]  = vale * state[d] + (1 - vale) * activate(raw[d])
        """
        for d in range(self.dims):
            raw = self.external[d]

            for target_name, (_, bias, weight) in self.connections.items():
                if target_name in neurons:
                    src_state = neurons[target_name].state
                    raw += src_state[d] * weight + bias

            # All unregistered neurons also feed (default all-to-all)
            for n_name, n in neurons.items():
                if n_name == self.name:
                    continue
                if n_name not in self.connections:
                    # Default: weight=DEFAULT_WEIGHT, bias=DEFAULT_BIAS
                    raw += n.state[d] * DEFAULT_WEIGHT + DEFAULT_BIAS

            activated = self.activate(raw)
            self.next_state[d] = self.vale * self.state[d] + (1.0 - self.vale) * activated

    def apply_next(self):
        self.state = list(self.next_state)


# ─────────────────────────────────────────────
#  LEXER / PARSER
# ─────────────────────────────────────────────

# Statement patterns
RE_DECLARE   = re.compile(r'^name\s*=\s*"([^"]+)"$')
RE_VALE      = re.compile(r'^"([^"]+)"\s*@vale\s*=\s*"?([0-9.]+)"?$')
RE_CONN      = re.compile(r'^"([^"]+)"\s*@connections\s*=\s*"\.([^/]+)/([^"]+)"\s*\*\s*([0-9.]+)\s*\+\s*([0-9.]+)$')
RE_INPUT     = re.compile(r'^input\s+"([^"]+)"\s*=\s*\[([^\]]+)\]$')
RE_RUN       = re.compile(r'^run\s+(\d+)\s*ticks?$')
RE_SHOW      = re.compile(r'^show\s+"([^"]+)"$')
RE_COMMENT   = re.compile(r'^#.*$')
RE_DIM       = re.compile(r'^dims\s*=\s*(\d+)$')


class ParseError(Exception):
    pass


# ─────────────────────────────────────────────
#  RUNTIME
# ─────────────────────────────────────────────

class NeuroRuntime:
    def __init__(self, dims: int = DEFAULT_DIM):
        self.neurons: dict[str, Neuron] = {}
        self.dims = dims
        self.tick = 0
        self.history: list[dict] = []   # tick → {name: state vector}

    def declare(self, name: str):
        if name not in self.neurons:
            self.neurons[name] = Neuron(name, self.dims)

    def set_vale(self, name: str, value: float):
        self._require(name)
        self.neurons[name].vale = max(0.0, min(1.0, value))

    def set_connection(self, src: str, target: str, variable: str, weight: float, bias: float):
        self._require(src)
        self._require(target)
        self.neurons[src].connections[target] = (variable, bias, weight)

    def inject_input(self, name: str, values: list[float]):
        self._require(name)
        n = self.neurons[name]
        for d in range(min(len(values), self.dims)):
            n.external[d] = values[d]

    def step(self):
        """One synchronous tick — all neurons compute in parallel, then apply."""
        for n in self.neurons.values():
            n.compute_next(self.neurons)
        for n in self.neurons.values():
            n.apply_next()
        self.tick += 1
        snap = {name: list(n.state) for name, n in self.neurons.items()}
        self.history.append(snap)
        return snap

    def run(self, ticks: int):
        results = []
        for _ in range(ticks):
            snap = self.step()
            results.append((self.tick, snap))
        return results

    def show(self, name: str):
        self._require(name)
        n = self.neurons[name]
        print(f"\n── Neuron \"{name}\" ──")
        print(f"  vale      : {n.vale}")
        print(f"  dims      : {n.dims}")
        print(f"  state     : {_fmt_vec(n.state)}")
        print(f"  external  : {_fmt_vec(n.external)}")
        if n.connections:
            for tgt, (var, bias, weight) in n.connections.items():
                print(f"  → \"{tgt}\"  weight={weight}  bias={bias}")
        else:
            print("  connections: all-to-all (defaults)")

    def _require(self, name: str):
        if name not in self.neurons:
            raise ParseError(f"Neuron \"{name}\" not declared. Use: name=\"{name}\"")


# ─────────────────────────────────────────────
#  EXECUTION TRACE PRINTER
# ─────────────────────────────────────────────

def _fmt_vec(v: list) -> str:
    return "[" + "  ".join(f"{x:+.4f}" for x in v) + "]"


def print_trace(results: list):
    print()
    for tick, snap in results:
        print(f"=== TICK {tick:>3} ===")
        for name, state in snap.items():
            print(f"  {name:>12}.state = {_fmt_vec(state)}")
    print()


# ─────────────────────────────────────────────
#  INTERPRETER ENTRY
# ─────────────────────────────────────────────

def interpret(source: str):
    rt = NeuroRuntime()
    lines = source.splitlines()

    for lineno, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line or RE_COMMENT.match(line):
            continue

        try:
            # dims = N
            m = RE_DIM.match(line)
            if m:
                rt.dims = int(m.group(1))
                continue

            # name="X"
            m = RE_DECLARE.match(line)
            if m:
                rt.declare(m.group(1))
                continue

            # "X"@vale="0.9"
            m = RE_VALE.match(line)
            if m:
                rt.set_vale(m.group(1), float(m.group(2)))
                continue

            # "X"@connections=".Y/state"*0.8+0.2
            m = RE_CONN.match(line)
            if m:
                src, tgt, var = m.group(1), m.group(2), m.group(3)
                weight, bias = float(m.group(4)), float(m.group(5))
                rt.set_connection(src, tgt, var, weight, bias)
                continue

            # input "X" = [1.0, 0.5, -0.3]
            m = RE_INPUT.match(line)
            if m:
                name = m.group(1)
                vals = [float(v.strip()) for v in m.group(2).split(",")]
                rt.inject_input(name, vals)
                continue

            # run N ticks
            m = RE_RUN.match(line)
            if m:
                ticks = int(m.group(1))
                results = rt.run(ticks)
                print_trace(results)
                continue

            # show "X"
            m = RE_SHOW.match(line)
            if m:
                rt.show(m.group(1))
                continue

            raise ParseError(f"Unrecognised statement: {line!r}")

        except ParseError as e:
            print(f"[Line {lineno}] ERROR: {e}")
            sys.exit(1)

    return rt


# ─────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python interpreter.py <file.nl>")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        source = f.read()

    rt = interpret(source)
    print(f"\nDone. {len(rt.neurons)} neuron(s), {rt.tick} tick(s) run.")
