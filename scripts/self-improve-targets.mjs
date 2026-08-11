/**
 * self-improve-targets.mjs — the fixed whitelist of skill-training
 * scripts the self-improvement loop is allowed to touch, and how to read
 * a scalar score out of each one's own JSON summary output.
 *
 * Split out from self-improve.mjs into its own module so both
 * self-improve.mjs and peer-sync.mjs can import it without a circular
 * dependency (self-improve.mjs broadcasts through peer-sync.mjs, and
 * peer-sync.mjs validates incoming peer messages against this same
 * whitelist -- a real ES module cycle between those two files left
 * TARGETS still undefined at peer-sync.mjs's top-level evaluation time).
 */

// "It's not just the core code, it's the skills too": every
// @definishon-trained skill network built this session is in scope here,
// not just the two most recent ones.
export const TARGETS = [
  {
    script: 'extension-builder/build-physics-chemistry-network.mjs',
    metric: (s) => (s.curriculumCount > 0 ? s.trainedCount / s.curriculumCount : 0),
  },
  {
    script: 'extension-builder/train-coding-skills.mjs',
    metric: (s) => s.finalAccuracy ?? 0,
  },
  {
    script: 'extension-builder/build-main-network.mjs',
    metric: (s) => (s.cmudictCount > 0 ? s.trainedCount / s.cmudictCount : 0),
  },
  {
    script: 'extension-builder/build-self-knowledge-network.mjs',
    metric: (s) => (s.wikiCount > 0 ? s.trainedCount / s.wikiCount : 0),
  },
]
