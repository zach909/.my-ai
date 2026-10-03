#!/usr/bin/env node
/**
 * learning-loader.mjs — Load published net-skills at startup.
 *
 * On boot, this:
 * 1. Discovers all published net-skills from extension-builder/net-skills/
 * 2. Loads them into memory (ExtensionBuilder projects)
 * 3. Prepares them to be grafted into the OneBrain mesh
 * 4. Returns them so the mesh can activate domain-specific routing
 *
 * These skills are then available to:
 * - Improve responses in their domains
 * - Guide skill-mesh direct-answer routing
 * - Provide domain-specific training examples
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const NET_SKILLS_DIR = path.join(ROOT, 'extension-builder', 'net-skills');

/**
 * Load all published net-skills from disk.
 */
export function loadAllNetSkills() {
  const skills = {};

  if (!existsSync(NET_SKILLS_DIR)) {
    console.log('[learning-loader] No net-skills directory found, starting fresh.');
    return skills;
  }

  const files = readdirSync(NET_SKILLS_DIR).filter(f => f.endsWith('.net-skill.json'));

  for (const file of files) {
    try {
      const skillPath = path.join(NET_SKILLS_DIR, file);
      const skillData = JSON.parse(readFileSync(skillPath, 'utf8'));
      const domain = skillData.domain || file.replace('.net-skill.json', '');

      skills[domain] = {
        ...skillData,
        path: skillPath,
        loadedAt: Date.now(),
      };

      console.log(`[learning-loader] Loaded ${domain} skill (v${skillData.version}, ${skillData.neurons} neurons, ${skillData.trainingSamples} samples).`);
    } catch (err) {
      console.warn(`[learning-loader] Failed to load ${file}:`, err.message);
    }
  }

  return skills;
}

/**
 * Prepare loaded skills for mesh integration.
 * Returns a mapping of domain → mesh expert slot + routing info.
 */
export function prepareSkillsForMesh(loadedSkills) {
  const meshSkills = {};

  for (const [domain, skillData] of Object.entries(loadedSkills)) {
    if (!skillData.projectData) {
      console.warn(`[learning-loader] ${domain} skill has no projectData, skipping mesh integration.`);
      continue;
    }

    meshSkills[domain] = {
      id: skillData.id,
      domain,
      name: skillData.name,
      description: skillData.description,
      version: skillData.version,
      neurons: skillData.neurons,
      trainingStrength: skillData.trainingSamples, // How many samples trained this skill
      convergence: skillData.convergedNeurons / Math.max(1, skillData.neurons), // % converged
      projectData: skillData.projectData, // Raw neuron/connection/label data for mesh
    };
  }

  return meshSkills;
}

/**
 * Get a specific domain skill for direct use (e.g., to classify a message).
 */
export function getSkillForDomain(domain, loadedSkills) {
  return loadedSkills[domain] || null;
}

/**
 * Return summary of loaded skills (for logging/debugging).
 */
export function getSummary(loadedSkills) {
  const domains = Object.keys(loadedSkills);
  const totalNeurons = Object.values(loadedSkills).reduce((sum, s) => sum + (s.neurons ?? 0), 0);
  const totalSamples = Object.values(loadedSkills).reduce((sum, s) => sum + (s.trainingSamples ?? 0), 0);

  return {
    domainsLoaded: domains,
    domainCount: domains.length,
    totalNeurons,
    totalSamples,
    skills: loadedSkills,
  };
}

/**
 * This is meant to be called at server startup to load skills once.
 */
export async function initializeLearningSystem() {
  try {
    const loaded = loadAllNetSkills();
    const prepared = prepareSkillsForMesh(loaded);
    const summary = getSummary(loaded);

    console.log(`[learning-loader] Initialized: ${summary.domainCount} domains, ${summary.totalNeurons} neurons, ${summary.totalSamples} training samples.`);

    return {
      ok: true,
      loadedSkills: loaded,
      meshSkills: prepared,
      summary,
    };
  } catch (err) {
    console.error('[learning-loader] Initialization failed:', err.message);
    return {
      ok: false,
      error: err.message,
      loadedSkills: {},
      meshSkills: {},
    };
  }
}

export default {
  loadAllNetSkills,
  prepareSkillsForMesh,
  getSkillForDomain,
  getSummary,
  initializeLearningSystem,
};
