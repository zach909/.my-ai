/**
 * Building a skill with the main model as part of it, without the main model
 * being able to change.
 *
 * This is the training system's own rule (§8, "Freezing the Main Network")
 * applied to the thing people actually do most often: making a net skill. The
 * skill is built AGAINST the main model -- it can see every neuron the main
 * model already has, which is what lets the planner say "you already have
 * this" instead of rebuilding it -- but the build writes nothing back. The
 * main model is context, not a target.
 *
 * Why enforce it rather than just intend it: the interesting failure is not a
 * build that crashes, it is a build that quietly adds a neuron to the main
 * mesh and leaves the general network slightly different than it was. Nobody
 * notices that until the model behaves differently and nothing in the history
 * explains why. So the freeze is checked: a digest before, the same digest
 * after, and a thrown error if they disagree.
 *
 * The neurons a skill produces are NOT added here. They join the mesh when
 * someone installs the skill -- which stays a click on the other machine, the
 * same as every other install.
 */

import { planRequirements, type BuildPlan, type PlannerContext } from "./requirement-planner.js";

/** The main model, seen the only way this file needs to see it. */
export interface MainModelView {
  /** Every neuron the main model currently has, by name. */
  neuronNames(): string[];
}

export interface FrozenModel {
  /** How many neurons the main model had when it was frozen. */
  neuronCount: number;
  /** Stable digest of the frozen structure; the thing that must not change. */
  digest: string;
  /** The names themselves, so a skill can be planned with the model as context. */
  names: string[];
  frozenAt: string;
}

/** Order-independent digest: the mesh is a set, not a list. */
function digestOf(names: string[]): string {
  let h = 0x811c9dc5;
  for (const name of [...names].sort()) {
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x1f; // separator, so ["ab","c"] and ["a","bc"] differ
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${names.length}:${h.toString(16)}`;
}

/** Freeze the main model: take the snapshot everything after this is checked against. */
export function freezeMainModel(view: MainModelView): FrozenModel {
  const names = view.neuronNames().slice();
  return {
    neuronCount: names.length,
    digest: digestOf(names),
    names,
    frozenAt: new Date().toISOString(),
  };
}

export class MainModelChanged extends Error {
  constructor(readonly before: string, readonly after: string) {
    super(
      `The main model changed while a skill was being built against it (${before} -> ${after}). ` +
      `A skill build is supposed to read the main model, never write to it.`,
    );
    this.name = "MainModelChanged";
  }
}

/** Throw if anything touched the main model since it was frozen. */
export function assertMainModelUnchanged(frozen: FrozenModel, view: MainModelView): void {
  const now = digestOf(view.neuronNames());
  if (now !== frozen.digest) throw new MainModelChanged(frozen.digest, now);
}

/** Words too common to count as evidence that a requirement is already covered. */
const NOISE = new Set([
  "the", "and", "for", "with", "that", "this", "should", "must", "able", "can",
  "into", "from", "when", "have", "has", "its", "our", "any", "all", "own",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(w => w.length > 2 && !NOISE.has(w));
}

/**
 * Look a requirement up in the frozen main model.
 *
 * Conservative on purpose. Claiming a requirement is already satisfied when it
 * is not means someone ships without building something they needed, so a
 * neuron only counts as covering a requirement when it accounts for most of
 * what the requirement actually says -- not one shared word.
 */
function findInFrozenModel(frozen: FrozenModel): NonNullable<PlannerContext["findExisting"]> {
  // Precomputed once per freeze rather than per requirement: the mesh can hold
  // thousands of neurons and a plan asks about every requirement in the list.
  const indexed = frozen.names.map(name => ({ name, words: new Set(contentWords(name)) }));

  return (task: string) => {
    const wanted = contentWords(task);
    if (wanted.length === 0) return [];

    const hits: Array<{ id: string; score: number; reason: string }> = [];
    for (const entry of indexed) {
      if (entry.words.size === 0) continue;
      let matched = 0;
      for (const word of wanted) if (entry.words.has(word)) matched++;
      const score = Math.round((matched / wanted.length) * 100);
      if (score >= 60) {
        hits.push({
          id: entry.name,
          score,
          reason: `the main model already has a neuron named "${entry.name}"`,
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score);
  };
}

export interface FrozenBuildPlan {
  plan: BuildPlan;
  frozen: FrozenModel;
  /** True once the main model has been checked and found unchanged. */
  verified: boolean;
}

/**
 * Plan a net skill with the frozen main model as part of the picture.
 *
 * The caller can supply its own findExisting (the capability router, which
 * knows about plugins the mesh has no neuron for); it is consulted alongside
 * the frozen model rather than instead of it, because "already true" can come
 * from either.
 */
export function planAgainstFrozenModel(
  requirements: string[],
  view: MainModelView,
  context: PlannerContext = {},
): FrozenBuildPlan {
  const frozen = freezeMainModel(view);
  const fromModel = findInFrozenModel(frozen);
  const fromCaller = context.findExisting;

  const plan = planRequirements(requirements, {
    ...context,
    findExisting: fromCaller
      ? task => [...fromModel(task), ...fromCaller(task)].sort((a, b) => b.score - a.score)
      : fromModel,
  });

  // Planning must not have moved anything. If it did, the plan is not a plan
  // against a frozen model and saying so would be a lie.
  assertMainModelUnchanged(frozen, view);
  return { plan, frozen, verified: true };
}
