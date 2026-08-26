/**
 * The agent publishing its own work to the store, without being asked.
 *
 * The autonomous skill agent already researched topics, wrote articles,
 * compiled skills, generated regression tests and drilled them -- and pushed
 * five real artifacts per skill straight to the branch. None of them reached
 * `store/`. So the catalogue, which is the thing anyone else actually browses,
 * contained only what a human had published by hand, while the agent's own
 * output accumulated in directories nobody looks at.
 *
 * This closes that: the same artifacts become a store item, so a skill the
 * agent taught itself is one anyone else can find, download and install.
 *
 * Two rules are kept from the rest of the store, and both matter more here
 * than anywhere else precisely because nobody is watching:
 *
 *   Publishing is open, installing is a choice. This module publishes. It
 *   never installs anything on anyone's machine, including this one. An agent
 *   that could publish AND auto-install would be an agent that silently
 *   changes every machine that pulls.
 *
 *   Deletion stays privileged. There is no function here that removes a store
 *   item. An autonomous process that can quietly delete other people's
 *   published work is a worse failure than one that cannot tidy up.
 */

import { createHash } from "node:crypto";
import { publishAndSync, readItem, type StoreItem } from "./store.js";
import type { StoreSyncResult } from "./store-sync.js";

/** One artifact the agent produced, as it will appear in the store item. */
export interface SkillArtifact {
  filename: string;
  content: string;
}

export interface AutonomousPublish {
  item: StoreItem;
  sync: StoreSyncResult;
  /** True when this replaced an earlier version rather than creating one. */
  updated: boolean;
  /** Files whose content actually changed. Empty means the republish was a no-op. */
  changed: string[];
}

/** Author label for anything published without a person in the loop. */
export const AGENT_AUTHOR = "corona-agent (autonomous)";

/**
 * Which files differ from what is already published.
 *
 * Checked before publishing rather than after, because a publish commits and
 * pushes: an agent on a timer that republishes identical content every cycle
 * turns the history into noise and makes a real change impossible to spot.
 */
export function changedAgainstStore(kind: string, name: string, artifacts: SkillArtifact[]): string[] {
  const existing = readItem(kind, name);
  if (!existing) return artifacts.map(a => a.filename);

  const bySha = new Map(existing.files.map(f => [f.filename, f.sha256]));
  const changed: string[] = [];
  for (const artifact of artifacts) {
    const published = bySha.get(artifact.filename);
    if (!published || published !== sha256Hex(artifact.content)) changed.push(artifact.filename);
  }
  return changed;
}

function sha256Hex(content: string): string {
  // Matches how store.ts hashes a published file: the bytes as written.
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

/**
 * Publish a skill the agent built, or update it when it has genuinely changed.
 *
 * Returns without publishing when nothing differs -- see changedAgainstStore.
 */
export async function publishSkillToStore(input: {
  name: string;
  title: string;
  description: string;
  artifacts: SkillArtifact[];
  kind?: string;
}): Promise<AutonomousPublish | { skipped: "unchanged"; item: StoreItem }> {
  const kind = input.kind ?? "skills";
  const existing = readItem(kind, input.name);
  const changed = changedAgainstStore(kind, input.name, input.artifacts);

  if (existing && changed.length === 0) {
    return { skipped: "unchanged", item: existing };
  }

  const { item, sync } = await publishAndSync({
    kind,
    name: input.name,
    title: input.title,
    description: input.description,
    author: AGENT_AUTHOR,
    // Only what changed is sent: publishes merge, so an unchanged file does
    // not need re-uploading to survive.
    files: input.artifacts
      .filter(a => changed.includes(a.filename))
      .map(a => ({ filename: a.filename, content: a.content })),
  });

  return { item, sync, updated: Boolean(existing), changed };
}

/**
 * The description shown in the catalogue for an autonomously published skill.
 *
 * Says plainly that no person reviewed it. Someone deciding whether to install
 * this should not have to work out from the author string that it was written
 * by a machine on a timer.
 */
export function describeAutonomousSkill(topic: string, verifiedSources: number): string {
  return [
    `Researched and built autonomously by this agent from ${verifiedSources} corroborated source${verifiedSources === 1 ? "" : "s"}.`,
    "No person reviewed it before publication.",
    "Includes the article it was written from, the compiled and un-compiled skill, and its regression test — read them before installing.",
    `Topic: ${topic}`,
  ].join(" ");
}
