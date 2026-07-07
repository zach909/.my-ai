const fs = require('fs');
let code = fs.readFileSync('models && skills/core/mesh.ts', 'utf-8');

code = code.replace(
  /  applyValueWeightedLearning\(learningRates: Map<number, number>\): Map<number, number> \{/,
  `  // Helper for QAT (Quantization-Aware Training)
  private simulateQuantizationDrop(value: number, bits: number = 8): number {
    const levels = Math.pow(2, bits) - 1;
    return Math.round(value * levels) / levels;
  }

  applyValueWeightedLearning(learningRates: Map<number, number>): Map<number, number> {`
);

code = code.replace(
  /        const delta = learningRate \* node\.activation \* neighbor\.activation;/,
  `        let delta = learningRate * node.activation * neighbor.activation;
        // Section 6: QAT with error-feedback residuals
        const newWeightRaw = weight + delta;
        const newWeightQuantized = this.simulateQuantizationDrop(newWeightRaw);
        const residual = newWeightRaw - newWeightQuantized;
        // The network absorbs the residual error into the delta, forcing it to route around precision loss
        delta += residual * 0.1;`
);

fs.writeFileSync('models && skills/core/mesh.ts', code, 'utf-8');
