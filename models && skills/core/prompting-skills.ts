/**
 * Prompting skills: the modular functions the agent calls from inside its own
 * perceive-think-act loop.
 *
 * Three categories, matching the three things a loop iteration actually needs
 * to decide:
 *
 *   perception  -- what information to collect        (the input)
 *   cognitive   -- what to think about what was found (the strategy)
 *   action      -- how to move in the world           (the output)
 *
 * These are declarative documents, not code, and that is deliberate. This
 * system has no external model to send a prompt to -- the brain is the local
 * mesh -- so a "prompting skill" here cannot mean a block of text mailed to an
 * API. It means a named, reusable decision about how one step of the loop
 * should be carried out, expressed in terms the local system can genuinely
 * execute: which memory to search, which reasoning strategy to apply, which
 * plugin to invoke.
 *
 * Declarative also means anyone can publish one without publishing executable
 * code, and installing one cannot run arbitrary code on the installer's
 * machine. A published skill names a source or a strategy or a plugin; the
 * loop is what executes it, and only through paths that already existed.
 *
 * The skills are ordinary store items (kind `prompting`), so they travel the
 * same way everything else does: published into the repository, committed and
 * pushed, available to anyone who pulls. Installing is separate and always a
 * choice -- publishing is open, running is not.
 */

/** The three categories, in the order a loop iteration uses them. */
export const PROMPTING_CATEGORIES = ["perception", "cognitive", "action"] as const;
export type PromptingCategory = (typeof PROMPTING_CATEGORIES)[number];

export const PROMPTING_CATEGORY_LABELS: Record<PromptingCategory, string> = {
  perception: "Perception",
  cognitive: "Cognitive",
  action: "Action",
};

/**
 * Where a perception skill may look. Every entry is a capability this system
 * already has; a skill cannot invent a new source, only choose among these.
 *
 * `chats` reads back real past conversations, and `web` is the only source
 * that leaves the machine. Both are ordinary sources rather than special
 * cases: a skill chooses one, and the host decides whether to expose it at
 * all. Somebody running with no network simply has no `web` capability, and a
 * skill that wanted it contributes nothing instead of failing.
 */
export const PERCEPTION_SOURCES = ["memory", "wiki", "store", "chats", "web", "plugin"] as const;
export type PerceptionSource = (typeof PERCEPTION_SOURCES)[number];

/**
 * Reasoning strategies a cognitive skill may apply. Each maps onto something
 * reasoning-engine.ts / plan-tracker.ts genuinely does.
 */
export const COGNITIVE_STRATEGIES = ["decompose", "recall-lessons", "compare-options", "plan-next-step"] as const;
export type CognitiveStrategy = (typeof COGNITIVE_STRATEGIES)[number];

export class PromptingSkillError extends Error {}

