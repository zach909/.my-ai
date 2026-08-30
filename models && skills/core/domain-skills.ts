/**
 * The eight domains this agent is trained on, as neurons in the mesh.
 *
 * A drill generator teaches; a net skill is the place the teaching lands.
 * Without a region of its own, every domain trains the same undifferentiated
 * mesh, and "the agent got better at operating systems" is unfalsifiable --
 * there is nothing to point at that is the operating-systems part.
 *
 * So each domain gets a named region of neurons, grafted into the one mesh
 * rather than built as a separate network. That is what a Net Skill is: not a
 * model beside the model, but more neurons in it. Regions may overlap, and
 * the connections between two that keep firing together strengthen, which is
 * how a combination of expertise forms without anyone designing one.
 *
 * Sized rather than uniform. Domains differ in how much distinct structure
 * they have to hold, and giving eight regions the same eight neurons each
 * would encode a guess that they are equally complex, which they are not.
 */

import { graftNetSkill, type GraftResult, type SkillNeuron } from "./net-skill-graft.js";
import type { HyperDimensionalEngine } from "./onebrain.js";

/** One trainable domain: what it is called, and what its neurons stand for. */
export interface DomainSkill {
  /** The slug drill-generators/index.mjs classifies topics into. */
  category: string;
  title: string;
  /** What each neuron in the region is for. One entry, one neuron. */
  concepts: string[];
}

/**
 * The eight domains, plus arithmetic, which already had a generator and is
 * the one the rest were modelled on.
 *
 * The concept lists are not decoration -- graftNetSkill turns each into a
 * neuron whose wave frequency is derived from its definition, so two concepts
 * that mean similar things land near each other in the pool and reinforce.
 * Naming them badly would put unrelated ideas on the same frequency.
 */
export const DOMAIN_SKILLS: DomainSkill[] = [
  {
    category: "coding",
    title: "Coding",
    concepts: [
      "iteration and loop accumulation",
      "recursion and base cases",
      "array transformation pipelines",
      "algorithmic complexity counting",
      "string manipulation",
      "control flow and branching",
      "state mutation and scope",
      "debugging by reproduction",
    ],
  },
  {
    category: "logic",
    title: "Logic",
    concepts: [
      "propositional connectives",
      "truth table enumeration",
      "tautology and contradiction",
      "logical equivalence",
      "valid inference forms",
      "quantifier scope",
    ],
  },
  {
    category: "building-ai",
    title: "Building AI",
    concepts: [
      "weighted sum and bias",
      "activation functions",
      "softmax normalization",
      "loss functions",
      "gradient of a loss",
      "backward propagation of error",
      "layer shapes and parameter counts",
      "convolution geometry",
      "attention scoring",
      "overfitting and held-out evaluation",
    ],
  },
  {
    category: "classical-computers",
    title: "Building classical computers",
    concepts: [
      "two's complement representation",
      "cache hierarchy and locality",
      "average memory access time",
      "instruction mix and cycles per instruction",
      "pipelining and hazards",
      "Amdahl's law and speedup limits",
      "address decoding",
      "adder and carry propagation",
    ],
  },
  {
    category: "quantum-computers",
    title: "Building quantum computers",
    concepts: [
      "qubit state amplitudes",
      "state normalization",
      "superposition",
      "quantum gates as unitaries",
      "entanglement",
      "measurement probability",
      "decoherence and error correction",
      "Grover and Shor speedups",
    ],
  },
  {
    category: "operating-systems",
    title: "Building operating systems",
    concepts: [
      "process scheduling policies",
      "context switching",
      "virtual memory and paging",
      "page replacement algorithms",
      "address translation",
      "concurrency and mutual exclusion",
      "deadlock conditions",
      "file systems and disk scheduling",
      "system calls and privilege",
    ],
  },
  {
    category: "building-apps",
    title: "Building apps",
    concepts: [
      "pagination boundaries",
      "retry and exponential backoff",
      "caching and expiry",
      "event debouncing and throttling",
      "layout and space distribution",
      "state machines and transitions",
      "input validation",
    ],
  },
  {
    category: "science",
    title: "Science",
    concepts: [
      "hypothesis and falsification",
      "measurement and uncertainty",
      "conservation laws",
      "molar mass and stoichiometry",
      "gravitation and orbital scale",
      "optics and refraction",
      "wave interference",
      "units and dimensional analysis",
    ],
  },
];

/** What building the domain regions did. */
export interface DomainBuildResult {
  category: string;
  title: string;
  added: number;
  ids: Record<string, number>;
  skipped?: string;
}

/**
 * Graft every domain that is not already in the mesh.
 *
 * Idempotent: graftNetSkill refuses a skill it already holds and says so, so
 * running this on every boot adds each region exactly once. That matters more
 * than it sounds -- an agent that re-grafted on every start would grow the
 * mesh without bound and hit MAX_MESH_NEURONS with eight copies of itself.
 */
export function buildDomainSkills(engine: HyperDimensionalEngine): DomainBuildResult[] {
  return DOMAIN_SKILLS.map(domain => {
    const neurons: SkillNeuron[] = domain.concepts.map(concept => ({
      name: `${domain.category}:${concept.replace(/\s+/g, "-")}`,
      definition: concept,
    }));
    const result: GraftResult = graftNetSkill(engine, domain.title, neurons);
    return {
      category: domain.category,
      title: domain.title,
      added: result.added,
      ids: result.ids,
      skipped: result.skipped,
    };
  });
}

/** How many neurons the full set of domains asks for. */
export function totalDomainNeurons(): number {
  return DOMAIN_SKILLS.reduce((sum, d) => sum + d.concepts.length, 0);
}
