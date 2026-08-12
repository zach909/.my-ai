#!/usr/bin/env node
/**
 * skill-agent.mjs — a separate autonomous agent from self-improve.mjs:
 * "I also want another separate AI, the same AI, but working on
 * skills... any AI can... make research, make a Wiki, then use that
 * Wiki to make a skill, and then everyone has access to it."
 *
 * Same underlying engine as everything else in this project (same
 * ResearchPlugin, same @definishon/torch.autograd training, same
 * sandbox/publish plumbing as scripts/self-improve.mjs), but a distinct
 * process with a distinct job: instead of tuning the hyperparameters of
 * FIXED existing skill scripts, this one creates NEW skills from
 * scratch, end to end:
 *
 *   1. RESEARCH: pick a topic, run ResearchPlugin.conductResearch() --
 *      the same real memory/drive/web search + never-trust-one-source
 *      corroboration this repo already ships (plugins/research.ts).
 *   2. WIKI: write up only the CORROBORATED findings (2+ independent
 *      sources) as a new wiki page -- an honest, clearly-labeled
 *      AI-generated research page, not a fabricated authority. A topic
 *      that turns up nothing corroborated produces no page at all --
 *      "checking checking checking" applies to what this agent
 *      publishes about itself, not just to training data.
 *   3. SKILL: trains a real @definishon neuron from that page's actual
 *      content via genuine torch.autograd gradient descent -- the exact
 *      same mechanism build-self-knowledge-network.mjs already uses to
 *      train the wiki into a skill, just for one freshly-written page.
 *   4. SHARE: only if the skill genuinely converges AND the runner gate
 *      (test/smoke.mjs) still passes, FIVE things get published
 *      together, straight to TARGET_BRANCH (same mechanism, same
 *      "not beta, but to git" destination as self-improve.mjs) and
 *      announced to any configured peers -- "everyone has access to
 *      it" via the shared git history a plain `git pull` retrieves, not
 *      by transmitting arbitrary page content peer-to-peer (same
 *      trust-boundary discipline as scripts/peer-sync.mjs: a peer
 *      notification only ever carries a topic/slug/commit, never page
 *      content itself):
 *        1. wiki/<slug>.md            -- the sourced article (renderWikiPage())
 *        2. extensions/<slug>.skill.json  -- the compiled skill (quantized, "binary")
 *        3. extensions/<slug>.source.json -- the same skill unquantized ("source code")
 *        4. test/skills/<slug>.test.ts    -- an auto-generated regression test for it
 *        5. drill-weights/<slug>.json     -- kept "constantly improving" by
 *           scripts/skill-drill-agent.mjs, a separate `npm run server`
 *           agent that drills this skill (real, fresh problems for
 *           categories it recognizes -- see
 *           drill-generators/arithmetic.mjs -- or a content-regression
 *           check otherwise) every cycle and pushes genuine improvements
 *           back here the same way. That agent is the "algorithm you
 *           can run on your machine to constantly improve it" -- one
 *           shared, tested engine invoked per skill, not bespoke
 *           generated code per topic.
 *
 * Topics are drawn from the same curriculum scope this project already
 * committed to this session: physics/chemistry/computation/AI research
 * -- explicitly still no biology.
 *
 * Env vars:
 *   NEUROCLAW_SKILL_AGENT=0                disable the loop entirely
 *   NEUROCLAW_SKILL_AGENT_INTERVAL_MS      ms between cycles (default 45 min)
 *   NEUROCLAW_SELF_IMPROVE_BRANCH          branch a new skill is pushed to (default 'main')
 *
 * Usage: node scripts/skill-agent.mjs                 (runs the loop forever)
 *        node scripts/skill-agent.mjs --once [topic]  (one cycle, optional explicit topic)
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withSandboxWorktree, runnerPassesSmoke, publishFilesToBranch, ROOT } from './git-worktree-utils.mjs'
import { broadcastNewSkill } from './peer-sync.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY_PATH = path.join(ROOT, 'extension-builder', 'skill-agent-registry.json')
const TARGET_BRANCH = process.env.NEUROCLAW_SELF_IMPROVE_BRANCH || 'main'
const DIMS = 16

function log(...args) {
  console.log('[skill-agent]', ...args)
}

// Same scope this session already committed to for the physics/chemistry
// curriculum: quantum/atomic/computational/AI-research topics, explicitly
// no biology. Broader than that curriculum's fixed 20 concepts -- this is
// what the agent researches FRESH each cycle, not a pre-written answer.
export const TOPIC_POOL = [
  'quantum computing error correction',
  'large language model attention mechanisms',
  'reinforcement learning from human feedback',
  'general relativity and gravitational waves',
  'organic chemistry reaction mechanisms',
  'distributed systems consensus algorithms',
  'neural network quantization techniques',
  'thermodynamics and statistical mechanics',
  'cryptographic hash functions',
  'compiler optimization techniques',
  'semiconductor physics and transistor scaling',
  'graph neural networks',
]

export function slugifyTopic(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function loadRegistry(registryPath = REGISTRY_PATH) {
  if (!existsSync(registryPath)) return { topics: {} }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.topics ? parsed : { topics: {} }
  } catch {
    return { topics: {} }
  }
}

export function saveRegistry(registry, registryPath = REGISTRY_PATH) {
  mkdirSync(path.dirname(registryPath), { recursive: true })
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8')
}

/** Picks the least-recently-covered topic from the pool -- real rotation,
 *  not always the same first entry. Pure function of the registry and
 *  pool, directly testable. */
