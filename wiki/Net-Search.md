# Net Search

Performs a semantic search using a provided definition and trains a neural network capable of reproducing that behaviour — the design notes' "Net Search performs semantic searches across neural definitions, then uses deep learning to generate a neural network that performs the requested behavior."

## Overview

**Purpose**: Find semantically related definitions across the mesh's own vocabulary, then train a small dedicated retrieval network from that search, rather than only ever returning a static ranked list.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `extension-builder/builder.ts` — `netSearch`, `netSearchGenerate` | Semantic search plus a generated `netsearch`-type neuron wired to its matches |
| Python training core | `tinygpt/neurolang.py` — `NetSearchManager` | Deterministic TF-IDF ranking *and* a trained deep-learning retrieval net, side by side |

## `NetSearchManager` (Python)

```python
from neurolang import NetSearchManager

mgr = NetSearchManager("my-search")
mgr.add_corpus(doc_text)          # index a document/definition into the corpus
mgr.train(epochs=200, lr=1e-3)    # train the retrieval net over the indexed corpus
mgr.neural_search(query)          # the deep-learning retrieval net's scored results (prints them)
hard = mgr.hard_search(query)     # deterministic TF-IDF ranking, for comparison / fallback
```

Both search paths are real and run side by side deliberately: `hard_search` is a deterministic, always-available TF-IDF ranking (no training required, useful as a sanity check or fallback), while `neural_search` is the actual deep-learning mechanism the design notes describe — a small network trained specifically to retrieve from *this* corpus, which can pick up on semantic relationships TF-IDF's exact-term matching would miss.

## The NeuroLang directive form

```text
"netsearch"@name="my-search"
"netsearch"@net="path/to/corpus"
```

`@net=` binds to the most recently pending `netsearch`@name= definition in parse order — a real, tested edge case (an earlier pending `netsearch` is not mis-bound by a later `@net=`), since a NeuroLang program can declare more than one search in sequence.

## In the visual editor ([[Builder]])

`netSearchGenerate(projectId, query, topK)` runs the search and, if there are matches, creates a new `netsearch`-type neuron and wires it to each match with a weighted edge automatically — turning a search result directly into a permanent part of the graph rather than a one-off query response. It returns `null` for an empty or untokenizable query, and `null` when there are zero semantic matches, rather than fabricating a result.

## Verifying it

`python test_core.py`'s `test_net_search` covers indexing, training, and both search modes on a real corpus. `npm test` (`test/smoke.mjs`)'s Extension Builder section covers `netSearchGenerate`'s neuron creation, its weighted wiring to each match, and both null-result edge cases explicitly.

## See Also

- [[Home]] - Main wiki page
- [[Builder]] - Where Net Search sits alongside Code-to-Net and the visual editor
- [[NeuroLang]] - The `netsearch@` directive syntax
- [[Neuron-Mesh]] - What a generated `netsearch` neuron connects into

---

*Net Search doesn't just rank what's already there — it trains a small network dedicated to finding it again.*
