# AI & Neural Network Basics

A plain-language primer on what this project's neural substrate actually is,
written from first principles, with each idea mapped to the file(s) that
implement it. Read this before ARCHITECTURE.md or the deep specs — it's the
"why" behind them.

## What is an AI, here?

An AI is a program built with many possible configurations, one of which
"learns" — i.e. performs well. Concretely, we represent it as a large
mathematical/geometric object (a graph of numbers) that we adjust, bit by
bit, until it does what we want.

## The basic unit: a neuron

A neuron is a placeholder — like a variable that holds a value. Neurons are
connected to each other, and every connection carries two numbers:

- **weight** — multiplies the value coming from the source neuron
- **bias** — added afterward

This is how information travels through the network: `output = weight *
input + bias`, chained across many connections. See
`asi_core/neural_core.py` for the base neuron/connection types.

Originally you pour input in at the top and it flows through like water in
a pipe, arriving at the bottom as a response. The first response out of an
untrained network is almost always bad — that's why learning exists.

## How it learns: predict, compare, nudge

The network learns by prediction. Say "hi" and it predicts "hello"; if the
prediction is wrong it's penalized, if right it's rewarded. Training works
by randomly perturbing weights and biases, keeping the perturbations that
improve predictions and discarding the ones that don't — nudging the whole
network toward configurations that perform better and away from ones that
perform worse. This is the same principle the [Extension Builder](../wiki/Builder.md)
uses for deep learning a new skill (see below).

## Parallel vs. non-parallel prediction

- **Parallel** — predicts multiple words/tokens at once. Good for
  continuing a text quickly, but has fewer opportunities to double-check
  itself along the way.
- **Non-parallel** — predicts one unit at a time and can review its own
  thinking after each step, giving more checkpoints to catch mistakes.

Continuous learning extends this beyond the next word: a non-parallel
network can predict the next paragraph, file, or image, not just the next
token — at the cost of a lot more compute.

## Elastic value: protecting good neurons

Predicting large structures (paragraphs, files) is expensive and risky —
one bad neuron could corrupt the whole network. To prevent that, every
neuron carries a **value** that indicates how much that neuron should be
allowed to change. Neurons with low value are protected from being
overwritten by bad updates; neurons with high value are the ones actively
being explored. This is implemented as the elastic, zero-sum value budget
in `asi_core/vale_system.py` — see `docs/VALE_SYSTEM.md` and
[[Elastic-Value-Budget]] in the wiki for the full spec.

## All-to-all connectivity (instead of a strict pipe)

The simple mental model — pour input in one end, read output at the other —
breaks down for long tasks: you'd have to keep re-pouring the output back
in, forming a loop, and every time the network writes its thinking to a
"notepad" (an intermediate representation) it loses information, the same
way a person loses nuance when putting a thought into words.

The fix: connect **all** neurons to each other rather than only in a strict
forward pipe. Unneeded computation is pruned cheaply by setting a
connection's weight and bias to zero, so full connectivity doesn't have to
mean full cost. This is `asi_core/neural_mesh.py` (the "neuron mesh" /
all-to-all layer referenced in the wiki as [[Neuron-Mesh]]) and is what
gives the system effectively infinite context without an explicit re-feed
loop.

## Hyperdimensional thinking

If only a few neurons light up for a given prompt, everything connected to
them gets a strong pull too — which can blur the line between a training
example and real input. The fix is to make every neuron's input a
combination of its own weight/bias *and* contributions from other neurons,
each scaled by its own bias, so the whole mesh influences every neuron
instead of a narrow path. Width added this way is "hyperdimensional";
depth/length added by stacking non-linear layers is separate.

This is deliberately close to quantum interference: each neuron carries an
associated wave, waves from connected neurons combine in a shared space,
wrong answers cancel each other out, and the answer is read off by
measuring the combined wave. Implementation: `asi_core/hyperdim_thinking.py`,
spec: `docs/HYPERDIMENSIONAL_THINKING.md`, wiki: [[Hyperdimensional]].

## The Extension Builder

Training a full model from scratch is expensive in both compute and data.
The **Extension Builder** instead lets you directly edit a neuron's output,
then runs deep learning over that edit: random variations that improve
performance are kept, detrimental ones are discarded — the same
predict/compare/nudge loop as full training, just scoped to one skill.

Building a skill follows this order:
1. Gather all relevant neurons
2. Wire up their connections
3. Set hyperdimensional connections to their default values
4. Add any specialized (task-specific) connections
5. Run deep learning with the configured parameters

If a neuron has a name, typing that name highlights it directly — useful
for inspecting or hand-editing a skill during development. A **scripted**
neuron additionally forces the agent to respond when the user says a
specific trigger phrase. See `extension-builder/`, `docs/EXTENSION_BUILDER_SPEC.md`,
and [[Builder]] / [[Extensions]] in the wiki.

## Linking skills together

The same information-loss problem that motivates all-to-all connectivity
inside one network also applies between skills: when two separately
trained skills talk to each other only through a compressed message, they
lose information, just like a person losing nuance when speaking a thought
aloud. Linking two specialized networks directly — instead of forcing them
through a narrow interface — lets them share knowledge and learn to work
together, becoming more capable together than either is alone. This is the
basis of the MoE routing between skills; see [[MoE]].

## Where to go next

| Concept | Doc | Code |
|---|---|---|
| Neurons, weights, biases | this file | `asi_core/neural_core.py` |
| All-to-all mesh | [[Neuron-Mesh]] | `asi_core/neural_mesh.py` |
| Elastic value / protecting neurons | `VALE_SYSTEM.md`, [[Elastic-Value-Budget]] | `asi_core/vale_system.py` |
| Hyperdimensional thinking | `HYPERDIMENSIONAL_THINKING.md`, [[Hyperdimensional]] | `asi_core/hyperdim_thinking.py` |
| Extension Builder / skills | `EXTENSION_BUILDER_SPEC.md`, [[Builder]], [[Extensions]] | `extension-builder/` |
| Mixture of Experts routing | [[MoE]] | `asi_core/neural_mesh.py` |
| Full architecture | `ARCHITECTURE.md` | — |
