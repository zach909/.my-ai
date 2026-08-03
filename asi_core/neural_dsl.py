"""
Neural Definition Language (NDL)

Implements spec Part 5 sections 76-78: a minimal text format for
describing a neuron - name, vale, definition, connections, and an optional
code attachment - so extensions can describe themselves in a common,
versionable format, and both humans and the AI can define neural
components without writing Python directly.

Grammar (one statement per line; blank lines and '#' comments ignored):

    name="<neuron_name>"
    <neuron_name>@vale="<number>"
    <neuron_name>@definition="<text>"
    <neuron_name>@connections="<target>*<weight>+<bias>[;<target>*<weight>+<bias>...]"
    <neuron_name>@code="<text>"
    <neuron_name>@type="<text>"

A `name="..."` line opens (or re-selects) the neuron block that
subsequent `@`-prefixed lines apply to; `<neuron_name>@attr="..."` lines
may also appear before their `name=` line and will create the neuron on
first reference, matching the spec's own example ordering.
"""

import cmath
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - import cycle avoidance
    from .neural_mesh import NeuralMesh


class NDLError(Exception):
    pass


@dataclass
class Connection:
    target: str
    weight: float
    bias: float


@dataclass
class NeuronDefinition:
    name: str
    vale: Optional[float] = None
    definition: str = ""
    connections: List[Connection] = field(default_factory=list)
    code: Optional[str] = None
    type: Optional[str] = None
    # Set when a `code@name="<name>"` statement declared this neuron before
    # its `"<name>"@code="..."` body arrived (see `code@name=` grammar
    # below) -- marks it as "imported from code" for execute().
    code_import: bool = False


@dataclass
class NetSearchRequest:
    """
    One `netsearch@name="..."` / `netsearch@net="..."` pair from the DSL
    grammar's "net search" statement: a hard text search over the design
    doc plus a small deep-learning step (see `netsearch()` /
    `netsearch_train()` below).
    """
    name: Optional[str] = None
    net: Optional[str] = None


@dataclass
class Program:
    """Full result of parsing an NDL source: ordinary neuron statements
    plus any `netsearch@...` statements, kept separate because a net
    search produces its neuron from a *search result*, not literal
    attribute values."""
    neurons: Dict[str, NeuronDefinition] = field(default_factory=dict)
    netsearch_requests: List[NetSearchRequest] = field(default_factory=list)


_NAME_RE = re.compile(r'^name\s*=\s*"([^"]*)"\s*$')
_ATTR_RE = re.compile(r'^(\w+)@(\w+)\s*=\s*"([^"]*)"\s*$')
_CONN_TERM_RE = re.compile(r'^([\w.]+)\*([+-]?[\d.]+)\+([+-]?[\d.]+)$')

_KNOWN_ATTRS = {"vale", "value", "definition", "connections", "code", "type"}

# Reserved owner names for the two special statement forms the grammar
# defines outside plain "neuron@attr=value" statements:
#   code@name="<name>"       -- import code as a net (see `execute()`)
#   netsearch@name="<name>"  -- local design-doc search (see `netsearch()`)
#   netsearch@net="<query>"
_CODE_IMPORT_ATTRS = {"name"}
_NETSEARCH_ATTRS = {"name", "net"}


def parse(source: str) -> Dict[str, NeuronDefinition]:
    """Parse NDL source into an ordered {name: NeuronDefinition} map."""
    return parse_program(source).neurons


