/**
 * Connecting a net skill to the main network.
 *
 * "The idea behind the net skills: you have a neural network that is
 * specialized in something and you connect it directly neuron-to-neuron into
 * the agent or core AI of the program. This is not prompting skills."
 *
 * That was not what installing a skill did. A built extension's neurons were
 * turned into sentences and written into long-term memory -- "<name>: <what it
 * means>" -- and the network itself never changed. The agent could RECALL the
 * skill's description; it could not compute with it. That is a prompting skill
 * wearing a net skill's name, which is exactly the thing the architecture
 * separates.
 *
 * So this grafts. The skill's neurons join the running mesh, all-to-all with
 * every neuron already there, and every connection they arrive with carries
 * the same equation every existing connection does:
 *
 *     its own weight and bias,
 *   + the whole network's weight and bias, through each neuron's own variable,
 *   + the wave copies of both, into the shared pool.
 *
 * Nothing about the skill is special-cased once it is in. That is the point of
 * putting it in: from the first tick after the graft, its neurons are computed
 * by the same non-linear all-connected structure as the rest, and they learn
 * with it.
 *
 * The memory text stays, and is not the mechanism. It is how a person and the
 * router find the skill by name; the neurons are how the network thinks with
 * it.
 */

import type { HyperDimensionalEngine } from "./onebrain.js";
import { MIN_WAVE_FREQ, MAX_WAVE_FREQ } from "./onebrain.js";
import { embedText } from "./neuro-lang.js";

/** One neuron as the Extension Builder saves it. */
export interface SkillNeuron {
  name?: string;
  definition?: string;
  /**
   * The wave this neuron carries, when the skill says so.
   *
   * Usually it should not: derived from the definition, neurons meaning the
   * same thing land on the same frequency and reinforce, which is the whole
   * mechanism. Say it by hand for the case meaning cannot express -- two
   * neurons that must be exact opposites, the same frequency half a cycle
   * apart, the way the Zip Loop's one and zero are perfect enemies.
   */
  wave?: { frequency?: number; phase?: number } | null;
  /**
   * What this neuron feeds, by name, and how strongly -- the skill's own
   * internal structure. Accepted in both shapes the builder's artifacts use.
   */
  connections?: Record<string, number> | Array<{ to?: string; target?: string; weight?: number }>;
}

export interface GraftResult {
  /** Neurons actually added this time. Zero when the skill was already in. */
  added: number;
  /** Every neuron of this skill, by name, wherever it lives in the mesh. */
  ids: Record<string, number>;
  /** Connections wired from the skill's own structure. */
  connections: number;
  /** The mesh's size after the graft. */
  neuronCount: number;
  /** Set when nothing was grafted, and why. */
  skipped?: string;
}

/**
 * How many neurons one skill may bring, and how big the mesh may get.
 *
 * The mesh is all-to-all, so a settle costs O(neurons^2 x dimensions). Measured
 * at 64 dimensions: 64 neurons is 24ms a tick, 164 is 66ms, 376 is 339ms --
 * against a continuous loop that fires every 200ms. Growth is not free and it
 * is not linear.
 *
 * That matters most for the skills nobody chose to install one at a time. The
 * conversation-learning extension writes itself a neuron or two per exchange
 * and is re-grafted on every boot; without a bound it would enlarge the mesh
 * forever, and the agent would get slower every day it was used with nobody
 * ever having asked for that.
 *
 * So both are capped, and a refusal is REPORTED rather than silent -- a skill
 * that half-joined and said nothing would be the worst of both.
 */
export const MAX_NEURONS_PER_SKILL = 256;
export const MAX_MESH_NEURONS = 1024;

/**
 * Which skills are already in which engine.
 *
 * Installing the same skill twice must not grow the network twice: the second
 * install is the same skill, and a mesh that gained neurons every time someone
 * clicked Install would grow without bound while learning nothing. Held per
 * engine and weakly, so a discarded engine takes its registry with it.
 */
const grafted = new WeakMap<HyperDimensionalEngine, Map<string, Record<string, number>>>();

