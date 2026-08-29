/**
 * THE EQUATION.
 *
 * One equation defines this whole system. Not a family of related ones per
 * subsystem -- the same one, everywhere: the unified brain, what used to be the
 * elastic core, every all-connected neuron, the hyperdimensional term and the
 * wave. This file is where it is written down.
 *
 * It is written twice in this project, on purpose, and that is the point of
 * this file existing:
 *
 *   - HyperDimensionalEngine.settle() computes it FAST. Flat typed arrays,
 *     hoisted rows, an unrolled inner loop, terms folded together. Fast code
 *     is unreadable code, and unreadable code is where an equation quietly
 *     stops being the equation.
 *
 *   - applyEquation() below computes it PLAINLY. One neuron at a time, one
 *     term at a time, named after the thing it is. Nothing is folded and
 *     nothing is skipped.
 *
 * A test runs both on the same network and requires the same answer to Float32
 * precision. So the readable one is not documentation that drifts -- it is the
 * definition, and the fast one is checked against it.
 *
 * ── The equation ────────────────────────────────────────────────────────────
 *
 * For neuron i, dimension d, with N neurons and D dimensions:
 *
 *   EVERY CONNECTION into i has two weights and two biases.
 *
 *     its own weight        connDiag[i][d][j]
 *     its own bias          connBias[i][d][j]  (and bias[i][d], the neuron's)
 *     the network's weight  hyperGain · mean_k( state[k][d] · modWeight[i][k] ) · senderGain[j]
 *     the network's bias    hyperAdd  · mean_k( state[k][d] · addWeight[i][k] )
 *
 *   Every connection is its own window into the whole network. modWeight[i] is
 *   a ROW -- receiver i's learned variables, one per neuron -- and senderGain
 *   scales that reading by who is sending, so the connection A->B and the
 *   connection C->B get different numbers out of one identical network state.
 *   A window per (receiver, sender) pair with its own N variables would be
 *   N^3; this is that factorised to N^2, which is what a network that grows
 *   with every installed skill can carry.
 *
 *   The two weights combine and the two biases combine:
 *
 *     connections = Σ_j state[j][d]·connDiag[i][d][j]
 *                 + Σ_j connBias[i][d][j]
 *                 + Σ_j state[j][(d-1) mod D]·connShift[i][d][j]·strength
 *
 *     state'[i][d] = tanh( bias[i][d]
 *                        + connections · networkScale
 *                        + networkWeight · mean_k(state[k][d])
 *                        + networkBias
 *                        + wave[i] )
 *
 *   where networkScale = hyperScale · mean_k(state[k][d]·modWeight[k]), or 1
 *   when hyperScale is 0. Adding one weight to every connection into a neuron
 *   is that weight times the mean of what the neuron hears, which is the
 *   networkWeight term.
 *
 *   THE WAVE is the same shape again, in complex numbers. Every neuron owns
 *   one wave. A connection carries the wave of the neuron GIVING it, edited by
 *   two wave weights and two wave biases combined the same way:
 *
 *     waveWeight = connWaveGain[i][k]·e^{i·connWavePhase[i][k]}
 *                + hyperWaveGain · mean_k( pool[bin_k] · modWaveWeight[k] )
 *     waveBias   = connWaveBias[i][k] + i·connWaveBiasIm[i][k]
 *                + hyperWaveAdd  · mean_k( pool[bin_k] · addWaveWeight[k] )
 *
 *     heard[i] = mean_k≠i( waveWeight·wave[k] + waveBias
 *                        + connWaveShift[i][k]·pool[bin_k - 1] )
 *              + neuronWaveBias[i]
 *              + pool[bin_i] - wave[i]        ← the pool at its own frequency
 *
 *     wave'[i] = waveFeedback · (amplitude[i] / maxAmplitude) · heard[i]
 *     pool'[bin_i] += wave'[i]                ← where waves meet and cancel
 *     waveTerm[i]  = waveGain · Re( heard[i] · e^{-i·phase[i]} )
 *
 *   A DRIVEN neuron is clamped to the input and emits its signature instead of
 *   computing. A HELD neuron -- one whose expert group was not asked for this
 *   tick -- keeps the state it had. Everything else runs the equation.
 */

