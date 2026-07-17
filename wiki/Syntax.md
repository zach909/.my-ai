# NeuroLang Syntax Reference

A condensed cheat-sheet for the [[NeuroLang]] directive grammar, plus the spec-literal / dialect aliasing that page doesn't cover.

## Quick reference

| Directive | Purpose |
|---|---|
| `name="x"` | Create and name a neuron |
| `"x"@vale="n"` / `"x"@value="n"` | Set elastic-core value ([[Elastic-Value-Budget]]) |
| `"x"@connections=".y/var"*"bias"+"weight"` | Explicit connection (defaults to all-to-all if omitted) |
| `"x"@definishon="d"` / `"x"@definition="d"` | Output when the neuron alone has input |
| `code@name="x"` | Name a [[Code-to-Net]] import |
| `"x"@code="src"` | Attach the source/binary to import |
| `"netsearch"@name="x"` | Name a [[Net-Search]] definition |
| `"netsearch"@net="path"` | Corpus location for that search |
| `train` | Run training over the contracts defined so far |

## Spec-literal vs. dialect spelling

Two spellings exist for the same two directives, and both are accepted everywhere:

- `@vale=` (dialect) and `@value=` (spec-literal, matching the design notes' exact wording) are aliases for the same elastic-core value directive.
- `@definishon=` (dialect) and `@definition=` (spec-literal) are aliases for the same output-definition directive.

This isn't an accident of two competing implementations — `tinygpt/neurolang.py`'s parser explicitly accepts both spellings for the same field, added specifically so a program written against the design notes' literal wording and one written in the dialect the rest of the codebase (and `wiki/NeuroLang.md`'s examples) uses both parse identically. `test_core.py`'s `test_neurolang_spec_aliases` verifies both spellings produce the same neuron state.

## `@net=` binding order

`"netsearch"@net=` binds to the most recently declared *pending* `"netsearch"@name=` in parse order — a real, tested edge case: if two `netsearch` definitions are declared before either gets its `@net=`, an earlier pending one is not mis-bound by a later `@net=` meant for the second. See [[Net-Search]].

## See Also

- [[Home]] - Main wiki page
- [[NeuroLang]] - The full directive reference with worked examples
- [[Code-to-Net]] - The `code@`/`@code=` directives in depth
- [[Net-Search]] - The `netsearch@` directives in depth
- [[Builder]] - The visual editor that can generate this syntax for you

---

*Two spellings, one parser, one behaviour — write the design notes' literal syntax or the dialect, interchangeably.*
