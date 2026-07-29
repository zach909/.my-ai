const fs = require('fs');
let code = fs.readFileSync('models && skills/core/hyperdimensional.ts', 'utf-8');

code = code.replace(
  /  private updateNeuronState\(neuron: HyperNeuron, input: number\[\], learningRate: number\): void \{/,
  `  private updateNeuronState(neuron: HyperNeuron, input: number[], learningRate: number, isExternal: boolean = false): void {
    // Section 5: Input-Source Awareness. Reserve state[0] as the input flag.
    neuron.state[0] = isExternal ? 1.0 : 0.0;
    // The rest of the dimensions update normally starting from d = 1
    for (let d = 1; d < this.config.dimensions; d++) {`
);

code = code.replace(
  /      this\.updateNeuronState\(neuron, resolvedInput, rate\);/,
  `      // If this neuron corresponds to an active input dimension, mark it external
      const isExternal = resolvedInput.length > neuron.id && Math.abs(resolvedInput[neuron.id]) > 0.01;
      this.updateNeuronState(neuron, resolvedInput, rate, isExternal);`
);

fs.writeFileSync('models && skills/core/hyperdimensional.ts', code, 'utf-8');
