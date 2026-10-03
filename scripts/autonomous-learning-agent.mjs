#!/usr/bin/env node
/**
 * autonomous-learning-agent.mjs — The main learning loop.
 *
 * Every cycle (default: 30 minutes):
 * 1. Read recent conversations (from conversation-log.jsonl)
 * 2. Analyze them to extract domain-specific learnings
 * 3. Train domain net-skills using ExtensionBuilder
 * 4. Publish trained skills to GitHub on main branch
 *
 * Env vars:
 *   NEUROCLAW_AUTONOMOUS_LEARNING=0           disable entirely
 *   NEUROCLAW_AUTONOMOUS_LEARNING_INTERVAL_MS  ms between cycles (default 30 min)
 *
 * Usage: node scripts/autonomous-learning-agent.mjs          (runs forever)
 *        node scripts/autonomous-learning-agent.mjs --once   (one cycle, for testing)
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ConversationAnalyzer from './conversation-analyzer.mjs';
import DomainNetSkillBuilder from './domain-net-skill-builder.mjs';
import LearningSynchronizer from './learning-synchronizer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const LOG_PATH = path.join(ROOT, 'extension-builder', 'conversation-log.jsonl');
const STATE_PATH = path.join(ROOT, 'extension-builder', 'autonomous-learning-state.json');
const SKILLS_DIR = path.join(ROOT, 'extension-builder', 'net-skills');

function log(...args) {
  console.log('[autonomous-learning]', ...args);
}

/**
 * Read conversation turns from the log.
 */
function readConversationLog(logPath, limit = 200) {
  if (!existsSync(logPath)) return [];

  try {
    const content = readFileSync(logPath, 'utf8');
    const turns = [];

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed.userMessage === 'string' && typeof parsed.response === 'string') {
          turns.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return turns.slice(-limit);
  } catch (err) {
    log('Failed to read conversation log:', err.message);
    return [];
  }
}

/**
 * Load learning state from the last cycle.
 */
function loadState(statePath) {
  if (!existsSync(statePath)) {
    return {
      lastAnalyzedAt: 0,
      lastPublishedAt: 0,
      cycleCount: 0,
      totalTurnsSeen: 0,
      totalLearningsExtracted: 0,
    };
  }

  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return {
      lastAnalyzedAt: 0,
      lastPublishedAt: 0,
      cycleCount: 0,
      totalTurnsSeen: 0,
      totalLearningsExtracted: 0,
    };
  }
}

/**
 * Save learning state for the next cycle.
 */
function saveState(state, statePath) {
  const dir = path.dirname(statePath);
  require('node:fs').mkdirSync(dir, { recursive: true });
  require('node:fs').writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Run one complete learning cycle.
 */
export async function runOneLearningCycle(options = {}) {
  const {
    displayProgress = true,
    epochs = 1000,
    publishToGit = true,
    maxTurns = 200,
  } = options;

  if (displayProgress) log('Starting learning cycle...');

  try {
    const state = loadState(STATE_PATH);
    const turns = readConversationLog(LOG_PATH, maxTurns);

    if (turns.length === 0) {
      if (displayProgress) log('No conversations to learn from.');
      return { ok: true, analyzed: false, reason: 'no-turns' };
    }

    if (displayProgress) log(`Analyzing ${turns.length} conversation turn(s)...`);

    // Step 1: Analyze conversations by domain
    const domainLearnings = ConversationAnalyzer.analyzeConversationLog(turns);

    const totalLearnings = Object.values(domainLearnings).reduce((sum, arr) => sum + arr.length, 0);
    if (displayProgress) {
      log(`Extracted ${totalLearnings} learnings across domains:`);
      for (const [domain, learnings] of Object.entries(domainLearnings)) {
        if (learnings.length > 0) {
          log(`  ${domain}: ${learnings.length} learnings`);
        }
      }
    }

    // Step 2: Build/update domain net-skills
    if (displayProgress) log('Building domain net-skills...');

    const skillBuildResults = await DomainNetSkillBuilder.buildAllDomainSkills(
      domainLearnings,
      SKILLS_DIR,
      { epochs, displayProgress }
    );

    const successCount = Object.values(skillBuildResults).filter(r => r.success).length;
    if (displayProgress) {
      log(`Built ${successCount} domain net-skill(s):`);
      for (const [domain, result] of Object.entries(skillBuildResults)) {
        if (result.success) {
          log(`  ${domain}: ${result.message}`);
        } else {
          log(`  ${domain}: FAILED - ${result.error}`);
        }
      }
    }

    // Step 3: Collect skill files for publishing
    const skillFiles = [];
    for (const result of Object.values(skillBuildResults)) {
      if (result.success && result.path) {
        skillFiles.push(result.path);
      }
    }

    // Step 4: Publish to GitHub
    let publishResult = { ok: true, published: 0 };
    if (publishToGit && skillFiles.length > 0) {
      if (displayProgress) log(`Publishing ${skillFiles.length} net-skill(s) to GitHub...`);
      publishResult = await LearningSynchronizer.publishNetSkills(skillFiles);

      if (publishResult.ok) {
        if (displayProgress) log(`Published ${publishResult.published} net-skill(s).`);
        state.lastPublishedAt = Date.now();
      } else {
        if (displayProgress) log(`Failed to publish: ${publishResult.error}`);
      }
    }

    // Update state
    state.lastAnalyzedAt = Date.now();
    state.cycleCount = (state.cycleCount ?? 0) + 1;
    state.totalTurnsSeen = (state.totalTurnsSeen ?? 0) + turns.length;
    state.totalLearningsExtracted = (state.totalLearningsExtracted ?? 0) + totalLearnings;
    saveState(state, STATE_PATH);

    if (displayProgress) {
      log(`Cycle complete. Total: ${state.cycleCount} cycles, ${state.totalTurnsSeen} turns analyzed, ` +
          `${state.totalLearningsExtracted} learnings extracted.`);
    }

    return {
      ok: true,
      analyzed: true,
      turnCount: turns.length,
      learningsExtracted: totalLearnings,
      skillsBuilt: successCount,
      published: publishResult.published,
    };
  } catch (err) {
    log('Cycle failed:', err.message);
    if (err.stack) log(err.stack);
    return { ok: false, error: err.message };
  }
}

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function loop() {
  if (process.env.NEUROCLAW_AUTONOMOUS_LEARNING === '0') {
    log('Disabled via NEUROCLAW_AUTONOMOUS_LEARNING=0 -- exiting.');
    return;
  }

  const intervalMs = Number(process.env.NEUROCLAW_AUTONOMOUS_LEARNING_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  log(`Starting -- learning cycle every ${Math.round(intervalMs / 60000)} minute(s).`);

  for (;;) {
    try {
      await runOneLearningCycle({ displayProgress: true });
    } catch (err) {
      log('Unexpected error, continuing:', err?.message ?? err);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function isEntryPoint() {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return require('node:fs').realpathSync(entry) ===
           require('node:fs').realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  if (process.argv.includes('--once')) {
    runOneLearningCycle({ displayProgress: true })
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.ok ? 0 : 1);
      })
      .catch((err) => {
        console.error('Cycle failed:', err);
        process.exit(1);
      });
  } else {
    loop();
  }
}

export default {
  runOneLearningCycle,
  readConversationLog,
  loadState,
  saveState,
};