def parse_program(source: str) -> Program:
    """
    Parse full NDL source, including the two special statement forms
    (`code@name="..."` for code-as-net import, `netsearch@name=`/
    `netsearch@net=` for local net search) that don't describe an
    attribute of the neuron named on the left-hand side the way ordinary
    `"name"@attr="..."` statements do.
    """
    neurons: Dict[str, NeuronDefinition] = {}
    netsearch_requests: List[NetSearchRequest] = []

    for lineno, raw in enumerate(source.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        name_match = _NAME_RE.match(line)
        if name_match:
            name = name_match.group(1)
            if not name:
                raise NDLError(f"line {lineno}: empty neuron name")
            neurons.setdefault(name, NeuronDefinition(name=name))
            continue

        attr_match = _ATTR_RE.match(line)
        if attr_match:
            owner, attr, value = attr_match.groups()

            if owner == "code" and attr in _CODE_IMPORT_ATTRS:
                # `code@name="foo"`: declares that neuron "foo" will be
                # (or already was) defined by an imported code body -- the
                # body itself arrives via the ordinary `foo@code="..."`
                # statement, which may come before or after this line.
                neuron = neurons.setdefault(value, NeuronDefinition(name=value))
                neuron.code_import = True
                continue

            if owner == "netsearch" and attr in _NETSEARCH_ATTRS:
                if attr == "name":
                    # A `name=` line always starts a fresh request, so a
                    # script can perform several net searches back to back.
                    netsearch_requests.append(NetSearchRequest(name=value))
                else:
                    if not netsearch_requests or netsearch_requests[-1].net is not None:
                        netsearch_requests.append(NetSearchRequest())
                    netsearch_requests[-1].net = value
                continue

            if attr not in _KNOWN_ATTRS:
                raise NDLError(f"line {lineno}: unknown attribute '@{attr}'")
            neuron = neurons.setdefault(owner, NeuronDefinition(name=owner))
            _apply_attr(neuron, attr, value, lineno)
            continue

        raise NDLError(f"line {lineno}: could not parse statement: {raw!r}")

    return Program(neurons=neurons, netsearch_requests=netsearch_requests)


def _apply_attr(neuron: NeuronDefinition, attr: str, value: str, lineno: int) -> None:
    if attr in ("vale", "value"):
        try:
            neuron.vale = float(value)
        except ValueError:
            raise NDLError(f"line {lineno}: vale must be numeric, got {value!r}")
    elif attr == "definition":
        neuron.definition = value
    elif attr == "code":
        neuron.code = value
    elif attr == "type":
        neuron.type = value
    elif attr == "connections":
        neuron.connections = _parse_connections(value, lineno)


def _parse_connections(value: str, lineno: int) -> List[Connection]:
    connections = []
    for term in value.split(";"):
        term = term.strip()
        if not term:
            continue
        match = _CONN_TERM_RE.match(term)
        if not match:
            raise NDLError(f"line {lineno}: malformed connection term {term!r}")
        target, weight, bias = match.groups()
        connections.append(Connection(target=target, weight=float(weight), bias=float(bias)))
    return connections


def to_source(neurons: Dict[str, NeuronDefinition]) -> str:
    """Serialize NeuronDefinitions back into NDL source (round-trip)."""
    lines: List[str] = []
    for neuron in neurons.values():
        lines.append(f'name="{neuron.name}"')
        if neuron.vale is not None:
            lines.append(f'{neuron.name}@vale="{neuron.vale:g}"')
        if neuron.definition:
            lines.append(f'{neuron.name}@definition="{neuron.definition}"')
        if neuron.connections:
            conn_str = ";".join(f"{c.target}*{c.weight:g}+{c.bias:g}" for c in neuron.connections)
            lines.append(f'{neuron.name}@connections="{conn_str}"')
        if neuron.code is not None:
            lines.append(f'{neuron.name}@code="{neuron.code}"')
        if neuron.type is not None:
            lines.append(f'{neuron.name}@type="{neuron.type}"')
    return "\n".join(lines)


def describe_extension(extension) -> str:
    """
    Spec section 77: "Extensions to describe themselves." Turns an
    asi_core.extension_system.Extension into NDL source: one neuron stub
    per bundled skill, typed as a skill and documented with the
    extension's purpose.
    """
    neurons = {
        skill_name: NeuronDefinition(
            name=skill_name,
            definition=f"{extension.purpose} ({extension.name})",
            type="skill",
        )
        for skill_name in extension.skills
    }
    return to_source(neurons)


# ---------------------------------------------------------------------------
# Net search: hard local text search over the design doc + a tiny
# deep-learning step, entirely local (hard constraint: NO EXTERNAL APIS).
# ---------------------------------------------------------------------------

# A local copy of the project design doc's own content -- "netsearch" is a
# literal grep over *this text*, never a network call.
DESIGN_DOC_TEXT = """
Background Quantization for running the model after building. Faster and saves power.
Extensions get quantized when the extension is done.
AI makes extensions to store memory and logic. Learns better.
When the model learned to code it made an extension to save it.
Background value is a range. A higher value neuron does not change as much
while a lower value neuron learns more. It is a zero sum game: total
neurons = total value points. The more input and less value, the more the
change. Learn but do not forget. The model demoted the bad neuron.
Foreground Mixture of Experts: some neurons choose who can run. Efficient
and faster. Expert was an extension for making images.
Foreground: each neuron gets to all the other neurons, moving away from
linear computing. Autonomous and infinite context. The model never
stopped, was autonomous, never forgot context as new prompts were added.
Foreground hyperdimensional thinking: each neuron has multi ball states
and changes its state based on its input and all others input, changing
it temporarily. Each neuron has a variable for each other neuron and
complex math, non-linear communication, each neuron connected to all
neurons. Understands what has happened and will not repeat it. The model
was able to read its own thoughts.
Hive mind. Chat groups. Suggestion chips. Prompting skills.
The AI gets inputs as zips and outputs as zips, working as a loop. When no
more space it wraps to the beginning until everything is processed. Same
for output. More context and output capacity within a fixed budget.
Foreground plugins and skills: a plugin is an API connection to another
local internal service. A skill is an expert added into the mixture of
experts. Everything connects to everything so plugins are easy.
Quantum neural net using quantum interference: input of the neuron
defines wave height, and the wave is the neuron's signature. When a
neuron matches that signature it has exclusive input. Neuron 2 signature
was 4.5 and height was 10.
Extension builder DSL creates a neuron and names it with name="example".
Value for the elastic core, higher value neurons change less, is set with
"name"@value="number". All neurons are connected by default via the
hyperdimensional non-linear connection scheme. Explicit connection
override uses "name"@connections=".names/variable"*"bias"+"weight".
Type out what the model should output if a neuron just has input using
"name"@definition="definition". Import binary or source code and turn it
into a neural net that behaves like that code with code@name="name" and
"name"@code="code". Net search is a hard text search over the design doc
content using the input text, plus a deep-learning step that trains a net
to reproduce the matched behavior, using "netsearch"@name="name" and
"netsearch"@net="location".
No external APIs. Any plugin or netsearch or network-sounding feature is
implemented as purely local simulated logic, no outbound HTTP calls, no
real external service integration.
""".strip()

_WORD_RE = re.compile(r"[a-z0-9']+")


def _words(text: str) -> List[str]:
    return _WORD_RE.findall(text.lower())


def netsearch(query: str, top_k: int = 3, corpus: str = DESIGN_DOC_TEXT) -> List[str]:
    """
    Spec's "net search": a hard text search over the design doc content
    using the input text. Purely local string matching over `corpus` (no
    network access whatsoever) -- scores each non-blank line of the corpus
    by how many query words it contains and returns the best `top_k`.
    """
    query_terms = set(_words(query))
    if not query_terms:
        return []

    scored: List[tuple] = []
    for line in corpus.splitlines():
        line = line.strip()
        if not line:
            continue
        overlap = len(query_terms & set(_words(line)))
        if overlap > 0:
            scored.append((overlap, line))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [line for _, line in scored[:top_k]]


def _encode_text_as_hdvector(text: str, dimensions: int, config):
    """Deterministic bag-of-words hypervector encoding: each distinct word
    maps to its own random-but-reproducible unit hypervector (seeded from
    the word itself), bundled together. Used only to feed the tiny
    training step below -- no external model or network is involved."""
    from .hyperdim_thinking import HDVector, bundle

    words = _words(text)
    if not words:
        return HDVector.zeros(dimensions)
    vectors = [HDVector.random(dimensions, seed=abs(hash(w)) % (2 ** 31)) for w in words]
    return bundle(*vectors)


def netsearch_train(matches: List[str], dimensions: int = 64, ticks: int = 5):
    """
    Spec: net search performs "a deep-learning step that trains a net to
    reproduce the matched behavior." This reuses the existing
    hyperdim_thinking plasticity machinery (HDNeuron.step's leaky
    integration + predictor learning, the same code UnifiedBrain drives
    every perceive() cycle) rather than inventing a second learning
    algorithm: each matched line is encoded as a hypervector and fed to a
    dedicated HDNeuron for `ticks` epochs with reward=1.0 (a confident
    positive outcome, per HDNeuron.should_consolidate's semantics), so the
    neuron's semantic state converges toward representing the matched
    text. Returns the trained neuron's final state vector.
    """
    from .hyperdim_thinking import HDConfig, HDNeuron

    config = HDConfig(dimensions=dimensions)
    neuron = HDNeuron(neuron_id=0, config=config, seed=0)
    if not matches:
        return neuron.state.copy()

    encoded = [_encode_text_as_hdvector(line, dimensions, config) for line in matches]
    for _ in range(ticks):
        for vec in encoded:
            neuron.step(vec, reward=1.0)
    return neuron.state.copy()


# ---------------------------------------------------------------------------
# Quantum-interference "wave signature" routing (classical simulation --
# complex-number wave math, never real quantum hardware, per the spec).
# ---------------------------------------------------------------------------

def wave_interference(height: float, signature: float, samples: int = 24, dt: float = 0.15) -> float:
    """
    Classical simulation of quantum interference between an input's wave
    (spec: "input of the neuron defines wave height" -- `height` doubles
    as that wave's own angular frequency) and a neuron's signature wave
    (angular frequency `signature`), sampled at `samples` points across a
    short time window.

    Coherently summing `exp(i * (height - signature) * t)` over the
    window is a matched filter on the *difference* frequency: every term
    has magnitude 1, so when `height == signature` every term points the
    same direction and the terms add constructively, giving a mean
    amplitude of exactly 1.0 (perfect resonance -- the neuron's signature
    "matches" this input's wave). As the mismatch grows, each term's
    phase advances at a different rate across the window and they
    interfere destructively, driving the mean amplitude toward 0.
    """
    total = sum(cmath.exp(1j * (height - signature) * (i * dt)) for i in range(samples))
    return abs(total) / samples


def claims_exclusive_input(height: float, signature: float, threshold_ratio: float = 0.85) -> bool:
    """
    Spec: "input of the neuron defines wave height, and the wave is the
    neuron's signature -- when a neuron matches that signature it has
    exclusive input." (Example: "neuron 2 signature was 4.5 and height
    was 10" -- two independent scalars compared via wave interference,
    not equality.) A neuron's signature "matches" an input's height when
    their waves interfere constructively enough (mean amplitude at least
    `threshold_ratio`, out of a maximum of 1.0 at perfect resonance) --
    i.e. the neuron's natural frequency resonates with this particular
    input, so it (not some other neuron) claims exclusive routing for it.
    """
    return wave_interference(height, signature) >= threshold_ratio


# ---------------------------------------------------------------------------
# Code-as-net import: `code@name="foo"` / `"foo"@code="<code>"`.
# ---------------------------------------------------------------------------

def code_to_net(code: str, dimensions: int = 3) -> List[float]:
    """
    Spec: "Import binary/source code and turn it into a neural net that
    behaves like that code." A full compiler-to-weights pipeline is out of
    scope; what's implemented here is real and deterministic rather than a
    hardcoded stub: the code text is hashed into a reproducible small
    vector of floats in [-1, 1] that seeds the imported neuron's
    connection bias/state, so the *same* code always produces the *same*
    net (a prerequisite for "behaves like that code" -- nondeterministic
    or constant output would not qualify), and different code reliably
    produces a different net.
    """
    if not code:
        return [0.0] * dimensions
    values = []
    for i in range(dimensions):
        digest = 0
        for j, ch in enumerate(code):
            digest = (digest * 131 + ord(ch) + i * 1000003 + j) % 2_147_483_647
        values.append((digest / 2_147_483_647.0) * 2.0 - 1.0)
    return values


# ---------------------------------------------------------------------------
# Executor: wires a parsed Program into a live NeuralMesh.
# ---------------------------------------------------------------------------

@dataclass
class DSLExecutionResult:
    """Everything execute() produced, keyed by DSL neuron name."""
    neuron_ids: Dict[str, int] = field(default_factory=dict)
    definitions: Dict[str, str] = field(default_factory=dict)
    code_imports: Dict[str, List[float]] = field(default_factory=dict)
    netsearch_results: Dict[str, List[str]] = field(default_factory=dict)
    netsearch_vectors: Dict[str, Any] = field(default_factory=dict)


def literal_output(name: str, result: DSLExecutionResult) -> Optional[str]:
    """
    Spec: "Type out what the model should output if a neuron just has
    input" (the `@definition=` statement). If `name` was given a literal
    definition, that's what a neuron with no other behavior outputs when
    driven purely by input.
    """
    return result.definitions.get(name)


def execute(source: str, mesh: Optional["NeuralMesh"] = None) -> DSLExecutionResult:
    """
    Parse and run an NDL program end-to-end: creates a named neuron in
    `mesh` for every `name="..."` statement (as its own single-neuron
    expert group, so it is wired all-to-all with the rest of the mesh per
    the "all neurons are connected by default" rule), applies `@vale=`/
    `@value=` as an elastic-core stake, `@connections=` as an explicit
    weight+bias override (taking priority over the all-to-all default),
    `@definition=` as its literal output, `@code=`/`code@name=` as a
    code-as-net import, and runs every `netsearch@...` statement as a
    local design-doc search + tiny training step.

    If `mesh` is None, neurons aren't materialized anywhere (there is
    nothing to wire connections/vale into), but definitions, code imports
    and net searches are still resolved and returned -- useful for
    inspecting/validating a script without a live mesh.
    """
    program = parse_program(source)
    result = DSLExecutionResult()

    def _ensure_neuron(name: str) -> Optional[int]:
        if name in result.neuron_ids:
            return result.neuron_ids[name]
        if mesh is None:
            return None
        _, new_ids = mesh.add_expert_group(name, 1)
        nid = new_ids[0]
        result.neuron_ids[name] = nid
        return nid

    for name, neuron_def in program.neurons.items():
        nid = _ensure_neuron(name)

        if neuron_def.definition:
            result.definitions[name] = neuron_def.definition

        if neuron_def.code is not None:
            vector = code_to_net(neuron_def.code)
            result.code_imports[name] = vector
            if mesh is not None and nid is not None:
                mesh.add_dsl_bias(nid, sum(vector) / len(vector))

        if mesh is not None and nid is not None:
            if neuron_def.vale is not None:
                current = mesh.neurons[nid].vale
                mesh.redistribute_vale({nid: neuron_def.vale - current})

            for conn in neuron_def.connections:
                target_id = _ensure_neuron(conn.target)
                if target_id is None:
                    continue
                # Explicit override: "name"@connections="target*weight+bias"
                # pins the connection FROM target TO this neuron (this
                # neuron receives target's signal, weighted, plus bias),
                # matching how `compute_neuron_input` reads connections.
                mesh.set_connection_weight(target_id, nid, conn.weight)
                mesh.add_dsl_bias(nid, conn.bias)

    for request in program.netsearch_requests:
        matches = netsearch(request.net or "")
        vector = netsearch_train(matches)
        name = request.name or f"netsearch_{len(result.netsearch_results)}"
        result.netsearch_results[name] = matches
        result.netsearch_vectors[name] = vector
        if matches:
            result.definitions.setdefault(name, " / ".join(matches))

        nid = _ensure_neuron(name)
        if mesh is not None and nid is not None:
            mesh.add_dsl_bias(nid, sum(vector.sem) / len(vector.sem) if vector.sem else 0.0)

    return result
