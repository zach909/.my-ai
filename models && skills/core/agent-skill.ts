/**
 * Agent Skills: a SKILL.md and the files beside it.
 *
 * This is the format the example in this project was given in, and for a while
 * nothing here understood it. The example was filed under `skills/` -- the kind
 * meant for neuron weights -- while the `prompting/` kind accepted only a
 * narrow JSON schema that cannot express it, and activation looked exclusively
 * for neuron JSON. So installing one reported "carries nothing this system
 * knows how to load" about a file whose entire content is what to load.
 *
 * An Agent Skill is a prompting skill. It does not carry weights; it carries
 * instructions that shape how an agent behaves, plus optional scripts,
 * references and assets. The shape is:
 *
 *     ---
 *     name: skill-creator
 *     description: Create new skills... Use when users want to...
 *     ---
 *
 *     # Skill Creator
 *     ...the instructions...
 *
 * The `description` is doing something specific and worth naming: it is the
 * TRIGGER. "Use when users want to create a skill from scratch" is a statement
 * about when these instructions apply, which is exactly the question a router
 * asks. The body is what to do once they do. That maps onto the (trigger,
 * response) pair the rest of this system already uses, which is why an Agent
 * Skill can be loaded without inventing a new execution model for it.
 *
 * Frontmatter is parsed rather than YAML-libraried: the format is two or three
 * scalar keys, and adding a YAML dependency to read `name:` would be a poor
 * trade in a project whose whole point is that it needs no dependencies. Keys
 * this parser does not understand are preserved as raw text rather than
 * dropped, so nothing is silently lost.
 */

export interface AgentSkill {
  name: string;
  /** What it is for, and when to use it. This is the trigger. */
  description: string;
  /** The instructions themselves, frontmatter removed. */
  body: string;
  /** Any other frontmatter keys, verbatim. */
  extra: Record<string, string>;
}

export class AgentSkillError extends Error {}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** True when a filename is an Agent Skill's entry point. */
export function isAgentSkillFile(filename: string): boolean {
  const base = filename.split("/").pop() ?? filename;
  return /^SKILL\.md$/i.test(base) || /\.skill\.md$/i.test(base);
}

/**
 * Parse a SKILL.md. Throws only when there is genuinely nothing usable, so a
 * skill with unusual frontmatter still loads rather than being discarded.
 */
export function parseAgentSkill(text: string, fallbackName = ""): AgentSkill {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new AgentSkillError("A SKILL.md cannot be empty.");
  }

  const match = FRONTMATTER.exec(text);
  const body = (match ? text.slice(match[0].length) : text).trim();
  const extra: Record<string, string> = {};
  let name = "";
  let description = "";

  if (match) {
    // Line-oriented on purpose: `key: value`, with values that may be quoted
    // or may run to the end of the line including colons, which a naive split
    // on ":" gets wrong for exactly the descriptions this format encourages.
    for (const line of match[1].split(/\r?\n/)) {
      const at = line.indexOf(":");
      if (at <= 0) continue;
      const key = line.slice(0, at).trim();
      const value = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
      if (!key) continue;
      if (key === "name") name = value;
      else if (key === "description") description = value;
      else extra[key] = value;
    }
  }

  if (!name) name = fallbackName.trim();
  if (!name) {
    // The heading is the last honest place to look before giving up.
    const heading = body.match(/^#\s+(.+)$/m);
    name = (heading?.[1] ?? "").trim();
  }
  if (!name) throw new AgentSkillError("A SKILL.md needs a name, in frontmatter or as its first heading.");

  if (!description) {
    // First non-empty paragraph of the body. Not as good as a real
    // description, and better than refusing to load a skill over it.
    const firstPara = body.split(/\r?\n\s*\r?\n/).map(p => p.trim()).find(p => p && !p.startsWith("#"));
    description = (firstPara ?? "").slice(0, 500);
  }
  if (!body) throw new AgentSkillError(`"${name}" has frontmatter but no instructions.`);
  if (!description) {
    // A prompting skill's description IS its trigger -- it is the statement of
    // when the instructions apply. Without one there is nothing to match a
    // request against, so the skill could never fire; it would sit in memory
    // with an empty trigger, matching nothing or everything. Refusing is more
    // useful than loading something inert and calling it installed.
    throw new AgentSkillError(
      `"${name}" has no description, so there is nothing to say when it applies. ` +
        `Add a description to the frontmatter, or an opening paragraph.`,
    );
  }

  return { name, description, body, extra };
}

/**
 * Render an Agent Skill back to SKILL.md, so one built here round-trips into
 * the same format everyone else uses.
 */
export function renderAgentSkill(skill: AgentSkill): string {
  const lines = ["---", `name: ${skill.name}`, `description: ${skill.description}`];
  for (const [key, value] of Object.entries(skill.extra)) lines.push(`${key}: ${value}`);
  lines.push("---", "", skill.body.trim(), "");
  return lines.join("\n");
}
