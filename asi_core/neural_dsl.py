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

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional


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


_NAME_RE = re.compile(r'^name\s*=\s*"([^"]*)"\s*$')
_ATTR_RE = re.compile(r'^(\w+)@(\w+)\s*=\s*"([^"]*)"\s*$')
_CONN_TERM_RE = re.compile(r'^([\w.]+)\*([+-]?[\d.]+)\+([+-]?[\d.]+)$')

_KNOWN_ATTRS = {"vale", "definition", "connections", "code", "type"}


def parse(source: str) -> Dict[str, NeuronDefinition]:
    """Parse NDL source into an ordered {name: NeuronDefinition} map."""
    neurons: Dict[str, NeuronDefinition] = {}

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
            if attr not in _KNOWN_ATTRS:
                raise NDLError(f"line {lineno}: unknown attribute '@{attr}'")
            neuron = neurons.setdefault(owner, NeuronDefinition(name=owner))
            _apply_attr(neuron, attr, value, lineno)
            continue

        raise NDLError(f"line {lineno}: could not parse statement: {raw!r}")

    return neurons


def _apply_attr(neuron: NeuronDefinition, attr: str, value: str, lineno: int) -> None:
    if attr == "vale":
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