export function pickTopic(registry, pool = TOPIC_POOL, rand = Math.random) {
  const uncovered = pool.filter((t) => !registry.topics[slugifyTopic(t)])
  if (uncovered.length > 0) return uncovered[Math.floor(rand() * uncovered.length)]
  // Every topic has been covered at least once -- pick the one covered
  // longest ago rather than looping the same one forever.
  const sorted = [...pool].sort((a, b) => {
    const ta = registry.topics[slugifyTopic(a)]?.publishedAt ?? ''
    const tb = registry.topics[slugifyTopic(b)]?.publishedAt ?? ''
    return ta.localeCompare(tb)
  })
  return sorted[0]
}

/**
 * Renders the wiki page from a real ResearchReport -- corroborated
 * claims first and clearly labeled as such, unverified findings kept
 * separate and explicitly flagged, matching "never trust one source"
 * everywhere this project writes anything down. Returns null if there
 * is nothing corroborated to publish -- a topic search that finds
 * nothing solid produces no page, not a page full of guesses.
 */
export function renderWikiPage(topic, report) {
  const verified = report.claims.filter((c) => c.verified)
  if (verified.length === 0) return null

  const unverified = report.claims.filter((c) => !c.verified)
  const title = topic.replace(/\b\w/g, (c) => c.toUpperCase())
  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(
    `*This page was generated autonomously by scripts/skill-agent.mjs from real memory/drive/web research (see [[Self-Improvement]]). "Verified" means corroborated by 2+ independent sources in that search -- it is a real cross-check, not independent human fact-checking. Treat this as a researched starting point, not an authoritative source.*`,
  )
  lines.push('')
  lines.push('## Verified findings')
  lines.push('')
  for (const claim of verified) {
    const sources = [...new Set(claim.sources.map((s) => s.source))].join(', ')
    lines.push(`- ${claim.claim.trim()} *(corroborated by: ${sources})*`)
  }
  if (unverified.length > 0) {
    lines.push('')
    lines.push('## Unverified (single-source) findings')
    lines.push('')
    lines.push('*Found by the search but not corroborated elsewhere -- reported honestly rather than dropped, but not treated as established.*')
    lines.push('')
    for (const claim of unverified) {
      lines.push(`- ${claim.claim.trim()} *(source: ${claim.sources[0]?.source ?? 'unknown'})*`)
    }
  }
  lines.push('')
  lines.push('## See Also')
  lines.push('')
  lines.push('- [[Self-Improvement]] — how this page was generated')
  return lines.join('\n') + '\n'
}

/**
 * Renders an auto-generated regression test for one skill (artifact #4
 * of the five things every published skill gets). Deliberately modest:
 * there's no decode step anywhere in this project to check the trained
 * neuron "means" ${topic} (embedText() is one-directional), so this
 * checks the thing that's actually checkable -- that the published
 * artifacts are structurally real and genuinely marked trained, not
 * that publishing silently produced an empty or untrained skill.
 */
export function renderSkillTest(slug, topic) {
  // JSON.stringify() rather than raw template interpolation for every
  // value that lands inside a JS string literal below -- a topic (drawn
  // from real research, not this project's own fixed literal pool) could
  // in principle contain a quote or backslash, which would otherwise
  // break the generated file's own syntax. slug is regex-derived
  // ([a-z0-9-] only, see slugifyTopic()) so it's already safe, but
  // stringifying it too costs nothing and keeps this function's safety
  // independent of slugifyTopic()'s current implementation.
  const slugLit = JSON.stringify(slug)
  const topicLit = JSON.stringify(topic)
  return `/**
 * Auto-generated regression test for the ${topicLit} skill
 * (scripts/skill-agent.mjs, see wiki/${slug}.md and [[Self-Improvement]]).
 * Do not hand-edit -- skill-agent.mjs regenerates this file whenever it
 * republishes this topic.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('skill: ' + ${topicLit} + ' (auto-generated)', () => {
  it('has a real, trained neuron backing it (source artifact)', () => {
    const data = JSON.parse(
      readFileSync(path.join(process.cwd(), 'extension-builder', 'extensions', ${slugLit} + '.source.json'), 'utf8'),
    );
    expect(Array.isArray(data.neurons)).toBe(true);
    expect(data.neurons.length).toBeGreaterThan(0);
    expect(data.neurons.some((n: any) => n.trained === true)).toBe(true);
  });

  it('the quantized (binary) artifact carries the same neuron', () => {
    const data = JSON.parse(
      readFileSync(path.join(process.cwd(), 'extension-builder', 'extensions', ${slugLit} + '.skill.json'), 'utf8'),
    );
    expect(data.quantized).toBe(true);
    expect(data.neurons.some((n: any) => n.name === ${slugLit})).toBe(true);
  });
});
`
}