/** Every number the equation reads. Flat arrays, indexed exactly as the engine holds them. */
export interface EquationState {
  neurons: number;
  /** Content dimensions plus the reserved input-flag dimension. */
  dimensions: number;
  /** [d][i] -- dimension-major, the layout the engine settles in. */
  states: Float32Array;
  /** [i][d] */
  bias: Float32Array;
  /** [i][d][j] */
  connDiag: Float32Array;
  connShift: Float32Array;
  /** [i][d][j], empty when the network has no per-connection biases. */
  connBias: Float32Array;
  /** [i][k] -- receiver i's window into the network. */
  modWeight: Float32Array;
  addWeight: Float32Array;
  /** [j] -- how much a connection from j scales its receiver's window. */
  senderGain: Float32Array;
  /** [i][k] */
  connWaveGain: Float32Array;
  connWavePhase: Float32Array;
  connWaveBias: Float32Array;
  connWaveBiasIm: Float32Array;
  connWaveShift: Float32Array;
  /** [i][k] -- the wave copies of the same window. */
  modWaveWeight: Float32Array;
  addWaveWeight: Float32Array;
  neuronWaveBiasRe: Float32Array;
  neuronWaveBiasIm: Float32Array;
  waveFreq: Float32Array;
  wavePhase: Float32Array;
  waveRe: Float32Array;
  waveIm: Float32Array;
  /** [bin] */
  poolRe: Float32Array;
  poolIm: Float32Array;
}

export interface EquationSettings {
  hyperGain: number;
  hyperAdd: number;
  hyperScale: number;
  hyperWaveGain: number;
  hyperWaveAdd: number;
  waveGain: number;
  waveFeedback: number;
  crossInfluenceStrength: number;
  connectionBias: boolean;
  /** Frequency band and bin count, so a wave is placed the same way here as there. */
  minWaveFreq: number;
  maxWaveFreq: number;
  waveBins: number;
  /** Ceiling on any single frequency's magnitude in the pool. */
  poolCeiling: number;
  /** Live correction: per-iteration energy divergence above this is "off track". */
  divergenceTolerance: number;
  /** Live correction: how many consecutive off-track iterations before damping. */
  sustainedDivergenceTicks: number;
}

/**
 * What live correction was holding when the iteration began, and what it is
 * holding after.
 *
 * Not a term of the equation so much as a brake on it: when the network's
 * energy keeps diverging from its own running estimate, every computed neuron
 * is damped halfway back toward where it was. It fires rarely and it is part
 * of what the network actually computes -- leaving it out of this file is what
 * made the first version of the comparison test disagree with the engine by
 * 0.14 on some random draws and agree on others.
 */
export interface CorrectionState {
  emaEnergy: number;
  hasEma: boolean;
  sustainedDivergence: number;
  /** Smoothing for the running energy estimate (the engine's influenceDecay). */
  influenceDecay: number;
}

export interface EquationResult {
  /** Live correction's state after this iteration, to carry into the next. */
  correction: CorrectionState;
  /** How many times the damping fired this iteration (0 or 1). */
  liveCorrections: number;
  /** [d][i], same layout as the input. */
  states: Float32Array;
  waveRe: Float32Array;
  waveIm: Float32Array;
  poolRe: Float32Array;
  poolIm: Float32Array;
  /** What each neuron heard from the waves, as it entered its tanh. */
  waveTerm: Float32Array;
}

function binFor(frequency: number, s: EquationSettings): number {
  const span = (s.maxWaveFreq - s.minWaveFreq) || 1;
  const slot = Math.round(((frequency - s.minWaveFreq) / span) * (s.waveBins - 1));
  return slot < 0 ? 0 : (slot >= s.waveBins ? s.waveBins - 1 : slot);
}

/**
 * One iteration of the equation, computed plainly.
 *
 * `driven` are clamped to `input`; `held` keep what they had; everything else
 * is computed. This is one settle iteration -- run it repeatedly for a network
 * with more than one propagation step.
 */