function registryFor(engine: HyperDimensionalEngine): Map<string, Record<string, number>> {
  let registry = grafted.get(engine);
  if (!registry) {
    registry = new Map();
    grafted.set(engine, registry);
  }
  return registry;
}

/**
 * The wave a neuron gets for meaning what it means.
 *
 * A grafted neuron has to have a wave -- it is in the pool with everything
 * else, and a neuron with no wave of its own is a neuron the rest of the
 * network cannot hear. The question is which one, and "wherever the next slot
 * falls" wastes the mechanism.
 *
 * So the wave comes from the definition. That buys three things the engine's
 * own spread cannot:
 *
 *   - Two neurons that mean the same thing land on the SAME frequency, and
 *     two waves at one frequency add. Agreement is magnified, which is the
 *     property the whole wave idea is for -- and it now happens between a
 *     skill and whatever the network already knew, not just within one skill.
 *   - The same skill grafted into two different machines gets the same waves,
 *     so a shared skill sounds the same wherever it is installed. Random
 *     placement would make a published skill a different skill on every
 *     machine that installed it.
 *   - Neurons that mean different things land apart and stop drowning each
 *     other out.
 *
 * Frequency from the whole definition; phase from it too, so two different
 * definitions that happen to collide in the band are still very unlikely to
 * arrive in step.
 */
export function waveForMeaning(text: string): { frequency: number; phase: number } {
  let hash = 0;
  let mix = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    hash = (hash * 31 + code) | 0;
    // A second, differently-weighted pass so phase is not a function of
    // frequency -- one hash used twice would put every colliding pair in step.
    mix = (mix * 131 + code * (i + 7)) | 0;
  }
  const spread = (Math.abs(hash) % 100_000) / 100_000;
  const turn = (Math.abs(mix) % 100_000) / 100_000;
  return {
    frequency: MIN_WAVE_FREQ + spread * (MAX_WAVE_FREQ - MIN_WAVE_FREQ),
    phase: turn * Math.PI * 2,
  };
}

/** Normalise both connection shapes into (targetName, weight) pairs. */
function connectionsOf(neuron: SkillNeuron): Array<[string, number]> {
  const raw = neuron.connections;
  if (!raw) return [];
  const pairs: Array<[string, number]> = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const to = entry?.to ?? entry?.target;
      if (typeof to !== "string" || !to) continue;
      const weight = typeof entry.weight === "number" ? entry.weight : 1;
      pairs.push([to, weight]);
    }
    return pairs;
  }
  for (const [to, weight] of Object.entries(raw)) {
    if (typeof weight === "number") pairs.push([to, weight]);
  }
  return pairs;
}

/**
 * Set one grafted neuron up for what it means: its state, the direction it
 * answers to, its wave, and the region it belongs to. Shared by the first
 * graft and by updateNetSkill(), so a neuron edited live is placed exactly
 * the way a freshly grafted one is.
 */
function placeNeuron(engine: HyperDimensionalEngine, id: number, neuron: SkillNeuron & { name: string }, skillName: string): void {
  const dims = engine.getDimensions();
  const definition = (neuron.definition ?? "").trim();
  const meaning = definition || neuron.name;
  if (definition) {
    // Where its meaning points. A neuron that began at random would be a
    // neuron the skill contributed nothing to.
    engine.setNeuronState(id, embedText(definition, dims));
  }
  // And what makes it ANSWER to that meaning rather than merely start
  // there. A state is recomputed from its inputs on every tick, so seeding
  // it places a neuron for exactly one iteration and then the Zip Loop
  // overwrites it -- measured, [0.9,-0.9,...] reads [0.01,-0.02,...] one
  // tick later. Incoming weights survive, and they are what decides whether
  // this neuron does anything when its meaning arrives.
  //
  // Without this, "the next time the AI encounters that type of file, the
  // wave can reach the newly created capability" was not true: the skill
  // was in the mesh, connected to everything, and deaf to the one thing it
  // was built for.
  engine.tuneNeuronTo(id, 0, embedText(meaning, dims));
  // And the wave it carries. A grafted neuron is in the shared pool with
  // everything else from its first tick; this decides what it sounds like
  // there.
  //
  // What the skill asked for, if it asked; otherwise the wave its meaning
  // asks for, falling back to its name when it has no definition --
  // something it means is better than nowhere in the band.
  const asked = neuron.wave;
  const derived = waveForMeaning(definition || neuron.name);
  const frequency = typeof asked?.frequency === "number" && Number.isFinite(asked.frequency)
    ? asked.frequency
    : derived.frequency;
  const phase = typeof asked?.phase === "number" && Number.isFinite(asked.phase)
    ? asked.phase
    : derived.phase;
  engine.setWaveSignature(id, frequency, phase);
  // And which skill it belongs to. Without this a grafted skill is a pile
  // of neurons that happen to have arrived together: the engine's own
  // gating could not select it, and nothing could ask how close it had
  // grown to another skill. A Net Skill is a REGION, and this is the only
  // thing that makes it one.
  engine.setNeuronGroup(id, skillName);
}

