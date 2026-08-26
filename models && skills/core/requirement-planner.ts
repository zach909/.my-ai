/**
 * "Here is what I need. What is the quickest way to make it all true?"
 *
 * The Extension Builder could build a net skill once you already knew exactly
 * which neurons you wanted. It could not answer the question you actually
 * start with, which is a list of requirements and no idea which of them are
 * work and which are already done.
 *
 * So this takes requirements and produces a plan. The default answer is
 * always the same one, and that is deliberate:
 *
 *   BUILD A NET SKILL -- compile the requirements straight into neurons and
 *   wire them into the main model's own mesh, all-to-all with everything
 *   already there. The neurons become part of the main network rather than a
 *   separate thing it consults, and building one costs a click rather than a
 *   training run. This is what the builder does unless someone asks for
 *   something else.
 *
 *   TRAIN A NEW NETWORK -- the other button. Build neurons and train them
 *   against examples until the behaviour is learned. Slower, and worth it when
 *   a requirement describes something the network has to get GOOD at rather
 *   than something it can be told. The plan says which requirements those are,
 *   so the choice is informed -- but it does not make the choice for you, and
 *   it never quietly turns a skill build into a training run.
 *
 * The third answer is the one worth having and the easiest to forget to ask
 * for: SOME REQUIREMENTS ARE ALREADY TRUE. The quickest way to satisfy "search
 * the web" is not to build anything -- it is to notice there is already a
 * plugin for it. A planner that cannot say "you already have this" will
 * cheerfully rebuild the system's existing capabilities, which is the most
 * expensive possible way to make a requirement true.
 */

export type RequirementRoute = "already-satisfied" | "net-skill" | "train";

export interface RequirementPlan {
  requirement: string;
  route: RequirementRoute;
  /** Why this route, in words someone can disagree with. */
  reason: string;
  /** For already-satisfied: what satisfies it. */
  satisfiedBy?: string;
  /**
   * True when this requirement is a capability -- something the network has to
   * get good at. A net skill can still state it, and often that is enough; but
   * this is the honest flag saying examples would teach it better.
   */
  betterWithTraining: boolean;
  /** For net-skill and train: the neurons this requirement contributes. */
  neurons: Array<{ name: string; definition: string }>;
  /** Rough relative effort, for ordering rather than for promising a duration. */
  effort: number;
}

export interface BuildPlan {
  requirements: RequirementPlan[];
  /** The route the builder will take unless told otherwise. Always the skill route. */
  recommended: Exclude<RequirementRoute, "already-satisfied">;
  /** The other button, and which requirements would actually benefit from it. */
  alternative: {
    route: "train";
    /** Requirements that would be learned better from examples than stated. */
    requirements: string[];
    reason: string;
  };
  /** Why the recommendation is what it is. */
  rationale: string;
  /** Requirements that need nothing built. */
  alreadySatisfied: number;
  /** Every neuron the build would create, deduped. */
  neurons: Array<{ name: string; definition: string }>;
  /** NeuroLang that produces those neurons, so the plan is inspectable and editable. */
  neuroLang: string;
}

/** Words that mean "the system has to get good at this" rather than "it has to know this". */
const CAPABILITY_WORDS = [
  "learn", "improve", "optimi", "predict", "classify", "recognis", "recogniz",
  "generate", "translate", "summaris", "summariz", "detect", "score", "rank",
  "train", "adapt", "generalis", "generaliz",
];

/** Turn a requirement into a neuron name that is stable and readable. */
// Not exported: a caller wants a plan, not a naming scheme, and an export
// nothing outside this file calls is how dead code starts looking finished.
function neuronNameFor(requirement: string): string {
  const cleaned = requirement
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !["the", "and", "for", "with", "that", "should", "must", "able", "can"].includes(w))
    .slice(0, 4)
    .join("-");
  return cleaned || `requirement-${Math.abs(hash(requirement)) % 10_000}`;
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

export interface PlannerContext {
  /**
   * What this machine can already do, best first, for a described task.
   * Supplied by the caller so the planner does not have to know about the
   * plugin registry or the main model -- and so it can be tested without one.
   */
  findExisting?: (task: string) => Array<{ id: string; score: number; reason: string }>;
  /** Score above which an existing capability is treated as genuinely covering the requirement. */
  satisfiedThreshold?: number;
}

/**
 * Work out the quickest way to make every requirement true.
 *
 * Deliberately conservative about "already satisfied": a wrong claim there
 * means someone ships without building something they needed, which is worse
 * than building something they already had.
 */
