/**
 * building-ai.mjs — drill generator for "building AI".
 *
 * Forward passes, losses, gradients and shapes, every answer computed by
 * doing the arithmetic here rather than quoting a formula. Numeric answers
 * are rounded to a fixed 4 decimal places so grading is exact string
 * comparison and cannot drift with floating point.
 *
 * Pure given a rand() source. No external API, and no third-party weights.
 */

const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)]
const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
/** One decimal in [lo, hi] at 1dp, so problems read cleanly. */
const dec = (rand, lo, hi) => Math.round((lo + rand() * (hi - lo)) * 10) / 10
const r4 = (v) => v.toFixed(4)

/** One neuron: sum(w*x) + b, then an activation. */
function forwardProblem(rand) {
  const n = int(rand, 2, 4)
  const w = Array.from({ length: n }, () => dec(rand, -2, 2))
  const x = Array.from({ length: n }, () => dec(rand, -2, 2))
  const b = dec(rand, -1, 1)
  let z = b
  for (let i = 0; i < n; i++) z += w[i] * x[i]
  const act = pick(rand, ['relu', 'sigmoid', 'tanh', 'none'])
  const out = act === 'relu' ? Math.max(0, z)
    : act === 'sigmoid' ? 1 / (1 + Math.exp(-z))
      : act === 'tanh' ? Math.tanh(z)
        : z
  return {
    problem: `A neuron has weights [${w.join(', ')}], bias ${b}, and input [${x.join(', ')}].\nActivation: ${act}. What does it output? (4 decimal places)`,
    answer: r4(out),
  }
}

/** Softmax of a small logit vector -- one component asked for. */
function softmaxProblem(rand) {
  const n = int(rand, 2, 4)
  const z = Array.from({ length: n }, () => dec(rand, -2, 2))
  const max = Math.max(...z)
  const exps = z.map(v => Math.exp(v - max))
  const sum = exps.reduce((s, v) => s + v, 0)
  const i = int(rand, 0, n - 1)
  return {
    problem: `Logits: [${z.join(', ')}]\nWhat is softmax component ${i} (0-based)? (4 decimal places)`,
    answer: r4(exps[i] / sum),
  }
}

/** A loss, computed. */
function lossProblem(rand) {
  const kind = pick(rand, ['mse', 'mae', 'bce'])
  if (kind === 'bce') {
    const p = Math.round((0.05 + rand() * 0.9) * 100) / 100
    const y = rand() < 0.5 ? 0 : 1
    const loss = -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
    return {
      problem: `Binary cross-entropy for one sample: predicted probability ${p}, true label ${y}.\nWhat is the loss? (4 decimal places)`,
      answer: r4(loss),
    }
  }
  const n = int(rand, 3, 5)
  const pred = Array.from({ length: n }, () => dec(rand, -3, 3))
  const truth = Array.from({ length: n }, () => dec(rand, -3, 3))
  let s = 0
  for (let i = 0; i < n; i++) s += kind === 'mse' ? (pred[i] - truth[i]) ** 2 : Math.abs(pred[i] - truth[i])
  return {
    problem: `Predictions [${pred.join(', ')}], targets [${truth.join(', ')}].\nWhat is the ${kind === 'mse' ? 'mean squared error' : 'mean absolute error'}? (4 decimal places)`,
    answer: r4(s / n),
  }
}

/** The gradient of a squared error with respect to one weight. */
function gradientProblem(rand) {
  const w = dec(rand, -2, 2)
  const x = dec(rand, -2, 2)
  const b = dec(rand, -1, 1)
  const target = dec(rand, -2, 2)
  const pred = w * x + b
  // d/dw of (pred - target)^2 = 2 * (pred - target) * x
  return {
    problem: `A linear unit: pred = w*x + b with w=${w}, x=${x}, b=${b}. Target is ${target}.\nLoss is (pred - target)^2. What is dLoss/dw? (4 decimal places)`,
    answer: r4(2 * (pred - target) * x),
  }
}

/** Parameter counts -- the shape arithmetic, done. */
function shapeProblem(rand) {
  const kind = pick(rand, ['dense', 'conv', 'convParams'])
  if (kind === 'dense') {
    const layers = [int(rand, 2, 16), int(rand, 2, 16), int(rand, 1, 8)]
    let params = 0
    for (let i = 1; i < layers.length; i++) params += layers[i - 1] * layers[i] + layers[i]
    return {
      problem: `A fully connected network with layer sizes ${layers.join(' -> ')}, every layer with a bias.\nHow many trainable parameters in total?`,
      answer: String(params),
    }
  }
  const size = int(rand, 8, 32)
  const k = pick(rand, [3, 5])
  const stride = pick(rand, [1, 2])
  const pad = pick(rand, [0, 1])
  const out = Math.floor((size - k + 2 * pad) / stride) + 1
  if (kind === 'conv') {
    return {
      problem: `A ${size}x${size} input through a ${k}x${k} convolution, stride ${stride}, padding ${pad}.\nWhat is the output width?`,
      answer: String(out),
    }
  }
  const cin = int(rand, 1, 8), cout = int(rand, 1, 8)
  return {
    problem: `A ${k}x${k} convolution from ${cin} input channels to ${cout} output channels, with one bias per output channel.\nHow many trainable parameters?`,
    answer: String(k * k * cin * cout + cout),
  }
}

/** A scaled dot-product attention score for one query-key pair. */
function attentionProblem(rand) {
  const d = int(rand, 2, 4)
  const q = Array.from({ length: d }, () => dec(rand, -2, 2))
  const k = Array.from({ length: d }, () => dec(rand, -2, 2))
  let dot = 0
  for (let i = 0; i < d; i++) dot += q[i] * k[i]
  return {
    problem: `Scaled dot-product attention with query [${q.join(', ')}] and key [${k.join(', ')}], d_k = ${d}.\nWhat is the score before softmax, q.k / sqrt(d_k)? (4 decimal places)`,
    answer: r4(dot / Math.sqrt(d)),
  }
}

const KINDS = [forwardProblem, softmaxProblem, lossProblem, gradientProblem, shapeProblem, attentionProblem]

export function generateBuildingAiProblem(rand = Math.random) {
  return pick(rand, KINDS)(rand)
}

export function generateBuildingAiBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateBuildingAiProblem(rand))
}