/**
 * Graft one skill into one engine.
 *
 * Idempotent by skill name: asked twice, the second call reports the ids the
 * first one created and adds nothing.
 */
export function graftNetSkill(
  engine: HyperDimensionalEngine,
  skillName: string,
  neurons: SkillNeuron[],
): GraftResult {
  const registry = registryFor(engine);
  const already = registry.get(skillName);
  if (already) {
    return {
      added: 0,
      ids: { ...already },
      connections: 0,
      neuronCount: engine.getNeuronCount(),
      skipped: `"${skillName}" is already part of this network`,
    };
  }

  const named = neurons.filter((n): n is SkillNeuron & { name: string } =>
    typeof n?.name === "string" && n.name.trim().length > 0);
  if (named.length === 0) {
    return { added: 0, ids: {}, connections: 0, neuronCount: engine.getNeuronCount(), skipped: "no named neurons to graft" };
  }

  // What there is room for. A skill bigger than the cap contributes its first
  // neurons rather than none: a partial graft that says so is more useful than
  // a refusal, and the neurons a builder lists first are the ones it built
  // first.
  const roomInMesh = MAX_MESH_NEURONS - engine.getNeuronCount();
  const allowed = Math.max(0, Math.min(named.length, MAX_NEURONS_PER_SKILL, roomInMesh));
  if (allowed === 0) {
    return {
      added: 0,
      ids: {},
      connections: 0,
      neuronCount: engine.getNeuronCount(),
      skipped: roomInMesh <= 0
        ? `the network is full at ${MAX_MESH_NEURONS} neurons -- nothing was grafted`
        : "no room for this skill",
    };
  }
  const trimmed = allowed < named.length
    ? `only ${allowed} of ${named.length} neurons joined (cap: ${MAX_NEURONS_PER_SKILL} per skill, ${MAX_MESH_NEURONS} in the mesh)`
    : undefined;
  named.length = allowed;

  const ids = engine.addNeurons(named.length);
  if (ids.length === 0) {
    return { added: 0, ids: {}, connections: 0, neuronCount: engine.getNeuronCount(), skipped: "the network refused to grow" };
  }

  const byName: Record<string, number> = {};
  named.forEach((neuron, index) => {
    const id = ids[index];
    byName[neuron.name] = id;
    placeNeuron(engine, id, neuron, skillName);
  });

  // The skill's own structure, so it arrives as a network rather than as a
  // pile of neurons that happen to have been added together.
  let connections = 0;
  for (const neuron of named) {
    const from = byName[neuron.name];
    for (const [targetName, weight] of connectionsOf(neuron)) {
      const to = byName[targetName];
      if (to === undefined) continue; // names something outside the skill
      if (engine.setConnection(to, from, weight)) connections++;
    }
  }

  registry.set(skillName, byName);
  return { added: ids.length, ids: byName, connections, neuronCount: engine.getNeuronCount(), skipped: trimmed };
}

