#!/usr/bin/env node
/**
 * conversation-analyzer.mjs — Extract domain-specific learnings from conversations.
 *
 * For each conversation turn, classify which domain(s) it covers and extract
 * high-signal patterns:
 * - reasoning: logic, proof strategies, decision-making
 * - chip-design: electronics, hardware, circuits, semiconductor design
 * - physics: physics principles, chemistry, astrophysics, thermodynamics
 * - ai-coding: AI algorithms, neural networks, ML techniques, complex coding patterns
 *
 * Returns structured learnings that DomainNetSkillBuilder can train on.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Domain keywords and patterns — simple but effective classification
const DOMAIN_PATTERNS = {
  reasoning: {
    keywords: [
      'logic', 'proof', 'theorem', 'deduce', 'infer', 'hypothesis', 'assume',
      'conclude', 'therefore', 'because', 'reasoning', 'argument', 'fallacy',
      'valid', 'invalid', 'contradiction', 'consistency', 'implies', 'consequence',
      'decision', 'choice', 'optimal', 'strategy', 'gametheory'
    ],
    patterns: [
      /^(prove|show|demonstrate|verify|confirm)\s+that/i,
      /\b(if|then|else|and|or|not|all|some|exists)\b/i,
      /\b(assume|suppose|claim|conjecture)\b/i,
    ]
  },
  'chip-design': {
    keywords: [
      'chip', 'circuit', 'electronics', 'transistor', 'gate', 'boolean', 'logic gate',
      'semiconductor', 'verilog', 'hdl', 'asic', 'fpga', 'cpu', 'gpu', 'processor',
      'voltage', 'current', 'impedance', 'pcb', 'schematic', 'layout', 'timing',
      'power consumption', 'clock', 'frequency', 'bus', 'memory', 'cache',
      'signal integrity', 'noise', 'capacitor', 'resistor', 'inductor'
    ],
    patterns: [
      /\b(verilog|systemverilog|hdl|rtl|design)\b/i,
      /\b(gate|circuit|transistor|semiconductor)\b/i,
      /\b(frequency|hz|mhz|ghz|timing|latency)\b/i,
    ]
  },
  physics: {
    keywords: [
      'physics', 'force', 'energy', 'momentum', 'velocity', 'acceleration',
      'mass', 'gravity', 'quantum', 'relativity', 'wave', 'particle',
      'chemistry', 'atom', 'molecule', 'electron', 'proton', 'neutron',
      'reaction', 'catalyst', 'equilibrium', 'entropy', 'thermodynamics',
      'optics', 'light', 'laser', 'photon', 'frequency', 'wavelength',
      'astrophysics', 'star', 'planet', 'orbit', 'schwarzschild', 'escape velocity'
    ],
    patterns: [
      /\b(newton|einstein|quantum mechanics|relativity|maxwell)\b/i,
      /\b(equation|formula|law of|principle of)\b/i,
      /\b(energy|momentum|force|acceleration)\s*=/i,
    ]
  },
  'ai-coding': {
    keywords: [
      'ai', 'machine learning', 'neural network', 'deep learning', 'algorithm',
      'gradient', 'backprop', 'tensor', 'matrix', 'embedding', 'attention',
      'transformer', 'bert', 'gpt', 'llm', 'optimization', 'convergence',
      'loss function', 'training', 'epoch', 'batch', 'learning rate',
      'classification', 'regression', 'clustering', 'reinforcement learning',
      'python', 'javascript', 'typescript', 'javascript', 'async', 'promise',
      'recursion', 'complexity', 'tree', 'graph', 'dynamic programming',
      'sorting', 'searching', 'heap', 'stack', 'queue'
    ],
    patterns: [
      /\b(def|class|function|const|let|var)\s+\w+/,
      /\b(neural|gradient|loss|train|epoch|batch)\b/i,
      /\b(algorithm|complexity|optimization|convergence)\b/i,
    ]
  }
};

/**
 * Classify a message into domains and extract signal strength (0-1).
 * A message can belong to multiple domains simultaneously.
 */
export function classifyMessage(text) {
  if (!text || typeof text !== 'string') return {};

  const domains = {};
  const lowerText = text.toLowerCase();
  let totalKeywordMatches = 0;

  for (const [domain, { keywords, patterns }] of Object.entries(DOMAIN_PATTERNS)) {
    let score = 0;

    // Keyword matching (weighted by frequency)
    const keywordMatches = keywords.filter(kw =>
      lowerText.includes(kw.toLowerCase())
    ).length;
    score += keywordMatches * 0.3;
    totalKeywordMatches += keywordMatches;

    // Pattern matching (stronger signal)
    const patternMatches = patterns.filter(pat =>
      pat.test(text)
    ).length;
    score += patternMatches * 0.5;

    // Only include if there's actual signal
    if (score > 0) {
      // Normalize to 0-1 range (cap at ~1.0 for strong signals)
      domains[domain] = Math.min(score / 2.0, 1.0);
    }
  }

  return domains;
}

/**
 * Extract learning samples from a conversation turn.
 * For domain-specific training, we want patterns that are:
 * 1. Domain-specific (high classification score)
 * 2. Novel/non-obvious (not just basic facts)
 * 3. Actionable (useful for future conversations)
 */
export function extractLearnings(userMessage, aiResponse, domains) {
  const learnings = {};

  for (const [domain, confidence] of Object.entries(domains)) {
    if (confidence < 0.3) continue; // Skip low-confidence classifications

    // For each domain, extract the most relevant part of the response
    const learning = {
      domain,
      confidence,
      sample: {
        input: userMessage,
        output: aiResponse,
        // Extract the most informative excerpt (first few sentences)
        excerpt: aiResponse.split(/[.!?]\s+/).slice(0, 2).join('. ') + '.',
      },
      // Signal strength: how much should we weight this sample?
      weight: confidence,
      timestamp: Date.now(),
    };

    if (!learnings[domain]) {
      learnings[domain] = [];
    }
    learnings[domain].push(learning);
  }

  return learnings;
}

/**
 * Analyze a full conversation log and return structured learnings per domain.
 */
export function analyzeConversationLog(turns) {
  const domainLearnings = {
    reasoning: [],
    'chip-design': [],
    physics: [],
    'ai-coding': [],
  };

  for (const turn of turns) {
    if (!turn.userMessage || !turn.response) continue;

    // Classify this turn
    const domains = classifyMessage(turn.userMessage + ' ' + turn.response);

    // Extract learnings
    const learnings = extractLearnings(turn.userMessage, turn.response, domains);

    // Accumulate
    for (const [domain, samples] of Object.entries(learnings)) {
      if (domainLearnings[domain]) {
        domainLearnings[domain].push(...samples);
      }
    }
  }

  return domainLearnings;
}

export default {
  classifyMessage,
  extractLearnings,
  analyzeConversationLog,
};
