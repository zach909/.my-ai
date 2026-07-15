import { ElasticCoreBlock } from './core/elastic-core.js';

export interface TrainingConfig {
  contextWindow: number;
  learningRate: number;
  epochs: number;
  ngramOrder: number;
  hiddenDim: number;
  useElasticCore: boolean;
  elasticNeurons: number;
  elasticStateDim: number;
}

export interface NGramTable {
  counts: Map<string, Map<number, number>>;
  totals: Map<string, number>;
}

export interface TrainedWeights {
  embeddings: Map<number, Float32Array>;
  hiddenWeights: Float32Array[];
  outputWeights: Float32Array[];
  biases: Float32Array;
  ngramTables: NGramTable[];
  unigramFrequencies: Float32Array;
  trained: boolean;
  trainingLoss: number;
  samplesProcessed: number;
}

const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  contextWindow: 8,
  learningRate: 0.08,
  epochs: 3,
  ngramOrder: 8,
  hiddenDim: 48,
  useElasticCore: false,
  elasticNeurons: 16,
  elasticStateDim: 16,
};

const TRAINING_CORPUS = "the quick brown fox jumps over the lazy dog the cat sat on the mat hello world this is a test of the emergency broadcast system the rain in spain falls mainly on the plain it was the best of times it was the worst of times to be or not to be that is the question all that glitters is not gold a journey of a thousand miles begins with a single step knowledge is power time is money the early bird catches the worm practice makes perfect actions speak louder than words the pen is mightier than the sword when in rome do as the romans do necessity is the mother of invention a picture is worth a thousand words where there is smoke there is fire if you want something done right do it yourself the squeaky wheel gets the grease birds of a feather flock together dont count your chickens before they hatch every cloud has a silver lining two heads are better than one the grass is always greener on the other side";

export class NeuroclawTrainer {
  private config: TrainingConfig;
  private weights: TrainedWeights;
  private vocabSize: number;
  private charToId: Map<string, number>;
  private idToChar: Map<number, string>;
  private elasticCore: ElasticCoreBlock | null = null;

  constructor(vocabSize: number, charToId: Map<string, number>, idToChar: Map<number, string>, config: Partial<TrainingConfig> = {}) {
    this.config = { ...DEFAULT_TRAINING_CONFIG, ...config };
    this.vocabSize = vocabSize;
    this.charToId = charToId;
    this.idToChar = idToChar;

    const uniform = 1.0 / (vocabSize - 4);
    this.weights = {
      embeddings: new Map(),
      hiddenWeights: [],
      outputWeights: [],
      biases: new Float32Array(vocabSize),
      ngramTables: [],
      unigramFrequencies: new Float32Array(vocabSize).fill(uniform),
      trained: false,
      trainingLoss: Infinity,
      samplesProcessed: 0,
    };
  }

  train(text?: string): void {
    const corpus = text ?? TRAINING_CORPUS;
    this.buildNGramTables(corpus);
    this.trainEmbeddings(corpus);
    if (this.config.useElasticCore) this.trainElasticCoreLayer(corpus);
    else this.trainHiddenLayer(corpus);
    this.weights.trained = true;
  }

  private buildNGramTables(text: string): void {
    this.weights.ngramTables = [];

    const unigramCounts = new Float32Array(this.vocabSize);
    let totalChars = 0;

    for (let order = 1; order <= this.config.ngramOrder; order++) {
      const table: NGramTable = {
        counts: new Map(),
        totals: new Map(),
      };

      for (let i = 0; i < text.length - order; i++) {
        const context = text.slice(i, i + order);
        const nextId = this.charToId.get(text[i + order] ?? "") ?? 3;

        if (order === 1) {
          unigramCounts[nextId] = (unigramCounts[nextId] ?? 0) + 1;
          totalChars++;
        }

        if (!table.counts.has(context)) {
          table.counts.set(context, new Map());
          table.totals.set(context, 0);
        }

        const charCounts = table.counts.get(context)!;
        charCounts.set(nextId, (charCounts.get(nextId) ?? 0) + 1);
        table.totals.set(context, (table.totals.get(context) ?? 0) + 1);
      }

      this.weights.ngramTables.push(table);
    }

    if (totalChars > 0) {
      for (let v = 0; v < this.vocabSize; v++) {
        this.weights.unigramFrequencies[v] = (unigramCounts[v] ?? 0) / totalChars;
      }
    }
  }