/** Which skills this engine is carrying, and where each one's neurons live. */
export function graftedSkills(engine: HyperDimensionalEngine): Array<{ skill: string; ids: Record<string, number> }> {
  const registry = grafted.get(engine);
  if (!registry) return [];
  return Array.from(registry, ([skill, ids]) => ({ skill, ids: { ...ids } }));
}

export interface UpdateResult extends GraftResult {
  /** Neurons already in the region that were re-placed for their (possibly edited) meaning. */
  updated: number;
  /** Neurons that left the skill: detached from the region, their skill connections zeroed. */
  removed: number;
}

/**
 * Bring an already-grafted skill in line with its current definition: the
 * Extension Builder's live path, so a skill being built IS the region of the
 * running mesh rather than a project that joins it on install.
 *
 * - New neurons are added to the mesh and placed like a first graft.
 * - Existing ones are re-placed (meaning, wave, region), so an edited
 *   definition takes effect immediately.
 * - Neurons no longer in the skill leave the region and lose their
 *   connections within it. They stay in the mesh (all-to-all neurons are not
 *   deleted), but belong to no skill and carry none of its structure.
 * - The skill's internal connections are rewritten to exactly what it
 *   declares now: removed connections go to zero, others take their weight.
 *
 * A skill that was never grafted is grafted.
 */
export function updateNetSkill(
  engine: HyperDimensionalEngine,
  skillName: string,
  neurons: SkillNeuron[],
): UpdateResult {
  const registry = registryFor(engine);
  const existing = registry.get(skillName);
  if (!existing) return { ...graftNetSkill(engine, skillName, neurons), updated: 0, removed: 0 };

  const named = neurons.filter((n): n is SkillNeuron & { name: string } =>
    typeof n?.name === "string" && n.name.trim().length > 0);
  const byName: Record<string, number> = {};
  let updated = 0;
  const fresh: Array<SkillNeuron & { name: string }> = [];
  for (const neuron of named) {
    const id = existing[neuron.name];
    if (id === undefined) { fresh.push(neuron); continue; }
    byName[neuron.name] = id;
    placeNeuron(engine, id, neuron, skillName);
    updated++;
  }

  let added = 0;
  let skipped: string | undefined;
  if (fresh.length > 0) {
    const room = Math.max(0, Math.min(fresh.length, MAX_NEURONS_PER_SKILL - Object.keys(byName).length, MAX_MESH_NEURONS - engine.getNeuronCount()));
    if (room < fresh.length) skipped = `only ${room} of ${fresh.length} new neurons joined (cap: ${MAX_NEURONS_PER_SKILL} per skill, ${MAX_MESH_NEURONS} in the mesh)`;
    const ids = room > 0 ? engine.addNeurons(room) : [];
    ids.forEach((id, index) => {
      const neuron = fresh[index];
      byName[neuron.name] = id;
      placeNeuron(engine, id, neuron, skillName);
    });
    added = ids.length;
  }

  // Neurons that left: out of the region, and none of the skill's structure.
  const kept = new Set(Object.values(byName));
  let removed = 0;
  for (const [name, id] of Object.entries(existing)) {
    if (byName[name] === id || kept.has(id)) continue;
    engine.clearNeuronGroup(id, skillName);
    for (const other of Object.values(existing)) {
      if (other === id) continue;
      engine.setConnection(other, id, 0);
      engine.setConnection(id, other, 0);
    }
    removed++;
  }

  // Internal structure exactly as declared now.
  const members = Object.values(byName);
  for (const to of members) for (const from of members) if (to !== from) engine.setConnection(to, from, 0);
  let connections = 0;
  for (const neuron of named) {
    const from = byName[neuron.name];
    if (from === undefined) continue;
    for (const [targetName, weight] of connectionsOf(neuron)) {
      const to = byName[targetName];
      if (to === undefined) continue;
      if (engine.setConnection(to, from, weight)) connections++;
    }
  }

  registry.set(skillName, byName);
  return { added, ids: { ...byName }, connections, neuronCount: engine.getNeuronCount(), skipped, updated, removed };
}
