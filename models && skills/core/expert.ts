export interface ExpertConfig {
  inputDim: number;
  hiddenDim: number;
  outputDim: number;
  learningRate: number;
  dropoutRate: number;
  activation: 'gelu' | 'relu' | 'tanh';
}

export interface ExpertMetadata {
  expertId: number;
  config: ExpertConfig;
  totalForwardCalls: number;
  loadFactor: number;
  creationTimestamp: number;
  parameterCount: number;
}

export class ExpertNetwork {
  private config: ExpertConfig;
  private expertId: number;
  private w1: Float32Array;
  private b1: Float32Array;
  private w2: Float32Array;
  private b2: Float32Array;
  private forwardCalls: number = 0;
  private loadFactor: number = 0;
  private createdAt: number;

  constructor(expertId: number, config: Partial<ExpertConfig> = {}) {
    this.expertId = expertId;
    this.createdAt = Date.now();
    this.config = {
      inputDim: 768,
      hiddenDim: 512,
      outputDim: 768,
      learningRate: 0.001,
      dropoutRate: 0.1,
      activation: 'gelu',
      ...config,
    };
    const scale1 = Math.sqrt(2.0 / this.config.inputDim);
    this.w1 = new Float32Array(this.config.inputDim * this.config.hiddenDim);
    this.b1 = new Float32Array(this.config.hiddenDim);
    for (let i = 0; i < this.w1.length; i++) {
      this.w1[i] = (Math.random() * 2 - 1) * scale1;
    }
    const scale2 = Math.sqrt(2.0 / this.config.hiddenDim);
    this.w2 = new Float32Array(this.config.hiddenDim * this.config.outputDim);
    this.b2 = new Float32Array(this.config.outputDim);
    for (let i = 0; i < this.w2.length; i++) {
      this.w2[i] = (Math.random() * 2 - 1) * scale2;
    }
  }

  forward(input: Float32Array, outputDim?: number): Float32Array {
    this.forwardCalls++;
    const outDim = outputDim || this.config.outputDim;
    const hidden = new Float32Array(this.config.hiddenDim);

    for (let j = 0; j < this.config.hiddenDim; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * this.w1[i * this.config.hiddenDim + j];
      }
      hidden[j] = this.gelu(sum);
    }

    const output = new Float32Array(outDim);
    for (let j = 0; j < outDim; j++) {
      let sum = this.b2[j] || 0;
      for (let i = 0; i < this.config.hiddenDim; i++) {
        sum += hidden[i] * this.w2[i * this.config.outputDim + j];
      }
      output[j] = sum;
    }

    this.loadFactor = this.forwardCalls / (Date.now() - this.createdAt + 1) * 100;
    return output;
  }

  private gelu(x: number): number {
    return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));
  }

  getExpert(): ExpertMetadata {
    return {
      expertId: this.expertId,
      config: this.config,
      totalForwardCalls: this.forwardCalls,
      loadFactor: this.loadFactor,
      creationTimestamp: this.createdAt,
      parameterCount: this.w1.length + this.b1.length + this.w2.length + this.b2.length,
    };
  }
}