export function planRequirements(requirements: string[], context: PlannerContext = {}): BuildPlan {
  const threshold = context.satisfiedThreshold ?? 20;
  const plans: RequirementPlan[] = [];

  for (const raw of requirements) {
    const requirement = raw.trim();
    if (!requirement) continue;

    const existing = context.findExisting?.(requirement) ?? [];
    const best = existing[0];
    if (best && best.score >= threshold) {
      plans.push({
        requirement,
        route: "already-satisfied",
        reason: `"${best.id}" already handles this (${best.reason}). Building it again would be the slowest way to make it true.`,
        satisfiedBy: best.id,
        betterWithTraining: false,
        neurons: [],
        effort: 0,
      });
      continue;
    }

    const lower = requirement.toLowerCase();
    const betterWithTraining = CAPABILITY_WORDS.some(word => lower.includes(word));
    const name = neuronNameFor(requirement);

    // Note the route: a capability requirement still becomes a net skill,
    // because that is the default and it does produce something that works.
    // betterWithTraining is the honest caveat, not a veto.
    plans.push({
      requirement,
      route: "net-skill",
      reason: betterWithTraining
        ? "Stated as neurons and wired into the main model. This is something the network has to get GOOD at, so examples would teach it better -- training is the other button if the skill is not sharp enough."
        : "This can be stated directly as neurons and wired into the main model, so it does not need a training run.",
      betterWithTraining,
      neurons: [{ name, definition: requirement }],
      effort: betterWithTraining ? 2 : 1,
    });
  }

  const alreadySatisfied = plans.filter(p => p.route === "already-satisfied").length;
  const needBuilding = plans.filter(p => p.route !== "already-satisfied");
  const wouldTrainBetter = needBuilding.filter(p => p.betterWithTraining);

  // Deduped: two requirements can reasonably reduce to the same neuron.
  const seen = new Set<string>();
  const neurons: Array<{ name: string; definition: string }> = [];
  for (const plan of plans) {
    for (const neuron of plan.neurons) {
      if (seen.has(neuron.name)) continue;
      seen.add(neuron.name);
      neurons.push(neuron);
    }
  }

  const rationale =
    needBuilding.length === 0
      ? `Nothing needs building. Everything here is already satisfied by what this machine has.`
      : `${needBuilding.length} requirement${needBuilding.length === 1 ? "" : "s"} still ${needBuilding.length === 1 ? "needs" : "need"} building, and a net skill states ${needBuilding.length === 1 ? "it" : "them"} directly -- no training run, and the neurons become part of the main model's mesh rather than something it consults.${alreadySatisfied > 0 ? ` ${alreadySatisfied} already true, so nothing is rebuilt for ${alreadySatisfied === 1 ? "it" : "them"}.` : ""}`;

  return {
    requirements: plans,
    recommended: "net-skill",
    alternative: {
      route: "train",
      requirements: wouldTrainBetter.map(p => p.requirement),
      reason:
        wouldTrainBetter.length === 0
          ? "Nothing here describes something the network has to get good at, so training would buy nothing a stated skill does not already give you."
          : `${wouldTrainBetter.length} requirement${wouldTrainBetter.length === 1 ? "" : "s"} describe${wouldTrainBetter.length === 1 ? "s" : ""} something the network has to get GOOD at, which examples teach and a definition cannot. Train a new network if the skill turns out not to be sharp enough.`,
    },
    rationale,
    alreadySatisfied,
    neurons,
    neuroLang: toNeuroLang(neurons),
  };
}

/**
 * Render neurons as NeuroLang, so the plan lands in the builder's own editor
 * rather than in some format only this file understands. Someone should be
 * able to read what was proposed, change it, and build that instead.
 */
function toNeuroLang(neurons: Array<{ name: string; definition: string }>): string {
  if (neurons.length === 0) return "";
  const lines: string[] = [];
  for (const neuron of neurons) {
    lines.push(`name="${neuron.name}"`);
    if (neuron.definition) lines.push(`"${neuron.name}"@definishon="${neuron.definition.replace(/"/g, "'")}"`);
  }
  // Connected to each other, because a net skill's value is its connections.
  // A pile of unconnected neurons is a list, not a network.
  for (let i = 0; i < neurons.length - 1; i++) {
    lines.push(`"${neurons[i].name}"@connections=".${neurons[i + 1].name}"`);
  }
  return lines.join("\n");
}
