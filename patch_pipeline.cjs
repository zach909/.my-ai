const fs = require('fs');
let code = fs.readFileSync('models && skills/core/pipeline.ts', 'utf-8');

// Add CompressedSelfModel class
code = code.replace(
  /export class NeuroPipeline \{/,
  `class CompressedSelfModel {
  private weights: Float32Array;
  constructor(private inputDim: number, private outputDim: number) {
    this.weights = new Float32Array(inputDim * outputDim).map(() => (Math.random() - 0.5) * 0.1);
  }
  predict(inputs: Map<number, number>): number[] {
    const out = new Array(this.outputDim).fill(0);
    for (const [nodeId, val] of inputs) {
      if (nodeId < this.inputDim) {
        for (let i = 0; i < this.outputDim; i++) {
          out[i] += val * this.weights[nodeId * this.outputDim + i];
        }
      }
    }
    return out;
  }
  update(inputs: Map<number, number>, actuals: number[], lr: number = 0.01): number {
    const predicted = this.predict(inputs);
    let errorSum = 0;
    for (let i = 0; i < this.outputDim; i++) {
      const error = actuals[i] - predicted[i];
      errorSum += Math.abs(error);
      for (const [nodeId, val] of inputs) {
        if (nodeId < this.inputDim) {
          this.weights[nodeId * this.outputDim + i] += lr * error * val;
        }
      }
    }
    return errorSum / (this.outputDim || 1);
  }
}

export class NeuroPipeline {
  private selfModel: CompressedSelfModel | null = null;`
);

// Instantiate self model in reset
code = code.replace(
  /this\.zipIO = null;\n    this\.valueInitialized = false;/,
  `this.zipIO = null;
    this.valueInitialized = false;
    this.selfModel = null;`
);

// Apply prediction in step 2
code = code.replace(
  /      const meshNodeCount = Math\.min\(this\.config\.meshNodes, moeOutput\.length\);\n      for \(let i = 0; i < meshNodeCount; i\+\+\) \{\n        meshInputs\.set\(i, moeOutput\[i\] \|\| 0\);\n      \}\n\n      const propagation = this\.mesh!\.propagate\(meshInputs\);/,
  `      const meshNodeCount = Math.min(this.config.meshNodes, moeOutput.length);
      for (let i = 0; i < meshNodeCount; i++) {
        meshInputs.set(i, moeOutput[i] || 0);
      }

      if (!this.selfModel) {
        this.selfModel = new CompressedSelfModel(this.config.meshNodes, this.config.meshNodes);
      }
      const predictedState = this.selfModel.predict(meshInputs);
      
      const propagation = this.mesh!.propagate(meshInputs);
      const actualState = Array.from(propagation.finalStates.values());
      const noveltySignal = this.selfModel.update(meshInputs, actualState);
      
      if (this.hyperEngine) {
        // High error = high novelty = low decay (longer influence)
        this.hyperEngine.setInfluenceDecay(Math.max(0.1, Math.min(0.99, 1.0 - noveltySignal)));
      }`
);

fs.writeFileSync('models && skills/core/pipeline.ts', code, 'utf-8');
