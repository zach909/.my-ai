#!/usr/bin/env node
/**
 * build-physics-chemistry-network.mjs — "primary coding skills, science,
 * research, computation... when I say science I mean like the most basic
 * stuff like quantum, then atoms, moles, relativity... I absolutely do
 * not want to learn biology": a genuine physics/chemistry curriculum
 * (quantum mechanics, atomic theory, the mole concept, special/general
 * relativity), trained the same real @definishon way build-main-network.mjs
 * trained cmudict and build-self-knowledge-network.mjs trained the wiki --
 * every concept below is an original, factually-accurate short definition
 * (not copied from any external source), fit via genuine torch.autograd
 * gradient descent against the same fixed DEFINITION_TRIGGER contract
 * every other @definishon in this repo uses. Deliberately, explicitly
 * scoped OFF biology per the user's stated constraint -- every concept
 * here is physics or chemistry, nothing from life sciences.
 *
 * Usage: node extension-builder/build-physics-chemistry-network.mjs
 * (requires a fresh `node scripts/build-backend.mjs` first)
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIMS = 16; // matches builder.js train()'s fixed dims / the train-pytorch endpoint

const { ExtensionBuilder } = await import(path.join(ROOT, 'dist', 'extension-builder', 'builder.js'));
const { embedText } = await import(path.join(ROOT, 'dist', 'models && skills', 'core', 'neuro-lang.js'));

const DEFINITION_TRIGGER = new Array(DIMS).fill(0.7);

// Overridable via env vars so an external caller (e.g. the autonomous
// self-improvement loop in scripts/self-improve.mjs) can try different
// hyperparameters against this same curriculum without editing this file
// -- defaults match the values this script always used before these
// existed, so a plain `node build-physics-chemistry-network.mjs` behaves
// exactly as it did before.
const EPOCHS = Number(process.env.SELF_IMPROVE_EPOCHS) || 1500;
const LEARNING_RATE = Number(process.env.SELF_IMPROVE_LR) || 0.05;
const TOLERANCE = Number(process.env.SELF_IMPROVE_TOLERANCE) || 1e-3;

function log(...args) { console.log('[build-physics-chemistry-network]', ...args); }

// ── Curriculum: quantum mechanics, atomic theory, the mole, relativity ─────
// Each definition is original text written for this project, factually
// accurate at an introductory level, and deliberately concise -- the point
// is a correct, trainable target, not an exhaustive textbook chapter.
// NO biology, per the explicit constraint.

const CURRICULUM = [
  // -- Quantum mechanics --
  {
    slug: 'quantum_mechanics',
    definition: 'Quantum mechanics is the physical theory describing matter and energy at the scale of atoms and subatomic particles. It replaces the definite trajectories of classical physics with probability distributions: a particle\'s state is described by a wavefunction, and measurable quantities like position or momentum are only predictable as probabilities until measured.',
  },
  {
    slug: 'wave_particle_duality',
    definition: 'Wave-particle duality is the observation that quantum objects such as electrons and photons exhibit both wave-like behavior (interference, diffraction) and particle-like behavior (discrete, localized detection), depending on how they are measured. Neither classical picture alone is sufficient to describe them.',
  },
  {
    slug: 'heisenberg_uncertainty_principle',
    definition: 'The Heisenberg uncertainty principle states that certain pairs of physical properties, such as position and momentum, cannot both be known to arbitrary precision simultaneously. The product of the uncertainties in these paired quantities has a fixed lower bound set by Planck\'s constant; this is a fundamental property of quantum systems, not a limitation of measurement instruments.',
  },
  {
    slug: 'schrodinger_equation',
    definition: 'The Schrodinger equation is the fundamental equation of non-relativistic quantum mechanics, describing how a quantum system\'s wavefunction evolves over time. Solving it for a given system (such as an electron in a potential well) yields the allowed energy levels and corresponding probability distributions for that system.',
  },
  {
    slug: 'quantum_superposition',
    definition: 'Quantum superposition is the principle that a quantum system can exist in a combination of multiple distinct states simultaneously until it is measured, at which point it is observed in only one of those states. The probability of observing each outcome is determined by the wavefunction describing the superposition.',
  },
  {
    slug: 'quantum_entanglement',
    definition: 'Quantum entanglement occurs when two or more particles are correlated in such a way that the quantum state of each particle cannot be described independently of the others, even when the particles are separated by large distances. Measuring one entangled particle instantaneously constrains the possible outcomes of measuring its partner.',
  },
  // -- Atomic theory --
  {
    slug: 'atomic_theory',
    definition: 'Atomic theory is the scientific model describing matter as composed of discrete units called atoms, each consisting of a dense positively-charged nucleus (protons and neutrons) surrounded by negatively-charged electrons. Different elements correspond to atoms with different numbers of protons (atomic number).',
  },
  {
    slug: 'atomic_structure',
    definition: 'An atom\'s structure consists of a nucleus, made of protons (positive charge) and neutrons (no charge), surrounded by electrons (negative charge) occupying quantized energy levels called orbitals. Nearly all of an atom\'s mass is in the nucleus, while its size is determined by the extent of the electron cloud.',
  },
  {
    slug: 'electron_configuration',
    definition: 'Electron configuration describes how electrons are distributed among an atom\'s orbitals, filled according to increasing energy level subject to the Pauli exclusion principle (no two electrons in an atom can have identical quantum numbers) and Hund\'s rule. It determines an element\'s chemical bonding behavior.',
  },
  {
    slug: 'periodic_table',
    definition: 'The periodic table arranges the chemical elements by increasing atomic number into rows (periods) and columns (groups) such that elements in the same column share similar chemical properties, arising from having the same number of valence electrons in their outermost occupied orbital.',
  },
  {
    slug: 'chemical_bonding',
    definition: 'Chemical bonding is the attraction between atoms that allows them to form compounds, arising from interactions between valence electrons. Ionic bonds form through electron transfer between atoms of differing electronegativity; covalent bonds form through the sharing of electron pairs between atoms.',
  },
  // -- The mole and quantitative chemistry --
  {
    slug: 'mole_concept',
    definition: 'The mole is the SI base unit for amount of substance, defined as exactly 6.02214076 x 10^23 elementary entities (Avogadro\'s number). It provides a bridge between the atomic scale (individual atoms/molecules) and the macroscopic scale (grams that can be weighed on a lab balance).',
  },
  {
    slug: 'avogadro_number',
    definition: 'Avogadro\'s number, approximately 6.02214076 x 10^23, is the fixed number of elementary entities (atoms, molecules, ions) contained in exactly one mole of a substance. It is defined as an exact constant in the modern SI system, not an experimentally measured approximation.',
  },
  {
    slug: 'molar_mass',
    definition: 'Molar mass is the mass of one mole of a given substance, expressed in grams per mole. It is numerically equal to a substance\'s atomic or molecular weight in atomic mass units, and is the conversion factor used to relate a measured mass of material to the number of moles (and hence particles) it contains.',
  },
  {
    slug: 'stoichiometry',
    definition: 'Stoichiometry is the quantitative relationship between the amounts of reactants and products in a chemical reaction, derived from the balanced chemical equation. It is used to calculate how much of one substance is produced or consumed given a known amount of another.',
  },
  // -- Relativity --
  {
    slug: 'special_relativity',
    definition: 'Special relativity, developed by Einstein in 1905, is built on two postulates: the laws of physics are the same in all inertial (non-accelerating) reference frames, and the speed of light in a vacuum is the same for all observers regardless of their motion. Consequences include time dilation, length contraction, and the equivalence of mass and energy.',
  },
  {
    slug: 'general_relativity',
    definition: 'General relativity, developed by Einstein in 1915, extends special relativity to include gravity, describing it not as a force but as the curvature of spacetime caused by mass and energy. Objects move along the straightest possible paths (geodesics) through this curved spacetime, which appears to us as gravitational attraction.',
  },
  {
    slug: 'spacetime',
    definition: 'Spacetime is the four-dimensional continuum combining the three dimensions of space with time into a single geometric structure, used in relativity to describe the position and motion of events. The geometry of spacetime is flat in special relativity and curved by mass-energy in general relativity.',
  },
  {
    slug: 'mass_energy_equivalence',
    definition: 'Mass-energy equivalence, expressed by Einstein\'s equation E = mc^2, states that the energy (E) of a system is equal to its mass (m) multiplied by the speed of light squared (c^2). It implies that mass and energy are interchangeable and that a small amount of mass corresponds to an enormous amount of energy.',
  },
  {
    slug: 'time_dilation',
    definition: 'Time dilation is the difference in elapsed time measured by two observers, caused either by relative velocity between them (special relativity) or by their difference in gravitational potential (general relativity). A clock moving relative to an observer, or one deeper in a gravitational well, runs slower as measured by that observer.',
  },
];

function addCurriculumNeurons(builder, projectId) {
  const readoutNames = [];
  for (const { slug, definition } of CURRICULUM) {
    const neuron = builder.addNeuron(projectId, slug, 0);
    if (!neuron) continue;
    neuron.definition = definition; // the real @definishon-style training target
    readoutNames.push(neuron.name);
  }
  return readoutNames;
}

function trainCurriculumBatch() {
  return new Promise((resolve) => {
    const scriptPath = path.join(ROOT, 'extension-builder', 'pytorch_trainer.py');
    let child;
    try {
      child = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: `could not launch python3: ${err.message}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ ok: false, error: `python3 not available: ${err.message}` }));
    child.on('close', () => {
      const line = stdout.trim().split('\n').pop() ?? '';
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ ok: false, error: stderr.trim() || 'no output from pytorch_trainer.py' });
      }
    });

    const samples = CURRICULUM.map(({ definition }, idx) => ({
      readout: idx,
      input: DEFINITION_TRIGGER,
      target: embedText(definition, DIMS),
    }));
    const spec = { dims: DIMS, numReadouts: CURRICULUM.length, epochs: EPOCHS, learningRate: LEARNING_RATE, tolerance: TOLERANCE, samples };
    child.stdin.write(JSON.stringify(spec) + '\n');
    child.stdin.end();
  });
}

async function main() {
  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    'Physics & Chemistry Curriculum',
    'Quantum mechanics, atomic theory, the mole concept, and relativity -- real @definishon training, explicitly no biology',
  );

  const readoutNames = addCurriculumNeurons(builder, project.id);
  log(`Added ${readoutNames.length} curriculum neurons: ${readoutNames.join(', ')}`);

  log('Training the curriculum batch via genuine torch.autograd gradient descent...');
  const result = await trainCurriculumBatch();

  let trainedCount = 0;
  if (result.ok) {
    log(`PyTorch training converged=${result.converged} after ${result.epochsRun} epoch(s) (torch ${result.torchVersion})`);
    for (let i = 0; i < readoutNames.length; i++) {
      const neuron = Array.from(project.neurons.values()).find((n) => n.name === readoutNames[i]);
      if (!neuron) continue;
      neuron.trained = result.sampleConverged[i] === true;
      if (neuron.trained) trainedCount++;
    }
    log(`${trainedCount}/${readoutNames.length} curriculum neurons genuinely converged and are marked trained`);
  } else {
    log(`PyTorch training unavailable (${result.error}) -- curriculum neurons kept as untrained definitions.`);
    log('This is the expected optional-dependency degradation, not a build failure: rerun with a working python3+torch to actually train them.');
  }

  const outDir = path.join(ROOT, 'extension-builder', 'extensions');
  mkdirSync(outDir, { recursive: true });
  const projectJson = builder.saveWithoutQuantization(project.id);
  const outPath = path.join(outDir, `physics_chemistry_network_${Date.now()}.ext.json`);
  writeFileSync(outPath, projectJson, 'utf8');

  let weightsPath = null;
  if (result.ok) {
    weightsPath = path.join(outDir, `physics_chemistry_weights_${Date.now()}.json`);
    writeFileSync(weightsPath, JSON.stringify({
      dims: DIMS,
      names: readoutNames,
      W: result.W,
      b: result.b,
      samples: CURRICULUM.map(({ definition }, idx) => ({ readout: idx, input: DEFINITION_TRIGGER, target: embedText(definition, DIMS) })),
    }, null, 2), 'utf8');
    log(`Saved weights: ${path.relative(ROOT, weightsPath)}`);
  }

  log(`Saved project: ${path.relative(ROOT, outPath)}`);
  log(`Total neurons: ${project.neurons.size} (${trainedCount} trained)`);
  return { outPath, weightsPath, curriculumCount: readoutNames.length, trainedCount, pytorchOk: result.ok };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
}).catch((err) => {
  console.error('[build-physics-chemistry-network] FAILED:', err);
  process.exit(1);
});