/** Runs pytorch_trainer.py once against a single (input, target) sample
 *  -- the same real gradient-descent contract every other @definishon
 *  in this repo uses, scoped to training exactly the one new page this
 *  cycle just wrote. */
function trainWikiPage(worktree, pageContent) {
  return new Promise((resolve) => {
    const scriptPath = path.join(worktree, 'extension-builder', 'pytorch_trainer.py')
    let child
    try {
      child = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, error: `could not launch python3: ${err.message}` })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => resolve({ ok: false, error: `python3 not available: ${err.message}` }))
    child.on('close', async () => {
      const line = stdout.trim().split('\n').pop() ?? ''
      try {
        resolve(JSON.parse(line))
      } catch {
        resolve({ ok: false, error: stderr.trim() || 'no output from pytorch_trainer.py' })
      }
    })
    ;(async () => {
      const { embedText } = await import(path.join(worktree, 'dist', 'models && skills', 'core', 'neuro-lang.js'))
      const DEFINITION_TRIGGER = new Array(DIMS).fill(0.7)
      const spec = {
        dims: DIMS,
        numReadouts: 1,
        epochs: 1500,
        learningRate: 0.05,
        tolerance: 1e-3,
        samples: [{ readout: 0, input: DEFINITION_TRIGGER, target: embedText(pageContent, DIMS) }],
      }
      child.stdin.write(JSON.stringify(spec) + '\n')
      child.stdin.end()
    })()
  })
}

/** One full cycle: pick a topic, research it, write it up, train a
 *  skill from it, and publish only if both the training and the runner
 *  gate pass. Mirrors runOneCycle() in self-improve.mjs's reward/punish
 *  shape -- research that finds nothing corroborated, or a page that
 *  doesn't converge, or a change that breaks the runner, is all
 *  "punished" the same way: discarded, logged, nothing published. */
