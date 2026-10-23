/**
 * Teaching the Zip Loop to answer.
 *
 * Until now nothing in the repo could make the loop speak a chosen answer: the
 * output side was only ever read, never trained, and an untrained mesh sends a
 * drifting bit pattern or nothing. This adds the missing piece.
 *
 * How it works. The question goes in through the Zip Loop as bits, with memory
 * on (see ZipLoopInterface's `memory`), so it leaves a trace in the mesh that
 * depends on what was said, not just on the last byte. The state of every
 * neuron outside the doorway is then a single point in a high-dimensional
 * space, and a linear readout, fitted by ridge regression in closed form, maps
 * that point to the whole answer (its bits and, for each byte, a flag saying it
 * is really part of the answer). The bits are then spoken one per tick. The
 * mesh does the remembering; the readout is a small learned head on top, the
 * same role as the elastic core's output projection.
 *
 * Why one point and not one per tick: after the question the idle mesh settles
 * to an almost static state, so reading a sequence off its successive ticks
 * asks a state that is not changing to produce a time series (tried first: the
 * readout could not even fit the answers it was taught, 67% of bits).
 *
 * What this is and is not. It teaches a set of question -> answer pairs and
 * speaks the right answer for each. It is a lookup keyed by the mesh's state:
 * it does not answer questions it was not taught, and it makes no attempt to.
 * Reading never changes the mesh: every pass starts from the same blank
 * activity, learning is off, and the mesh is left as it was found.
 *
 * Text is its UTF-8 bytes, the answer is bytes, and both are bits. There is no
 * tokenizer and nothing outside the repo: the solve below is plain arithmetic.
 */