export function applyEquation(
  state: EquationState,
  settings: EquationSettings,
  input: number[],
  driven: Set<number>,
  held: Set<number> = new Set(),
  correction: CorrectionState = { emaEnergy: 0, hasEma: false, sustainedDivergence: 0, influenceDecay: 0.95 },
): EquationResult {
  const N = state.neurons;
  const D = state.dimensions;
  const at = (d: number, i: number) => state.states[d * N + i];

  // ── The wave, first: what a neuron hears enters the tanh below ──────────
  const waveTerm = new Float32Array(N);
  const nextWaveRe = new Float32Array(N);
  const nextWaveIm = new Float32Array(N);
  const nextPoolRe = new Float32Array(settings.waveBins);
  const nextPoolIm = new Float32Array(settings.waveBins);

  if (settings.waveGain !== 0) {
    // Each neuron's amplitude is the force of its own input, and its bin is
    // where its wave lands in the shared pool.
    const amplitude = new Float32Array(N);
    const bin = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      let energy = 0;
      for (let d = 1; d < D; d++) energy += at(d, i) * at(d, i);
      amplitude[i] = Math.sqrt(energy);
      bin[i] = binFor(state.waveFreq[i], settings);
    }

    // A driven neuron's wave IS its signature; everything else carries the
    // wave that formed in it last iteration.
    const prevRe = Float32Array.from(state.waveRe);
    const prevIm = Float32Array.from(state.waveIm);
    for (const i of driven) {
      prevRe[i] = amplitude[i] * Math.cos(state.wavePhase[i]);
      prevIm[i] = amplitude[i] * Math.sin(state.wavePhase[i]);
    }

    // The network's wave weight and wave bias: every neuron's wave through a
    // personalised variable, added together.
    // Each receiving neuron's own window into the pool.
    const netWeightRe = new Float32Array(N);
    const netWeightIm = new Float32Array(N);
    const netBiasRe = new Float32Array(N);
    const netBiasIm = new Float32Array(N);
    if (settings.hyperWaveGain !== 0 || settings.hyperWaveAdd !== 0) {
      for (let i = 0; i < N; i++) {
        let mr = 0, mi = 0, ar = 0, ai = 0;
        for (let k = 0; k < N; k++) {
          const re = state.poolRe[bin[k]];
          const im = state.poolIm[bin[k]];
          mr += re * state.modWaveWeight[i * N + k];
          mi += im * state.modWaveWeight[i * N + k];
          ar += re * state.addWaveWeight[i * N + k];
          ai += im * state.addWaveWeight[i * N + k];
        }
        netWeightRe[i] = settings.hyperWaveGain * mr / N;
        netWeightIm[i] = settings.hyperWaveGain * mi / N;
        netBiasRe[i] = settings.hyperWaveAdd * ar / N;
        netBiasIm[i] = settings.hyperWaveAdd * ai / N;
      }
    }

    const maxAmplitude = Math.sqrt(Math.max(1, D - 1));
    for (let i = 0; i < N; i++) {
      let heardRe = 0, heardIm = 0;
      for (let k = 0; k < N; k++) {
        if (k === i) continue; // a neuron does not carry its own wave to itself
        const gain = state.connWaveGain[i * N + k];
        const turn = state.connWavePhase[i * N + k];
        // The two wave weights combined, and the two wave biases combined.
        // This connection's own share of its receiver's window.
        const share = state.senderGain[k];
        const wRe = gain * Math.cos(turn) + netWeightRe[i] * share;
        const wIm = gain * Math.sin(turn) + netWeightIm[i] * share;
        const bRe = state.connWaveBias[i * N + k] + netBiasRe[i] * share;
        const bIm = state.connWaveBiasIm[i * N + k] + netBiasIm[i] * share;
        // Run against the wave of the neuron giving it.
        let editedRe = wRe * prevRe[k] - wIm * prevIm[k] + bRe;
        let editedIm = wRe * prevIm[k] + wIm * prevRe[k] + bIm;
        const shift = state.connWaveShift[i * N + k];
        if (shift !== 0) {
          const neighbour = bin[k] === 0 ? settings.waveBins - 1 : bin[k] - 1;
          editedRe += shift * state.poolRe[neighbour];
          editedIm += shift * state.poolIm[neighbour];
        }
        heardRe += editedRe;
        heardIm += editedIm;
      }
      heardRe /= N;
      heardIm /= N;
      heardRe += state.neuronWaveBiasRe[i];
      heardIm += state.neuronWaveBiasIm[i];
      // And the pool at its own frequency, its own last contribution removed.
      heardRe += state.poolRe[bin[i]] - prevRe[i];
      heardIm += state.poolIm[bin[i]] - prevIm[i];

      const cos = Math.cos(state.wavePhase[i]);
      const sin = Math.sin(state.wavePhase[i]);
      waveTerm[i] = settings.waveGain * (heardRe * cos + heardIm * sin);

      if (driven.has(i)) {
        nextWaveRe[i] = prevRe[i];
        nextWaveIm[i] = prevIm[i];
      } else if (amplitude[i] !== 0 && settings.waveFeedback !== 0) {
        const force = settings.waveFeedback * (amplitude[i] / maxAmplitude);
        nextWaveRe[i] = force * heardRe;
        nextWaveIm[i] = force * heardIm;
      }
      nextPoolRe[bin[i]] += nextWaveRe[i];
      nextPoolIm[bin[i]] += nextWaveIm[i];
    }

    for (let b = 0; b < settings.waveBins; b++) {
      const magnitude = Math.sqrt(nextPoolRe[b] * nextPoolRe[b] + nextPoolIm[b] * nextPoolIm[b]);
      if (magnitude > settings.poolCeiling) {
        const shrink = settings.poolCeiling / magnitude;
        nextPoolRe[b] *= shrink;
        nextPoolIm[b] *= shrink;
      }
    }
  }

  // ── The network's weight and bias, per dimension ────────────────────────
  const networkWeight = new Float32Array(N * D);
  const networkBias = new Float32Array(N * D);
  const networkScale = new Float32Array(N * D).fill(1);
  const heardMean = new Float32Array(D);
  const anyHyper = settings.hyperGain !== 0 || settings.hyperAdd !== 0 || settings.hyperScale !== 0;
  if (anyHyper) {
    for (let d = 0; d < D; d++) {
      // What a connection carries at this dimension, weighted by who sends it.
      let sent = 0;
      for (let k = 0; k < N; k++) sent += at(d, k) * state.senderGain[k];
      heardMean[d] = sent / N;

      for (let i = 0; i < N; i++) {
        let say = 0, offset = 0;
        for (let k = 0; k < N; k++) {
          say += at(d, k) * state.modWeight[i * N + k];
          offset += at(d, k) * state.addWeight[i * N + k];
        }
        say /= N;
        networkWeight[i * D + d] = settings.hyperGain * say;
        networkScale[i * D + d] = settings.hyperScale === 0 ? 1 : settings.hyperScale * say;
        networkBias[i * D + d] = settings.hyperAdd * offset / N;
      }
    }
  }

  // ── Every neuron ────────────────────────────────────────────────────────
  const next = new Float32Array(D * N);
  for (let i = 0; i < N; i++) {
    if (driven.has(i)) {
      next[0 * N + i] = 1.0; // marked as externally driven
      for (let d = 1; d < D; d++) next[d * N + i] = clamp(input[d - 1] ?? 0);
      continue;
    }
    if (held.has(i)) {
      for (let d = 0; d < D; d++) next[d * N + i] = at(d, i);
      continue;
    }
    for (let d = 0; d < D; d++) {
      const shiftDim = (d - 1 + D) % D;
      let connections = 0;
      for (let j = 0; j < N; j++) {
        connections += at(d, j) * state.connDiag[(i * D + d) * N + j];
        connections += at(shiftDim, j) * state.connShift[(i * D + d) * N + j] * settings.crossInfluenceStrength;
        if (settings.connectionBias) connections += state.connBias[(i * D + d) * N + j];
      }
      const window = i * D + d;
      next[d * N + i] = Math.tanh(
        state.bias[i * D + d]
        + connections * networkScale[window]
        + networkWeight[window] * heardMean[d]
        + networkBias[window]
        + waveTerm[i],
      );
    }
  }

  // ── Live correction ─────────────────────────────────────────────────────
  //
  // The energy this iteration produced, against the running estimate of what
  // it should have been. Diverging for enough iterations in a row means the
  // network is running away, and every computed neuron is damped halfway back
  // toward where it was.
  const dims = D - 1;
  let energy = 0;
  for (let i = 0; i < N; i++) {
    for (let d = 1; d < D; d++) energy += next[d * N + i] * next[d * N + i];
  }
  const actualEnergy = energy / (N * dims);
  const predictedEnergy = correction.hasEma ? correction.emaEnergy : actualEnergy;
  const divergence = Math.abs(actualEnergy - predictedEnergy);
  let sustained = divergence > settings.divergenceTolerance ? correction.sustainedDivergence + 1 : 0;
  let liveCorrections = 0;
  if (sustained >= settings.sustainedDivergenceTicks) {
    for (let i = 0; i < N; i++) {
      if (driven.has(i)) continue;
      for (let d = 0; d < D; d++) next[d * N + i] = 0.5 * next[d * N + i] + 0.5 * at(d, i);
    }
    liveCorrections = 1;
    sustained = 0;
  }
  let settledEnergy = actualEnergy;
  if (sustained !== 0) {
    let damped = 0;
    for (let i = 0; i < N; i++) {
      for (let d = 1; d < D; d++) damped += next[d * N + i] * next[d * N + i];
    }
    settledEnergy = damped / (N * dims);
  }
  const nextCorrection: CorrectionState = {
    emaEnergy: correction.hasEma
      ? correction.influenceDecay * correction.emaEnergy + (1 - correction.influenceDecay) * settledEnergy
      : settledEnergy,
    hasEma: true,
    sustainedDivergence: sustained,
    influenceDecay: correction.influenceDecay,
  };

  return {
    states: next,
    waveRe: nextWaveRe,
    waveIm: nextWaveIm,
    poolRe: nextPoolRe,
    poolIm: nextPoolIm,
    waveTerm,
    correction: nextCorrection,
    liveCorrections,
  };
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : (v > 1 ? 1 : v);
}
