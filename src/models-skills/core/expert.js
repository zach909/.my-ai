export class ExpertNetwork {
    config;
    expertId;
    w1;
    b1;
    w2;
    b2;
    forwardCalls = 0;
    loadFactor = 0;
    createdAt;
    constructor(expertId, config = {}) {
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
    forward(input, outputDim) {
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
    gelu(x) {
        return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));
    }
    getExpert() {
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
