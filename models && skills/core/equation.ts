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
 *     connections = Σ_j Σ_e state[j][e]·W[i][j][d][e]      ← the general form
 *
 *   W[i][j] is a block: it maps the whole state of the source neuron to each
 *   dimension of the receiver. Two implementations use two restrictions of it,
 *   and that is the only thing that differs between them:
 *
 *     the engine        keeps two bands of the block -- the diagonal
 *                       (connDiag) and one off-diagonal (connShift·strength) --
 *                       which is what makes an N x D x N array enough
 *     the elastic core  keeps the whole block (connBlock), which is richer per
 *                       connection and costs D times as much
 *
 *   So `connections` below is written once, and a caller says which form its
 *   weights are in. There is one equation; there are two ways of storing the
 *   part of it a given network can afford.
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
 *     wave'[i] = waveFeedback · (amplitude[i] / loudestAmplitude) · heard[i]
 *
 *   and a DRIVEN neuron is a source -- nothing flows in, so its wave is read
 *   off the input directly, signed so that an input and its opposite are
 *   opposite waves and annihilate where they meet:
 *
 *     wave'[i] = (<state[i], readRe> + i·<state[i], readIm>) · e^{i·phase[i]}
 *     pool'[bin_i] += wave'[i]                ← where waves meet and cancel
 *     waveTerm[i]  = waveGain · Re( heard[i] · e^{-i·phase[i]} )
 *
 *   VALE is the last term, and it is the same in every implementation:
 *
 *     state'[i][d] = vale[i]·state[i][d] + (1 - vale[i])·tanh( ... )
 *
 *   A neuron with a high vale holds still; one with a low vale moves freely.
 *   It is the zero-sum plasticity budget, applied as a blend between where the
 *   neuron was and what the equation says it should be.
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
  /** [i][d][j] -- the two-band form of the connection block. */
  connDiag: Float32Array;
  connShift: Float32Array;
  /**
   * [(i*N + j)*D*D + d*D + e] -- the whole connection block, when a network
   * keeps it. Present means the general form is used and the two bands above
   * are ignored; absent means the bands are the connection.
   */
  connBlock?: Float32Array;
  /**
   * [i] -- how much each neuron holds still. Undefined means nothing does,
   * which is the same as every vale being 0.
   */
  vale?: Float32Array;
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
  /** The two directions a state is read through to become a wave. Shared by every neuron. */
  waveReadRe: Float32Array;
  waveReadIm: Float32Array;
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
  /**
   * Whether dimension 0 -- the input flag -- is wiped before the tick.
   *
   * The two implementations disagree about what that dimension IS, and this is
   * the only place they disagree at all. The elastic core treats it as a mark
   * that is true for exactly one tick: it clears every neuron's flag, then
   * sets it again for whatever is being driven now, so a neuron driven last
   * tick does not still look driven. The engine treats it as an ordinary
   * dimension that neurons compute and propagate, which is what makes its
   * inputTopography ("how close is each neuron to a directly-driven input")
   * mean anything.
   *
   * Found by writing the equation down and comparing: the numbers disagreed by
   * 0.26 and the connection term was identical, because the elastic core was
   * computing from a state with dimension 0 already wiped.
   */
  clearInputFlagFirst?: boolean;
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
  // The input flag, wiped first where that is what the implementation does.
  // Everything below reads through `at`, so this is the state the equation
  // sees rather than a separate pass over it.
  // Always a copy: the input flag is wiped here where that is what the
  // implementation does, and the driven neurons are seeded below, and neither
  // may reach back into the caller's array.
  const working = Float32Array.from(state.states);
  if (settings.clearInputFlagFirst) for (let i = 0; i < N; i++) working[i] = 0;
  const at = (d: number, i: number) => working[d * N + i];

  // The input goes into the driven neurons FIRST, before anything below reads
  // them. "Input -> Create Wave -> wave enters the mesh" is an ordering: a
  // source's wave has to be made of the input arriving now, not of what that
  // neuron happened to be holding from last tick. With the seeding at the end
  // instead, a network settling in one iteration never turned its input into
  // a wave at all -- two opposite inputs gave byte-identical pools.
  for (const i of driven) {
    working[0 * N + i] = 1.0;
    for (let d = 1; d < D; d++) {
      const v = input[d - 1] ?? 0;
      working[d * N + i] = v < -1 ? -1 : (v > 1 ? 1 : v);
    }
  }

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

    // A driven neuron is a SOURCE: nothing flows into it, so its wave comes
    // from the input itself, read through the network's two reading
    // directions and rotated into the neuron's own frequency slot. Everything
    // else carries the wave that formed in it last iteration.
    //
    //   proj     = <state[i], readRe> + i*<state[i], readIm>
    //   wave'[i] = proj * e^{i*phase[i]}
    //
    // Signed, which is the point. The amplitude alone was used here once, and
    // an amplitude has no sign, so an input and its exact opposite made the
    // same wave and could not cancel.
    const prevRe = Float32Array.from(state.waveRe);
    const prevIm = Float32Array.from(state.waveIm);
    for (const i of driven) {
      let projRe = 0;
      let projIm = 0;
      for (let d = 1; d < D; d++) {
        const v = at(d, i);
        projRe += v * settings.waveReadRe[d];
        projIm += v * settings.waveReadIm[d];
      }
      const c = Math.cos(state.wavePhase[i]);
      const sn = Math.sin(state.wavePhase[i]);
      prevRe[i] = projRe * c - projIm * sn;
      prevIm[i] = projRe * sn + projIm * c;
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

    // The loudest neuron this iteration, not the theoretical ceiling. A mesh
    // whose states sit far from the rail reads as silent against a fixed
    // ceiling, and the wave feedback all but vanishes with it. The loudest
    // gets exactly waveFeedback and everyone else less, so the round trip is
    // still bounded below one.
    let loudest = 0;
    for (let i = 0; i < N; i++) if (amplitude[i] > loudest) loudest = amplitude[i];
    const maxAmplitude = loudest > 1e-9 ? loudest : Math.sqrt(Math.max(1, D - 1));
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
      // The connection sum is scaled by 1/sqrt(N) in both forms -- the
      // variance-preserving scale for a sum of N terms. A raw sum puts
      // something of order N inside tanh and the mesh saturates into an
      // attractor it cannot leave.
      const invN = 1 / Math.sqrt(Math.max(1, N));
      if (state.connBlock) {
        // The general form: every source dimension reaches every receiving
        // dimension through the block.
        for (let j = 0; j < N; j++) {
          if (j === i) continue;
          const block = (i * N + j) * D * D + d * D;
          for (let e = 0; e < D; e++) connections += at(e, j) * state.connBlock[block + e];
        }
        connections *= invN;
      } else {
        // Two bands of that same block.
        let biasRow = 0;
        for (let j = 0; j < N; j++) {
          connections += at(d, j) * state.connDiag[(i * D + d) * N + j];
          connections += at(shiftDim, j) * state.connShift[(i * D + d) * N + j] * settings.crossInfluenceStrength;
          if (settings.connectionBias) biasRow += state.connBias[(i * D + d) * N + j];
        }
        // The connection biases were N copies of one number -- every
        // connection in a row got the identical update -- so they enter as a
        // mean too, which is the same division.
        connections *= invN;
        // The connection biases were N copies of one number -- every
        // connection in a row got the identical update -- so they enter as a
        // plain mean, which is a different division.
        if (settings.connectionBias) connections += biasRow / Math.max(1, N);
      }
      const window = i * D + d;
      const computed = Math.tanh(
        state.bias[i * D + d]
        + connections * networkScale[window]
        + networkWeight[window] * heardMean[d]
        + networkBias[window]
        + waveTerm[i],
      );
      // Vale: how much this neuron holds still rather than moving to what the
      // equation says. The same blend in every implementation of it.
      const v = state.vale ? state.vale[i] : 0;
      next[d * N + i] = v !== 0 ? v * at(d, i) + (1 - v) * computed : computed;
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