/** One prompting skill. The shape is the same for all three categories, with a category-specific body. */
export interface PromptingSkill {
  name: string;
  category: PromptingCategory;
  title: string;
  description: string;
  author: string;
  /**
   * When this skill applies. Matched case-insensitively against the goal and
   * the latest observation. Empty means "always" -- useful for a general
   * strategy, and the reason `always` is explicit rather than implied.
   */
  when: string[];
  /** Higher runs first within its category. Ties break on name, so ordering is stable. */
  priority: number;
  /** perception only: where to look, and what to look for. */
  source?: PerceptionSource;
  /** perception only: the query. `{goal}` and `{observation}` are substituted. */
  query?: string;
  /** perception with source 'plugin', and every action skill: which plugin to call. */
  plugin?: string;
  /** cognitive only. */
  strategy?: CognitiveStrategy;
  /** action only: what to send the plugin. `{goal}` and `{observation}` are substituted. */
  input?: string;
  /** action only: what the caller expected, so the observe step has something to compare against. */
  expect?: string;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Caps, for the same reason the store has them: everyone who pulls pays for what anyone publishes. */
const MAX_WHEN = 32;
const MAX_TEXT = 2000;

function str(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== "string") throw new PromptingSkillError(`"${field}" must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new PromptingSkillError(`"${field}" is longer than ${max} characters.`);
  return trimmed;
}

/**
 * Validates and normalises a skill document.
 *
 * Strict, because these arrive from the store -- anyone can publish one, and a
 * malformed skill that got as far as the loop would fail in the middle of a
 * task rather than at the door. Every category is checked for exactly the
 * fields it needs, and unknown sources/strategies are refused by name rather
 * than silently ignored, so a typo is a clear error instead of a skill that
 * quietly never fires.
 */
export function parsePromptingSkill(raw: unknown): PromptingSkill {
  if (!raw || typeof raw !== "object") throw new PromptingSkillError("A prompting skill must be a JSON object.");
  const o = raw as Record<string, unknown>;

  const name = str(o.name, "name", 64);
  if (!NAME_RE.test(name) || name.includes("..")) {
    throw new PromptingSkillError(
      `"${name}" is not a valid name — letters, digits, '.', '-' and '_' only, up to 64 characters.`,
    );
  }

  const category = str(o.category, "category", 32) as PromptingCategory;
  if (!(PROMPTING_CATEGORIES as readonly string[]).includes(category)) {
    throw new PromptingSkillError(
      `"${category}" is not a category. Use one of: ${PROMPTING_CATEGORIES.join(", ")}.`,
    );
  }

  const whenRaw = o.when ?? [];
  if (!Array.isArray(whenRaw)) throw new PromptingSkillError(`"when" must be an array of strings.`);
  if (whenRaw.length > MAX_WHEN) throw new PromptingSkillError(`"when" has more than ${MAX_WHEN} entries.`);
  const when = whenRaw.map((w, i) => str(w, `when[${i}]`, 200).toLowerCase()).filter(w => w.length > 0);

  const priorityRaw = o.priority ?? 0;
  if (typeof priorityRaw !== "number" || !Number.isFinite(priorityRaw)) {
    throw new PromptingSkillError(`"priority" must be a finite number.`);
  }

  const skill: PromptingSkill = {
    name,
    category,
    title: o.title === undefined ? name : str(o.title, "title", 200),
    description: o.description === undefined ? "" : str(o.description, "description"),
    author: o.author === undefined ? "anonymous" : str(o.author, "author", 100),
    when,
    priority: priorityRaw,
  };

  if (category === "perception") {
    const source = str(o.source, "source", 32) as PerceptionSource;
    if (!(PERCEPTION_SOURCES as readonly string[]).includes(source)) {
      throw new PromptingSkillError(
        `"${source}" is not a perception source. Use one of: ${PERCEPTION_SOURCES.join(", ")}.`,
      );
    }
    skill.source = source;
    skill.query = o.query === undefined ? "{goal}" : str(o.query, "query");
    if (source === "plugin") skill.plugin = str(o.plugin, "plugin", 100);
  } else if (category === "cognitive") {
    const strategy = str(o.strategy, "strategy", 32) as CognitiveStrategy;
    if (!(COGNITIVE_STRATEGIES as readonly string[]).includes(strategy)) {
      throw new PromptingSkillError(
        `"${strategy}" is not a strategy. Use one of: ${COGNITIVE_STRATEGIES.join(", ")}.`,
      );
    }
    skill.strategy = strategy;
  } else {
    // `plugin` is optional for an action skill. Requiring it meant a skill
    // could only say "do this" if its author already knew WHICH tool does it,
    // so the whole class of "handle this, find the tool yourself" skills could
    // not be expressed at all -- and the loop's tool discovery had nothing to
    // discover for. Naming one still wins; omitting it now means "choose".
    if (o.plugin !== undefined) skill.plugin = str(o.plugin, "plugin", 100);
    skill.input = o.input === undefined ? "{goal}" : str(o.input, "input");
    if (o.expect !== undefined) skill.expect = str(o.expect, "expect");
  }

  return skill;
}

/** Fills `{goal}` and `{observation}`. Plain replacement -- no expressions, nothing evaluated. */
export function fillTemplate(template: string, vars: { goal: string; observation?: string }): string {
  return template
    .replace(/\{goal\}/g, vars.goal)
    .replace(/\{observation\}/g, vars.observation ?? "");
}

/**
 * Whether a skill applies right now.
 *
 * A skill with no `when` always applies; otherwise any one term matching the
 * goal or the latest observation is enough. Deliberately permissive: a skill
 * that fails to fire is invisible and hard to debug, while one that fires when
 * it need not have simply contributes nothing that iteration.
 */
export function skillApplies(skill: PromptingSkill, goal: string, observation?: string): boolean {
  if (skill.when.length === 0) return true;
  const haystack = `${goal}\n${observation ?? ""}`.toLowerCase();
  return skill.when.some(term => haystack.includes(term));
}

/**
 * The installed set, in the order the loop should run them.
 *
 * Sorted by priority descending then name, so two skills at the same priority
 * always run in the same order -- an agent whose behaviour depended on
 * filesystem or insertion order would be unreproducible for no good reason.
 */
export class PromptingSkillRegistry {
  private skills = new Map<string, PromptingSkill>();

  /** Adds or replaces a skill. Replacing by name is how an edit takes effect. */
  install(skill: PromptingSkill): void {
    this.skills.set(skill.name, skill);
  }

  uninstall(name: string): boolean {
    return this.skills.delete(name);
  }

  get(name: string): PromptingSkill | undefined {
    return this.skills.get(name);
  }

  all(): PromptingSkill[] {
    return [...this.skills.values()].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  }

  /** The skills of one category that apply to this goal/observation, in run order. */
  forStep(category: PromptingCategory, goal: string, observation?: string): PromptingSkill[] {
    return this.all().filter(s => s.category === category && skillApplies(s, goal, observation));
  }

  size(): number {
    return this.skills.size;
  }
}

/**
 * The starter set: one skill per category, so a fresh install has a loop that
 * actually does something rather than three empty steps. They are ordinary
 * skills with no special status -- installable, editable, and removable like
 * any published one.
 */
export function builtInPromptingSkills(): PromptingSkill[] {
  return [
    parsePromptingSkill({
      name: "recall-what-i-know",
      category: "perception",
      title: "Recall what I already know",
      description:
        "Searches long-term memory for anything related to the goal before doing anything else, so the agent does not go looking outside for something it was already told.",
      author: "neuroclaw",
      source: "memory",
      query: "{goal}",
      priority: 100,
    }),
    parsePromptingSkill({
      name: "search-the-web-when-it-is-current",
      category: "perception",
      title: "Search the web when the answer has to be current",
      description:
        "Looks the question up on the web when it asks for something that changes over time -- today's news, a current price, the latest version. This is what makes web search automatic: the trigger list below IS the agent deciding it needs current information, and it is editable, so what counts as 'current' is not hard-coded in the engine.",
      author: "neuroclaw",
      source: "web",
      query: "{goal}",
      when: [
        "today", "latest", "current", "currently", "right now", "this week", "this year",
        "news", "recent", "recently", "price of", "weather", "who won", "release date",
        "what version", "up to date", "as of",
      ],
      priority: 95,
    }),
    parsePromptingSkill({
      name: "remember-our-past-chats",
      category: "perception",
      title: "Check what we said before",
      description:
        "Searches earlier conversations for anything about this, so a question that follows on from something you said last week does not start from nothing.",
      author: "neuroclaw",
      source: "chats",
      query: "{goal}",
      // Triggers matter here more than anywhere else. With no `when` this
      // skill applies to every message, and because a chat search is one of
      // the sources that can answer on its own, the loop then engaged for
      // EVERY message and started replying with old conversation fragments --
      // "what is the capital of France" came back as two unrelated past turns
      // instead of Paris. Past chats are worth searching when the person is
      // actually referring to the past.
      when: [
        "remember", "we talked", "we discussed", "you said", "i said", "i told you",
        "earlier", "last time", "before", "previously", "we were", "did i ask",
        "what did i", "what did we", "go back to",
      ],
      priority: 90,
    }),
    parsePromptingSkill({
      name: "break-it-down",
      category: "cognitive",
      title: "Break the goal into steps",
      description:
        "Decomposes the goal into subproblems using the reasoning engine, which is what turns a vague instruction into something the action step can actually attempt.",
      author: "neuroclaw",
      strategy: "decompose",
      priority: 100,
    }),
    parsePromptingSkill({
      name: "use-the-tools-plugin",
      category: "action",
      title: "Use the Tools plugin",
      description:
        "Hands the current step to the Tools plugin (calculation, hashing, encoding, dates). Fires only when the goal mentions something Tools genuinely covers, because an action skill that grabs every goal would starve the others.",
      author: "neuroclaw",
      plugin: "tools",
      input: "{goal}",
      expect: "a computed result rather than an explanation",
      when: ["calculate", "convert", "hash", "encode", "decode", "how many days", "uuid"],
      priority: 100,
    }),
  ];
}
