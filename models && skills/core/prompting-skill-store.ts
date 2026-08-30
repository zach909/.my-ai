/**
 * Publishing, installing and editing prompting skills.
 *
 * Two separate things live here, and keeping them separate is the point.
 *
 * Publishing writes a skill into `store/prompting/<name>/skill.json` and
 * pushes it, so everyone who pulls has it. That is open: anyone may publish.
 *
 * Installing copies a published skill into THIS machine's installed set, which
 * is what the agent loop actually reads. That is a choice, always, and it is
 * device-local on purpose -- installing is "I want my agent to work this way",
 * which is not something one person should be able to decide for everyone who
 * pulls the repository.
 *
 * So a published skill sits inert in the catalogue until someone installs it,
 * exactly like every other kind in the store. The difference is that a
 * prompting skill is declarative, so installing one cannot execute anything:
 * it names a memory source, a reasoning strategy or a plugin, and agent-loop.ts
 * is the only thing that acts on those names.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  builtInPromptingSkills,
  parsePromptingSkill,
  PromptingSkillError,
  PromptingSkillRegistry,
  type PromptingSkill,
} from "./prompting-skills.js";
import { publishAndSync, readItemFile, storeRoot, type StoreItem } from "./store.js";
import type { StoreSyncResult } from "./store-sync.js";

/** The file a published prompting skill is stored as, inside its store item. */
export const SKILL_FILE = "skill.json";

/**
 * Where installed skills live. Device-local by design (see the module comment),
 * and overridable so tests never touch a real installation.
 */
export function installedDir(): string {
  return process.env.NEUROCLAW_PROMPTING_DIR
    ? path.resolve(process.env.NEUROCLAW_PROMPTING_DIR)
    : path.resolve(process.cwd(), "extension-builder", "extensions", "prompting");
}

function installedPath(name: string): string {
  // parsePromptingSkill has already rejected anything that is not a safe bare
  // name by the time a skill reaches here, and every caller goes through it.
  return path.join(installedDir(), `${name}.json`);
}

/** Publish a prompting skill to the store, and push it so everyone else gets it. */
export async function publishPromptingSkill(
  raw: unknown,
): Promise<{ item: StoreItem; sync: StoreSyncResult; skill: PromptingSkill }> {
  const skill = parsePromptingSkill(raw);
  const { item, sync } = await publishAndSync({
    kind: "prompting",
    name: skill.name,
    title: skill.title,
    description: skill.description,
    author: skill.author,
    files: [{ filename: SKILL_FILE, content: `${JSON.stringify(skill, null, 2)}\n` }],
  });
  return { item, sync, skill };
}

/** Read a published prompting skill out of the store. Null when there is no such item. */
export function readPublishedPromptingSkill(name: string): PromptingSkill | null {
  const buf = readItemFile("prompting", name, SKILL_FILE);
  if (!buf) return null;
  try {
    return parsePromptingSkill(JSON.parse(buf.toString("utf8")));
  } catch (err) {
    // A published skill that does not parse is a real problem for whoever
    // published it, but it must not take down a listing for everyone else.
    throw new PromptingSkillError(
      `"${name}" is published but is not a valid prompting skill: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Every prompting skill installed on this machine. */
export function listInstalled(): PromptingSkill[] {
  const dir = installedDir();
  if (!existsSync(dir)) return [];
  const out: PromptingSkill[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      out.push(parsePromptingSkill(JSON.parse(readFileSync(path.join(dir, entry), "utf8"))));
    } catch {
      // One corrupt file must not hide every other installed skill.
      continue;
    }
  }
  return out.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

/**
 * Install a skill on this machine.
 *
 * Takes the skill document rather than a name, so the same function serves
 * installing from the store, installing something written locally, and editing
 * an already-installed skill -- all three are "this is what the loop should
 * use from now on".
 */
export function installPromptingSkill(raw: unknown): PromptingSkill {
  const skill = parsePromptingSkill(raw);
  const dir = installedDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(installedPath(skill.name), `${JSON.stringify(skill, null, 2)}\n`, "utf8");
  return skill;
}

/** Install a skill that is already published. Throws when it is not in the store. */
export function installFromStore(name: string): PromptingSkill {
  const published = readPublishedPromptingSkill(name);
  if (!published) {
    throw new PromptingSkillError(`There is no published prompting skill called "${name}".`);
  }
  return installPromptingSkill(published);
}

/** Remove a skill from this machine. The published copy is untouched. */
export function uninstallPromptingSkill(name: string): boolean {
  const file = installedPath(parsePromptingSkill({ ...asStub(name) }).name);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

/**
 * The minimum a name has to look like to go through parsePromptingSkill's own
 * name validation. Reusing that validation rather than re-implementing it is
 * what keeps uninstall from accepting a path a publish would have rejected.
 */
function asStub(name: string): Record<string, unknown> {
  return { name, category: "cognitive", strategy: "decompose" };
}

/**
 * The registry the agent loop should use: the built-in starter set, with
 * anything installed layered on top.
 *
 * Installed skills win on a name collision, so editing a built-in is possible
 * without special-casing it -- install one with the same name and it replaces
 * it, which is the same mechanism as editing any other installed skill.
 */
export function loadRegistry(): PromptingSkillRegistry {
  const registry = new PromptingSkillRegistry();
  for (const skill of builtInPromptingSkills()) registry.install(skill);
  for (const skill of listInstalled()) registry.install(skill);
  return registry;
}

/** True when a name refers to one of the built-ins rather than something installed. */
export function isBuiltIn(name: string): boolean {
  return builtInPromptingSkills().some(s => s.name === name);
}

/** Where the store keeps prompting skills, for anything that needs the path. */
export function promptingStoreDir(): string {
  return path.join(storeRoot(), "prompting");
}
