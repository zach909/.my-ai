#!/usr/bin/env node
/**
 * learning-synchronizer.mjs — Publish trained net-skills to GitHub.
 *
 * After domain net-skills are trained locally, this publishes them to
 * the main branch under extension-builder/net-skills/. The trained neurons
 * (not the conversation text) are committed to git so other instances
 * can pull them and improve further.
 *
 * Absolute privacy: conversation text never leaves the machine. Only
 * the trained neural weights are published.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const NET_SKILLS_DIR = path.join(ROOT, 'extension-builder', 'net-skills');

/**
 * Publish trained net-skills to GitHub on main branch.
 * Creates a commit with the trained skill files.
 */
export async function publishNetSkills(skillFiles) {
  if (!skillFiles || skillFiles.length === 0) {
    console.log('[learning-sync] No skill files to publish.');
    return { ok: true, published: 0, reason: 'no-skills' };
  }

  try {
    // Ensure git is in a clean state on main
    execSync('git fetch origin main', { cwd: ROOT });
    execSync('git checkout main', { cwd: ROOT });

    // Create net-skills directory if it doesn't exist
    mkdirSync(NET_SKILLS_DIR, { recursive: true });

    // Copy skill files to the target directory
    let filesAdded = 0;
    for (const skillFile of skillFiles) {
      if (!existsSync(skillFile)) {
        console.warn(`[learning-sync] Skill file not found: ${skillFile}`);
        continue;
      }

      const fileName = path.basename(skillFile);
      const targetPath = path.join(NET_SKILLS_DIR, fileName);

      // Only commit if the file has changed
      const contentNew = readFileSync(skillFile, 'utf8');
      const contentOld = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null;

      if (contentNew !== contentOld) {
        writeFileSync(targetPath, contentNew, 'utf8');
        filesAdded++;
      }
    }

    if (filesAdded === 0) {
      console.log('[learning-sync] No files changed, nothing to commit.');
      return { ok: true, published: 0, reason: 'no-changes' };
    }

    // Commit the changes
    try {
      execSync(`git add ${path.join(NET_SKILLS_DIR, '*.net-skill.json')}`, { cwd: ROOT });
      const status = execSync('git status --short', { cwd: ROOT }).toString();

      if (!status.trim()) {
        console.log('[learning-sync] No staged changes.');
        return { ok: true, published: 0, reason: 'no-staged' };
      }

      const message =
        `Update net-skills with conversation learnings\n\n` +
        `Published ${filesAdded} trained domain net-skill(s). ` +
        `Conversation content remains local and private. ` +
        `Only trained neural weights are shared.\n\n` +
        `Co-Authored-By: NeuroClaw Learning System <learning@neuroclaw.local>`;

      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: ROOT });

      // Push to origin main
      execSync('git push origin main', { cwd: ROOT });

      console.log(`[learning-sync] Published ${filesAdded} net-skill(s) to main.`);
      return {
        ok: true,
        published: filesAdded,
        filesAdded,
        message: 'Published to main branch.',
      };
    } catch (commitErr) {
      console.error('[learning-sync] Git commit/push failed:', commitErr.message);
      return { ok: false, error: commitErr.message };
    }
  } catch (err) {
    console.error('[learning-sync] Failed to publish:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Retrieve all published net-skills from the repository.
 */
export function getPublishedNetSkills() {
  if (!existsSync(NET_SKILLS_DIR)) {
    return {};
  }

  const skills = {};
  const files = readdirSync(NET_SKILLS_DIR).filter(f => f.endsWith('.net-skill.json'));

  for (const file of files) {
    const filePath = path.join(NET_SKILLS_DIR, file);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      const domain = data.domain || file.replace('.net-skill.json', '');
      skills[domain] = { ...data, filePath };
    } catch (err) {
      console.warn(`[learning-sync] Failed to parse ${file}:`, err.message);
    }
  }

  return skills;
}

/**
 * Check if any local skills differ from published versions.
 */
export function hasUnpublishedChanges(localSkills, publishedSkills) {
  for (const [domain, localSkill] of Object.entries(localSkills)) {
    const publishedSkill = publishedSkills[domain];

    if (!publishedSkill) {
      // New skill not yet published
      return true;
    }

    // Compare version numbers and training sample count
    if (
      (localSkill.version ?? 0) > (publishedSkill.version ?? 0) ||
      (localSkill.trainingSamples ?? 0) !== (publishedSkill.trainingSamples ?? 0)
    ) {
      return true;
    }
  }

  return false;
}

export default {
  publishNetSkills,
  getPublishedNetSkills,
  hasUnpublishedChanges,
};