import { ZipLoopInterface, zipLoopIdsFor } from "./onebrain.js";
import { freezeActivity, thawActivity } from "./thread-context.js";
/** Targets per answer byte: its 8 bits, then a flag that says this byte is really part of the answer. */
const TARGETS_PER_BYTE = 9;
const toBytes = (v) => (typeof v === "string" ? new Uint8Array(Buffer.from(v, "utf8")) : v);
/** Solve (A + lambda I) x = b for symmetric positive semi-definite A by Gaussian elimination with partial pivoting. */
export function solveRidge(a, n, lambda, b) {
    const m = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++)
        m[i] = a[i];
    for (let i = 0; i < n; i++)
        m[i * n + i] += lambda;
    const rhs = b.map(v => Float64Array.from(v));
    for (let col = 0; col < n; col++) {
        let pivot = col;
        let best = Math.abs(m[col * n + col]);
        for (let r = col + 1; r < n; r++) {
            const v = Math.abs(m[r * n + col]);
            if (v > best) {
                best = v;
                pivot = r;
            }
        }
        if (best === 0)
            continue;
        if (pivot !== col) {
            for (let c = 0; c < n; c++) {
                const t = m[col * n + c];
                m[col * n + c] = m[pivot * n + c];
                m[pivot * n + c] = t;
            }
            for (const r of rhs) {
                const t = r[col];
                r[col] = r[pivot];
                r[pivot] = t;
            }
        }
        const d = m[col * n + col];
        for (let r = col + 1; r < n; r++) {
            const f = m[r * n + col] / d;
            if (f === 0)
                continue;
            for (let c = col; c < n; c++)
                m[r * n + c] -= f * m[col * n + c];
            for (const v of rhs)
                v[r] -= f * v[col];
        }
    }
    for (const v of rhs) {
        for (let r = n - 1; r >= 0; r--) {
            let s = v[r];
            for (let c = r + 1; c < n; c++)
                s -= m[r * n + c] * v[c];
            const d = m[r * n + r];
            v[r] = d === 0 ? 0 : s / d;
        }
    }
    return rhs;
}
export class ZipSpeaker {
    constructor(engine, opts = {}) {
        this.engine = engine;
        this.featureStd = null;
        /** The mesh is deterministic from blank activity, so a question read once never needs reading again. Cleared by forget(). */
        this.featureCache = new Map();
        /** The fitted readout, in dual form: the taught questions' points and one coefficient per question for every output. */
        this.memory = null;
        this.alpha = null;
        this.featureMean = null;
        /** Median distance from a taught question to its nearest other taught question. */
        this.typicalGap = 1;
        this.targetMean = null;
        this.featureScale = 1;
        this.memoryVale = opts.memoryVale ?? 0.97;
        this.ridge = opts.ridge ?? 1e-9;
        this.maxAnswerBytes = opts.maxAnswerBytes ?? 16;
        this.settleTicks = opts.settleTicks ?? 0;
        this.pooling = opts.pooling ?? "last";
        this.standardize = opts.standardize ?? false;
        const ids = zipLoopIdsFor(engine);
        this.zip = new ZipLoopInterface(engine, ids, this.memoryVale > 0 ? { memory: { vale: this.memoryVale } } : {});
        this.doorway = new Set(Object.values(ids).filter((v) => typeof v === "number"));
        this.blank = freezeActivity(engine);
    }
    get taught() {
        return this.alpha !== null;
    }
    /** The mesh outside the doorway, content and energy of every neuron, written into `into` starting at `at`. */
    snapshot(into, at, scratch) {
        const n = this.engine.getNeuronCount();
        const dims = this.engine.getDimensions();
        let k = at;
        for (let i = 0; i < n; i++) {
            if (this.doorway.has(i))
                continue;
            const wrote = this.engine.readNeuronContent(i, scratch);
            for (let d = 0; d < dims; d++)
                into[k++] = d < wrote ? scratch[d] : 0;
            into[k++] = this.engine.getNeuronEnergy(i);
        }
    }
    /** Forget everything read so far (call it if the mesh's weights were changed after teaching). */
    forget() {
        this.featureCache.clear();
    }
    /** Feed the question from blank activity and read the mesh: once at the end, or (pooling "mean") after every byte too. */
    features(question) {
        const key = Buffer.from(question).toString("latin1");
        const cached = this.featureCache.get(key);
        if (cached)
            return cached;
        thawActivity(this.engine, this.blank);
        const n = this.engine.getNeuronCount();
        const dims = this.engine.getDimensions();
        const width = (n - this.doorway.size) * (dims + 1);
        const scratch = new Float32Array(dims);
        const pooled = this.pooling === "mean" ? new Float64Array(width) : null;
        const snap = pooled ? new Float64Array(width) : null;
        let reads = 0;
        for (const byte of question) {
            this.zip.sendByte(byte);
            if (pooled && snap) {
                this.snapshot(snap, 0, scratch);
                for (let j = 0; j < width; j++)
                    pooled[j] += snap[j];
                reads++;
            }
        }
        for (let t = 0; t < this.settleTicks; t++)
            this.zip.idleTick();
        const f = new Float64Array(pooled ? width * 2 : width);
        this.snapshot(f, 0, scratch);
        if (pooled) {
            const denom = Math.max(1, reads);
            for (let j = 0; j < width; j++)
                f[width + j] = pooled[j] / denom;
        }
        if (this.featureCache.size >= 4096)
            this.featureCache.clear();
        this.featureCache.set(key, f);
        return f;
    }
    /** Targets for an answer: for each of maxAnswerBytes bytes, 8 bits as +-1 and a flag (+1 real, -1 padding). */
    targets(answer) {
        const out = new Float64Array(this.maxAnswerBytes * TARGETS_PER_BYTE);
        let k = 0;
        for (let i = 0; i < this.maxAnswerBytes; i++) {
            const real = i < answer.length;
            for (let b = 7; b >= 0; b--)
                out[k++] = real ? (((answer[i] >> b) & 1) ? 1 : -1) : -1;
            out[k++] = real ? 1 : -1;
        }
        return out;
    }
    /**
     * Teach question -> answer pairs. Reads the mesh but never changes it:
     * learning is off throughout and the activity is put back afterwards.
     */
    teach(pairs) {
        if (pairs.length === 0)
            throw new Error("ZipSpeaker.teach: nothing to teach");
        const found = freezeActivity(this.engine);
        try {
            const X = [];
            const Y = [];
            for (const pair of pairs) {
                const answer = toBytes(pair.answer);
                if (answer.length > this.maxAnswerBytes)
                    throw new Error(`ZipSpeaker.teach: an answer is longer than ${this.maxAnswerBytes} bytes`);
                X.push(this.features(toBytes(pair.question)));
                Y.push(this.targets(answer));
            }
            const S = X.length;
            const F = X[0].length;
            const O = Y[0].length;
            // Centre on the average point and scale so the typical difference is of order 1. The
            // differences between questions are tiny next to the state they share (1e-3), so without
            // this the solve is hopelessly ill-conditioned.
            const mean = new Float64Array(F);
            for (const x of X)
                for (let j = 0; j < F; j++)
                    mean[j] += x[j] / S;
            let energy = 0;
            for (const x of X)
                for (let j = 0; j < F; j++)
                    energy += (x[j] - mean[j]) ** 2;
            const scale = Math.sqrt(energy / (S * F)) || 1;
            let std = null;
            if (this.standardize) {
                std = new Float64Array(F);
                for (const x of X)
                    for (let j = 0; j < F; j++)
                        std[j] += (x[j] - mean[j]) ** 2 / S;
                for (let j = 0; j < F; j++)
                    std[j] = Math.sqrt(std[j]) + scale * 1e-3; // floor: a feature that never moves must not blow up
            }
            this.featureStd = std;
            const Z = X.map(x => Float64Array.from(x, (v, j) => (v - mean[j]) / (std ? std[j] : scale)));
            // Dual ridge: predictions are sum_i alpha_i * (z_i . z), with alpha = (Z Zt + lambda I)^-1 Y.
            // Only an S x S system, whatever the number of features.
            const gram = new Float64Array(S * S);
            for (let i = 0; i < S; i++) {
                for (let j = i; j < S; j++) {
                    let dot = 0;
                    const a = Z[i], b = Z[j];
                    for (let k = 0; k < F; k++)
                        dot += a[k] * b[k];
                    gram[i * S + j] = dot;
                    gram[j * S + i] = dot;
                }
            }
            let trace = 0;
            for (let i = 0; i < S; i++)
                trace += gram[i * S + i];
            const lambda = this.ridge * (trace / S);
            // The targets are centred too, which is the intercept. Without it the problem is
            // inconsistent: the centred points sum to zero, so only centred targets can be fitted
            // (with two pairs the fit was worse than chance, 47% of bits).
            const targetMean = new Float64Array(O);
            for (const y of Y)
                for (let o = 0; o < O; o++)
                    targetMean[o] += y[o] / S;
            const columns = [];
            for (let o = 0; o < O; o++)
                columns.push(Float64Array.from(Y, row => row[o] - targetMean[o]));
            const solved = solveRidge(gram, S, lambda, columns); // one right-hand side per output, solved together: solved[o][i]
            this.alpha = solved;
            this.targetMean = targetMean;
            const gaps = [];
            for (let i = 0; i < S; i++) {
                let nearest = Infinity;
                for (let j = 0; j < S; j++) {
                    if (i === j)
                        continue;
                    let d = 0;
                    for (let k = 0; k < F; k++)
                        d += (Z[i][k] - Z[j][k]) ** 2;
                    nearest = Math.min(nearest, Math.sqrt(d));
                }
                if (Number.isFinite(nearest))
                    gaps.push(nearest);
            }
            gaps.sort((a, b) => a - b);
            this.typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
            this.memory = Z;
            this.featureMean = mean;
            this.featureScale = scale;
            let right = 0;
            for (let i = 0; i < S; i++) {
                const scores = this.scores(Z[i]);
                for (let o = 0; o < O; o++)
                    if ((scores[o] >= 0 ? 1 : -1) === Y[i][o])
                        right++;
            }
            return { pairs: pairs.length, samples: S, features: F, bitAccuracy: right / (S * O) };
        }
        finally {
            thawActivity(this.engine, found);
        }
    }
    /** The readout's score for every output, for one centred and scaled feature vector. */
    scores(z) {
        const memory = this.memory;
        const alpha = this.alpha;
        const kernel = new Float64Array(memory.length);
        for (let i = 0; i < memory.length; i++) {
            let dot = 0;
            const m = memory[i];
            for (let k = 0; k < z.length; k++)
                dot += m[k] * z[k];
            kernel[i] = dot;
        }
        const out = new Float64Array(alpha.length);
        for (let o = 0; o < alpha.length; o++) {
            let s = 0;
            for (let i = 0; i < kernel.length; i++)
                s += alpha[o][i] * kernel[i];
            out[o] = s + this.targetMean[o];
        }
        return out;
    }
    /**
     * How familiar a question is: its distance to the nearest taught question,
     * as a multiple of the typical distance between one taught question and its
     * nearest neighbour. About 0 for a taught question, a few for a taught
     * question with a small change, far larger for something never seen.
     */
    strangeness(question) {
        if (!this.memory || !this.featureMean)
            throw new Error("ZipSpeaker.strangeness: nothing has been taught yet");
        const found = freezeActivity(this.engine);
        try {
            const x = this.features(toBytes(question));
            const z = Float64Array.from(x, (v, j) => (v - this.featureMean[j]) / (this.featureStd ? this.featureStd[j] : this.featureScale));
            const dist = (a, b) => { let d = 0; for (let k = 0; k < a.length; k++)
                d += (a[k] - b[k]) ** 2; return Math.sqrt(d); };
            let nearest = Infinity;
            for (const m of this.memory)
                nearest = Math.min(nearest, dist(z, m));
            return nearest / (this.typicalGap || 1);
        }
        finally {
            thawActivity(this.engine, found);
        }
    }
    /**
     * How wrong the readout is about one question: mean squared distance between
     * its scores and the +-1 targets for `answer`. 1 is what a readout that has
     * learned nothing scores (every output 0); 0 is exact. Before anything is
     * taught the answer is 1, which is the "before training" number.
     */
    loss(question, answer) {
        const target = this.targets(toBytes(answer).subarray(0, this.maxAnswerBytes));
        if (!this.alpha || !this.memory || !this.featureMean)
            return 1;
        const found = freezeActivity(this.engine);
        try {
            const x = this.features(toBytes(question));
            const z = Float64Array.from(x, (v, j) => (v - this.featureMean[j]) / (this.featureStd ? this.featureStd[j] : this.featureScale));
            const scores = this.scores(z);
            let sum = 0;
            // Clipped to [-1, 1]: only the sign of a score is ever spoken, and an unseen question can push a linear readout
            // arbitrarily far, which would make this number meaningless. Worst case is then 4, chance is about 1.
            for (let o = 0; o < target.length; o++)
                sum += (Math.max(-1, Math.min(1, scores[o])) - target[o]) ** 2;
            return sum / target.length;
        }
        finally {
            thawActivity(this.engine, found);
        }
    }
    /** Speak the answer to a question. Reads the mesh but leaves it as it was found. */
    speak(question) {
        if (!this.alpha || !this.memory || !this.featureMean)
            throw new Error("ZipSpeaker.speak: nothing has been taught yet");
        const found = freezeActivity(this.engine);
        try {
            const x = this.features(toBytes(question));
            const z = Float64Array.from(x, (v, j) => (v - this.featureMean[j]) / (this.featureStd ? this.featureStd[j] : this.featureScale));
            const scores = this.scores(z);
            const bytes = [];
            for (let i = 0; i < this.maxAnswerBytes; i++) {
                const base = i * TARGETS_PER_BYTE;
                if (scores[base + 8] < 0)
                    break; // the flag says there is no more
                let byte = 0;
                for (let b = 0; b < 8; b++)
                    byte = (byte << 1) | (scores[base + b] >= 0 ? 1 : 0);
                bytes.push(byte);
            }
            return new Uint8Array(bytes);
        }
        finally {
            thawActivity(this.engine, found);
        }
    }
    /**
     * Answer only a question that is familiar: one it was taught, or one that
     * differs from a taught one only where the mesh no longer remembers (the
     * early bytes of a long question). Anything else returns null instead of a
     * confident-looking wrong answer. Measured on 16 taught questions: taught and
     * early-changed questions score 0.00 on strangeness(); appended characters,
     * a different case and unrelated text all score 1.05 or more. The default
     * cutoff of 0.5 sits in that gap.
     */
    recall(question, opts = {}) {
        if (this.strangeness(question) > (opts.maxStrangeness ?? 0.5))
            return null;
        return this.speak(question);
    }
    /** recall() as text. */
    recallText(question, opts = {}) {
        const bytes = this.recall(question, opts);
        return bytes === null ? null : Buffer.from(bytes).toString("utf8");
    }
    /** Speak the answer as text. */
    speakText(question) {
        return Buffer.from(this.speak(question)).toString("utf8");
    }
}