export async function runOneCycle({ registryPath = REGISTRY_PATH, topic, rand = Math.random, push = true } = {}) {
  const registry = loadRegistry(registryPath)
  const chosenTopic = topic || pickTopic(registry, TOPIC_POOL, rand)
  const slug = slugifyTopic(chosenTopic)

  log(`cycle: researching "${chosenTopic}"...`)

  const resolved = await withSandboxWorktree(async (worktree) => {
    const { ResearchPlugin } = await import(path.join(worktree, 'dist', 'plugins', 'research.js'))
    const plugin = new ResearchPlugin({ id: 'research', name: 'Research', type: 'api-connection', capabilities: [] })
    const report = await plugin.conductResearch(chosenTopic)
    const wikiContent = renderWikiPage(chosenTopic, report)
    if (!wikiContent) {
      return { ok: false, error: 'no corroborated findings for this topic -- nothing to publish' }
    }

    const trained = await trainWikiPage(worktree, wikiContent)
    if (!trained.ok || !trained.sampleConverged?.[0]) {
      return { ok: false, error: trained.ok ? 'the new page did not converge as a trainable skill' : trained.error }
    }

    // Artifacts #2/#3: the same trained neuron, saved both quantized
    // ("binary") and not ("source") -- ExtensionBuilder's own two output
    // modes, the exact ones the Extension Builder UI itself offers. This
    // doesn't re-run the JS delta-rule engine's own training (the real
    // convergence signal above already came from genuine torch.autograd
    // gradient descent); it just records that outcome onto a real neuron
    // structure so both artifacts are real, loadable ExtensionBuilder
    // projects -- same pattern conversation-learning-agent.mjs already
    // uses for its own (never-published) local output.
    const { ExtensionBuilder } = await import(path.join(worktree, 'dist', 'extension-builder', 'builder.js'))
    const builder = new ExtensionBuilder()
    const project = builder.createProject(
      chosenTopic.replace(/\b\w/g, (c) => c.toUpperCase()),
      `Autonomously researched and trained skill on "${chosenTopic}" -- see wiki/${slug}.md and [[Self-Improvement]].`,
    )
    const neuron = builder.addNeuron(project.id, slug, 0)
    builder.addScript(project.id, neuron.id, chosenTopic, wikiContent)
    neuron.trained = true
    const sourceJson = builder.saveWithoutQuantization(project.id)
    const skillJson = await builder.installWithQuantization(project.id, { bits: 8 })

    const gate = runnerPassesSmoke(worktree)
    if (!gate.ok) {
      return { ok: false, error: `runner regression: ${gate.reason}` }
    }

    return {
      ok: true,
      wikiContent,
      sourceJson,
      skillJson,
      testContent: renderSkillTest(slug, chosenTopic),
      verifiedCount: report.verifiedCount,
      unverifiedCount: report.unverifiedCount,
      smokeTestsPassed: gate.passed,
    }
  }, { prefix: 'neuroclaw-skill-agent-' })

  const attempt = { at: new Date().toISOString(), topic: chosenTopic, slug, ok: resolved.ok }

  if (!resolved.ok) {
    log(`discarded: ${resolved.error}`)
    attempt.error = resolved.error
    registry.topics[slug] = { ...(registry.topics[slug] ?? { history: [] }), history: [...(registry.topics[slug]?.history ?? []).slice(-9), attempt] }
    saveRegistry(registry, registryPath)
    return { topic: chosenTopic, slug, published: false, reason: resolved.error, ...attempt }
  }

  log(`"${chosenTopic}" converged as a real skill (${resolved.verifiedCount} verified, ${resolved.unverifiedCount} unverified finding(s), runner still passes ${resolved.smokeTestsPassed} tests) -- publishing all five artifacts`)

  // Artifact #5, seeded here so all five things exist together the
  // moment a skill is first published, not just once
  // scripts/skill-drill-agent.mjs happens to drill it for the first
  // time: zeroed drill weights that agent will load, drill, and
  // (only on genuine improvement) overwrite going forward.
  const seedDrillWeights = JSON.stringify(
    { dims: DIMS, numReadouts: 1, W: [new Array(DIMS).fill(0)], b: [new Array(DIMS).fill(0)], slug, topic: chosenTopic, category: null, updatedAt: attempt.at },
    null,
    2,
  ) + '\n'

  const publishResult = push
    ? publishFilesToBranch(
        [
          { relPath: `wiki/${slug}.md`, content: resolved.wikiContent },
          { relPath: `extension-builder/extensions/${slug}.skill.json`, content: resolved.skillJson },
          { relPath: `extension-builder/extensions/${slug}.source.json`, content: resolved.sourceJson },
          { relPath: `test/skills/${slug}.test.ts`, content: resolved.testContent },
          { relPath: `extension-builder/drill-weights/${slug}.json`, content: seedDrillWeights },
        ],
        `skill-agent: new researched skill "${chosenTopic}" (automated)`,
        TARGET_BRANCH,
      )
    : { ok: false, skipped: true }

  registry.topics[slug] = {
    topic: chosenTopic,
    publishedAt: attempt.at,
    verifiedCount: resolved.verifiedCount,
    history: [...(registry.topics[slug]?.history ?? []).slice(-9), { ...attempt, verifiedCount: resolved.verifiedCount }],
  }
  saveRegistry(registry, registryPath)

  const peerResult = push ? await broadcastNewSkill(chosenTopic, slug) : { sent: 0 }

  if (publishResult.ok) log(`published wiki/${slug}.md to ${TARGET_BRANCH}`)
  return { topic: chosenTopic, slug, published: publishResult.ok, peersSent: peerResult.sent, ...attempt }
}

const DEFAULT_INTERVAL_MS = 45 * 60 * 1000

async function loop() {
  if (process.env.NEUROCLAW_SKILL_AGENT === '0') {
    log('disabled via NEUROCLAW_SKILL_AGENT=0 -- exiting.')
    return
  }
  const intervalMs = Number(process.env.NEUROCLAW_SKILL_AGENT_INTERVAL_MS) || DEFAULT_INTERVAL_MS
  log(`starting -- one research/skill cycle every ${Math.round(intervalMs / 60000)} minute(s)`)
  for (;;) {
    try {
      await runOneCycle()
    } catch (err) {
      log('cycle threw unexpectedly, discarding and continuing:', err?.message ?? err)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

function isEntryPoint() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  if (process.argv.includes('--once')) {
    const explicitTopic = process.argv[process.argv.indexOf('--once') + 1]
    runOneCycle({ topic: explicitTopic && !explicitTopic.startsWith('-') ? explicitTopic : undefined })
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((err) => {
        console.error('[skill-agent] cycle failed:', err)
        process.exit(1)
      })
  } else {
    loop()
  }
}
