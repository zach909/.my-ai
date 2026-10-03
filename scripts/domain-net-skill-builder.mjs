#!/usr/bin/env node
/**
 * domain-net-skill-builder.mjs — Create and train domain-specific net-skills.
 *
 * For each domain (reasoning, chip-design, physics, ai-coding), this:
 * 1. Creates/loads a project via ExtensionBuilder
 * 2. Adds neurons for domain patterns
 * 3. Trains on extracted learnings via delta rule
 * 4. Saves the trained skill as JSON
 * 5. Returns the trained net-skill for publishing
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Domain-specific skill metadata
const DOMAIN_SKILLS = {
  reasoning: {
    name: 'Reasoning Skill',
    description: 'General reasoning patterns: logic, proof strategies, decision-making.',
    neurons: 5, // Number of neurons to allocate for this domain
  },
  'chip-design': {
    name: 'Chip Design Skill',
    description: 'Electronics, hardware, circuits, semiconductor design patterns.',
    neurons: 8,
  },
  physics: {
    name: 'Physics & Chemistry Skill',
    description: 'Physics principles, chemistry, thermodynamics, astrophysics.',
    neurons: 10,
  },
  'ai-coding': {
    name: 'AI Coding Skill',
    description: 'AI algorithms, neural networks, ML techniques, complex coding patterns.',
    neurons: 12,
  },
};

/**
 * Load an existing net-skill or create a new one.
 */
export function loadOrCreateSkill(skillPath, domain) {
  if (existsSync(skillPath)) {
    try {
      return JSON.parse(readFileSync(skillPath, 'utf8'));
    } catch (err) {
      console.error(`Failed to load ${domain} skill from ${skillPath}:`, err.message);
    }
  }

  // Create new skill template
  return {
    id: `skill_${domain}_${Date.now()}`,
    domain,
    name: DOMAIN_SKILLS[domain].name,
    description: DOMAIN_SKILLS[domain].description,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    neurons: [],
    connections: [],
    trainingSamples: 0,
    convergedNeurons: 0,
  };
}

/**
 * Train a net-skill on domain learnings using ExtensionBuilder.
 *
 * The ExtensionBuilder is loaded dynamically from dist/ (compiled JS).
 * We create neurons for each learning and train them via delta rule.
 */
export async function trainNetSkill(domain, learnings, existingSkill = null, options = {}) {
  const { epochs = 1000, displayProgress = false } = options;

  if (!learnings || learnings.length === 0) {
    if (displayProgress) console.log(`[${domain}] No learnings to train on.`);
    return existingSkill || loadOrCreateSkill(null, domain);
  }

  // Dynamically import ExtensionBuilder from the compiled dist/
  let ExtensionBuilder;
  try {
    const builderModule = await import(path.join(ROOT, 'dist', 'extension-builder', 'builder.js'));
    ExtensionBuilder = builderModule.ExtensionBuilder;
  } catch (err) {
    throw new Error(`Could not load ExtensionBuilder from dist/: ${err.message}`);
  }

  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    DOMAIN_SKILLS[domain].name,
    DOMAIN_SKILLS[domain].description,
  );

  if (displayProgress) console.log(`[${domain}] Created project: ${project.name}`);

  // Create neurons for this domain (one neuron per learning pattern)
  const neurons = [];
  const samplesAdded = [];

  for (let i = 0; i < learnings.length; i++) {
    const learning = learnings[i];
    const neuronId = builder.addNeuron(project.id, `${domain}_neuron_${i}`, 0);

    if (!neuronId) {
      if (displayProgress) console.warn(`[${domain}] Failed to add neuron ${i}`);
      continue;
    }

    // Add the training sample: input (user message) → output (AI response)
    const added = builder.addScript(
      project.id,
      neuronId,
      learning.sample.input,
      learning.sample.output,
    );

    if (added) {
      neurons.push(neuronId);
      samplesAdded.push(learning);
    }
  }

  if (displayProgress) {
    console.log(`[${domain}] Added ${neurons.length} neurons from ${learnings.length} learnings.`);
  }

  // Train via delta rule (pure JS, no Python needed)
  if (neurons.length > 0) {
    const trainResult = builder.train(project.id, { epochs });
    const converged = trainResult?.converged ?? false;
    const convergedCount = neurons.filter(id => {
      const neuron = builder.projects.get(project.id).neurons.get(id);
      return neuron?.trained ?? false;
    }).length;

    if (displayProgress) {
      console.log(
        `[${domain}] Training complete: ${convergedCount}/${neurons.length} converged, ` +
        `${converged ? 'overall converged' : 'did not converge'}`
      );
    }
  }

  // Save the trained skill (unquantized, full precision)
  const savedProject = builder.saveWithoutQuantization(project.id);
  const skillData = {
    ...loadOrCreateSkill(null, domain),
    id: project.id,
    neurons: neurons.length,
    trainingSamples: samplesAdded.length,
    convergedNeurons: neurons.filter(id => {
      const neuron = builder.projects.get(project.id).neurons.get(id);
      return neuron?.trained ?? false;
    }).length,
    updatedAt: Date.now(),
    version: (existingSkill?.version ?? 0) + 1,
    projectData: savedProject, // Full neuron/connection/label data
  };

  if (displayProgress) {
    console.log(`[${domain}] Skill updated: version ${skillData.version}, trained on ${skillData.trainingSamples} samples.`);
  }

  return skillData;
}

/**
 * Save a trained net-skill to disk.
 */
export function saveSkillToDisk(skill, skillsDir) {
  const skillPath = path.join(skillsDir, `${skill.domain}.net-skill.json`);
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(skillPath, JSON.stringify(skill, null, 2) + '\n', 'utf8');
  return skillPath;
}

/**
 * Build and save all domain net-skills from a set of learnings.
 */
export async function buildAllDomainSkills(domainLearnings, skillsDir, options = {}) {
  const results = {};

  for (const [domain, learnings] of Object.entries(domainLearnings)) {
    if (!DOMAIN_SKILLS[domain]) continue;
    if (!learnings || learnings.length === 0) continue;

    try {
      const existingPath = path.join(skillsDir, `${domain}.net-skill.json`);
      const existingSkill = existsSync(existingPath)
        ? JSON.parse(readFileSync(existingPath, 'utf8'))
        : null;

      const trainedSkill = await trainNetSkill(domain, learnings, existingSkill, options);
      const savedPath = saveSkillToDisk(trainedSkill, skillsDir);

      results[domain] = {
        success: true,
        skill: trainedSkill,
        path: savedPath,
        message: `Trained ${learnings.length} samples, ${trainedSkill.convergedNeurons}/${trainedSkill.neurons} converged.`,
      };
    } catch (err) {
      results[domain] = {
        success: false,
        error: err.message,
      };
    }
  }

  return results;
}

export default {
  loadOrCreateSkill,
  trainNetSkill,
  saveSkillToDisk,
  buildAllDomainSkills,
  DOMAIN_SKILLS,
};