  private trainEmbeddings(text: string): void {
    const dim = this.config.hiddenDim;

    for (let i = 0; i < this.vocabSize; i++) {
      const emb = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        emb[j] = (Math.random() - 0.5) * 0.1;
      }
      this.weights.embeddings.set(i, emb);
    }

    const windowSize = 3;
    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      for (let i = windowSize; i < text.length - windowSize; i++) {
        const centerId = this.charToId.get(text[i] ?? "") ?? 3;
        const centerEmb = this.weights.embeddings.get(centerId)!;

        for (let w = -windowSize; w <= windowSize; w++) {
          if (w === 0) continue;
          const ctxId = this.charToId.get(text[i + w] ?? "") ?? 3;
          const ctxEmb = this.weights.embeddings.get(ctxId)!;

          const lr = this.config.learningRate / (1 + epoch);
          for (let d = 0; d < dim; d++) {
            const diff = (ctxEmb[d]! - centerEmb[d]!) * lr * 0.1;
            const cUpdate = isFinite(diff) ? diff : 0;
            const eUpdate = -diff * 0.5;
            centerEmb[d] = centerEmb[d]! + cUpdate;
            ctxEmb[d] = ctxEmb[d]! + (isFinite(eUpdate) ? eUpdate : 0);
          }
        }
        this.weights.samplesProcessed++;
      }
    }
  }

  private trainHiddenLayer(text: string): void {
    const dim = this.config.hiddenDim;
    const ctx = this.config.contextWindow;

    this.weights.hiddenWeights = [];
    for (let i = 0; i < ctx; i++) {
      const w = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        w[j] = (Math.random() - 0.5) * Math.sqrt(2.0 / (ctx * dim));
      }
      this.weights.hiddenWeights.push(w);
    }

    this.weights.outputWeights = [];
    for (let i = 0; i < this.vocabSize; i++) {
      const w = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        w[j] = (Math.random() - 0.5) * Math.sqrt(2.0 / dim);
      }
      this.weights.outputWeights.push(w);
    }

    this.weights.biases = new Float32Array(this.vocabSize);

    let totalLoss = 0;
    let count = 0;

    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      const lr = this.config.learningRate / (1 + epoch * 0.5);

      for (let i = ctx; i < text.length - 1; i++) {
        const contextIds: number[] = [];
        for (let c = 0; c < ctx; c++) {
          contextIds.push(this.charToId.get(text[i - ctx + c] ?? "") ?? 3);
        }
        const targetId = this.charToId.get(text[i] ?? "") ?? 3;

        const hidden = new Float32Array(dim);
        for (let c = 0; c < ctx; c++) {
          const emb = this.weights.embeddings.get(contextIds[c]!);
          const w = this.weights.hiddenWeights[c];
          if (emb && w) {
            for (let d = 0; d < dim; d++) {
              hidden[d] = hidden[d]! + emb[d]! * w[d]!;
            }
          }
        }

        for (let d = 0; d < dim; d++) {
          hidden[d] = Math.max(0, hidden[d]!);
        }

        const logits = new Float32Array(this.vocabSize);
        for (let v = 0; v < this.vocabSize; v++) {
          const ow = this.weights.outputWeights[v];
          if (ow) {
            let dot = this.weights.biases[v]!;
            for (let d = 0; d < dim; d++) {
              dot += hidden[d]! * ow[d]!;
            }
            logits[v] = dot;
          }
        }

        let maxLogit = -Infinity;
        let hasValid = false;
        for (let v = 0; v < this.vocabSize; v++) {
          const l = logits[v]!;
          if (isFinite(l) && l > maxLogit) { maxLogit = l; hasValid = true; }
        }
        if (!hasValid) maxLogit = 0;
        let sumExp = 0;
        const probs = new Float32Array(this.vocabSize);
        for (let v = 0; v < this.vocabSize; v++) {
          const l = logits[v]!;
          const safe = isFinite(l) ? l : -100;
          probs[v] = Math.exp(safe - maxLogit);
          sumExp += probs[v]!;
        }
        if (sumExp <= 0 || !isFinite(sumExp)) {
          const uniform = 1.0 / this.vocabSize;
          for (let v = 0; v < this.vocabSize; v++) probs[v] = uniform;
        } else {
          for (let v = 0; v < this.vocabSize; v++) probs[v] = probs[v]! / sumExp;
        }

        const tp = probs[targetId]!;
        const targetProb = (isFinite(tp) ? Math.max(tp, 1e-10) : 1e-10);
        totalLoss += -Math.log(targetProb);
        count++;

        const gradOutput = new Float32Array(this.vocabSize);
        for (let v = 0; v < this.vocabSize; v++) {
          gradOutput[v] = isFinite(probs[v]!) ? probs[v]! : 0;
        }
        gradOutput[targetId] = gradOutput[targetId]! - 1;

        const gradNorm = Math.sqrt(gradOutput.reduce((s, g) => s + g * g, 0));
        const gradScale = gradNorm > 10 ? 10 / gradNorm : 1;

        for (let v = 0; v < this.vocabSize; v++) {
          const ow = this.weights.outputWeights[v];
          if (ow) {
            for (let d = 0; d < dim; d++) {
              const update = lr * gradOutput[v]! * hidden[d]! * gradScale;
              if (isFinite(update)) ow[d] = ow[d]! - update;
            }
          }
          const bUpdate = lr * gradOutput[v]! * gradScale;
          if (isFinite(bUpdate)) this.weights.biases[v] = this.weights.biases[v]! - bUpdate;
        }

        const gradHidden = new Float32Array(dim);
        for (let d = 0; d < dim; d++) {
          if (hidden[d]! <= 0) continue;
          let grad = 0;
          for (let v = 0; v < this.vocabSize; v++) {
            const ow = this.weights.outputWeights[v];
            if (ow) grad += gradOutput[v]! * ow[d]!;
          }
          gradHidden[d] = isFinite(grad) ? Math.max(-10, Math.min(10, grad)) : 0;
        }

        for (let c = 0; c < ctx; c++) {
          const emb = this.weights.embeddings.get(contextIds[c]!);
          const w = this.weights.hiddenWeights[c];
          if (emb && w) {
            for (let d = 0; d < dim; d++) {
              const wUpdate = lr * gradHidden[d]! * emb[d]! * gradScale;
              if (isFinite(wUpdate)) w[d] = w[d]! - wUpdate;
              const eUpdate = lr * 0.1 * gradHidden[d]! * w[d]! * gradScale;
              if (isFinite(eUpdate)) emb[d] = emb[d]! - eUpdate;
            }
          }
        }
      }
    }

    this.weights.trainingLoss = count > 0 ? totalLoss / count : 0;
  }

  private trainElasticCoreLayer(text: string): void {
    const dim = this.config.hiddenDim;
    const ctx = this.config.contextWindow;
    this.elasticCore = new ElasticCoreBlock({
      neuronCount: this.config.elasticNeurons,
      stateDim: this.config.elasticStateDim,
      inputDim: dim,
      outputDim: dim,
      maxTicks: 2,
      convergenceThreshold: 0,
      seed: 1337,
    });

    this.weights.outputWeights = [];
    for (let i = 0; i < this.vocabSize; i++) {
      const w = new Float32Array(dim);
      for (let j = 0; j < dim; j++) w[j] = (Math.random() - 0.5) * Math.sqrt(2.0 / dim);
      this.weights.outputWeights.push(w);
    }
    this.weights.hiddenWeights = [];
    this.weights.biases = new Float32Array(this.vocabSize);

    let totalLoss = 0, count = 0;
    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      const lr = this.config.learningRate / (1 + epoch * 0.5);
      for (let i = ctx; i < text.length - 1; i++) {
        const hiddenIn = new Float32Array(dim);
        for (let c = 0; c < ctx; c++) {
          const id = this.charToId.get(text[i - ctx + c] ?? '') ?? 3;
          const emb = this.weights.embeddings.get(id);
          if (emb) for (let d = 0; d < dim; d++) hiddenIn[d] += emb[d] / ctx;
        }
        const targetId = this.charToId.get(text[i] ?? '') ?? 3;
        const vale = new Map<number, number>();
        for (let n = 0; n < this.config.elasticNeurons; n++) vale.set(n, n === 1 ? 0.9 : 0.1);
        const hidden = this.elasticCore.forward(hiddenIn, { vale, drivenNeurons: new Set([0]) }).output;

        const logits = new Float32Array(this.vocabSize);
        for (let v = 0; v < this.vocabSize; v++) {
          let dot = this.weights.biases[v];
          const ow = this.weights.outputWeights[v];
          for (let d = 0; d < dim; d++) dot += hidden[d] * ow[d];
          logits[v] = dot;
        }
        let maxLogit = -Infinity;
        for (const l of logits) if (Number.isFinite(l) && l > maxLogit) maxLogit = l;
        if (!Number.isFinite(maxLogit)) maxLogit = 0;
        const probs = new Float32Array(this.vocabSize);
        let sumExp = 0;
        for (let v = 0; v < this.vocabSize; v++) { probs[v] = Math.exp((Number.isFinite(logits[v]) ? logits[v] : -100) - maxLogit); sumExp += probs[v]; }
        for (let v = 0; v < this.vocabSize; v++) probs[v] = sumExp > 0 ? probs[v] / sumExp : 1 / this.vocabSize;
        totalLoss += -Math.log(Math.max(probs[targetId], 1e-10));
        count++;

        const gradOutput = new Float32Array(this.vocabSize);
        for (let v = 0; v < this.vocabSize; v++) gradOutput[v] = probs[v];
        gradOutput[targetId] -= 1;

        const gradHidden = new Float32Array(dim);
        for (let v = 0; v < this.vocabSize; v++) {
          const ow = this.weights.outputWeights[v];
          for (let d = 0; d < dim; d++) {
            gradHidden[d] += gradOutput[v] * ow[d];
            ow[d] -= lr * gradOutput[v] * hidden[d];
          }
          this.weights.biases[v] -= lr * gradOutput[v];
        }

        const params = this.elasticCore.getParameters();
        const outputProjection = new Float32Array(params.outputProjection.length);
        for (let idx = 0; idx < outputProjection.length; idx++) outputProjection[idx] = gradHidden[idx % dim] / params.outputProjection.length;
        const biases = new Float32Array(params.biases.length);
        for (let idx = 0; idx < biases.length; idx++) biases[idx] = gradHidden[idx % dim] / params.biases.length;
        this.elasticCore.applyGradients({ outputProjection, biases }, { learningRate: lr, vale });
        this.weights.samplesProcessed++;
      }
    }
    this.weights.trainingLoss = count > 0 ? totalLoss / count : 0;
  }

  predict(contextChars: string): Float32Array {
    const probs = new Float32Array(this.vocabSize);
    const unigram = this.weights.unigramFrequencies;

    let totalWeight = 0;
    let matched = false;

    for (let order = this.config.ngramOrder; order >= 1; order--) {
      const tableIdx = order - 1;
      const table = this.weights.ngramTables[tableIdx];
      if (!table) continue;

      const ctx = contextChars.slice(-order);
      const counts = table.counts.get(ctx);
      const total = table.totals.get(ctx);

      if (counts && total && total > 0) {
        const weight = order * order;
        for (const [charId, count] of counts) {
          probs[charId] = (probs[charId] ?? 0) + (count / total) * weight;
        }
        totalWeight += weight;
        matched = true;
      }
    }

    if (!matched) {
      let unigramSum = 0;
      for (let v = 4; v < this.vocabSize; v++) {
        probs[v] = unigram[v] ?? 0;
        unigramSum += probs[v]!;
      }
      if (unigramSum > 0) {
        for (let v = 0; v < this.vocabSize; v++) {
          probs[v] = (probs[v] ?? 0) / unigramSum;
        }
      }
      return probs;
    }

    const blendFactor = 0.05;
    for (let v = 4; v < this.vocabSize; v++) {
      probs[v] = (probs[v] ?? 0) + unigram[v]! * blendFactor * totalWeight;
    }
    totalWeight += blendFactor * totalWeight;

    if (totalWeight > 0) {
      for (let v = 0; v < this.vocabSize; v++) {
        probs[v] = (probs[v] ?? 0) / totalWeight;
      }
    }

    return probs;
  }

  getEmbedding(tokenId: number): Float32Array | null {
    return this.weights.embeddings.get(tokenId) ?? null;
  }

  isTrained(): boolean {
    return this.weights.trained;
  }

  getTrainingLoss(): number {
    return this.weights.trainingLoss;
  }

  getSamplesProcessed(): number {
    return this.weights.samplesProcessed;
  }

  getElasticCore(): ElasticCoreBlock | null {
    return this.elasticCore;
  }
}
