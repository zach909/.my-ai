const fs = require('fs');
let code = fs.readFileSync('models && skills/core/hyperdimensional.ts', 'utf-8');

code = code.replace(
  /export interface HyperNeuron \{/,
  `export interface HyperNeuron {
  bias: number;
  connectionWeights: Map<number, number[]>;`
);

code = code.replace(
  /        const neuron: HyperNeuron = \{\n          id: i,\n          state: new Array\(this\.config\.dimensions\)\.fill\(0\),\n          energy: 0,\n        \};/,
  `        const neuron: HyperNeuron = {
          id: i,
          state: new Array(this.config.dimensions).fill(0),
          energy: 0,
          bias: (Math.random() * 2 - 1) * 0.1,
          connectionWeights: new Map()
        };`
);

// We need to initialize the connectionWeights. Let's do it in the constructor or dynamically.
code = code.replace(
  /    for \(let i = 0; i < this\.config\.neuronCount; i\+\+\) \{\n      if \(\!this\.neurons\[i\]\) \{/,
  `    for (let i = 0; i < this.config.neuronCount; i++) {
      if (!this.neurons[i]) {`
);

// Inside `crossInfluence`:
// We replace the dot-product similarity with the W*S + b logic
code = code.replace(
  /  private crossInfluence\(\): void \{[\s\S]*?  \}/,
  `  private computeNext(): void {
    // Section 8: Per-Connection Weights
    const nextStates = new Map<number, number[]>();
    for (let i = 0; i < this.neurons.length; i++) {
      const target = this.neurons[i];
      const nextState = new Array(this.config.dimensions).fill(target.bias);
      // Keep state[0] as input flag
      nextState[0] = target.state[0]; 
      
      for (let j = 0; j < this.neurons.length; j++) {
        if (i === j) continue;
        const source = this.neurons[j];
        
        // Initialize bounded weights lazily (diagonal)
        if (!target.connectionWeights.has(source.id)) {
          const w = new Array(this.config.dimensions).fill(0).map(() => (Math.random() * 2 - 1) * 0.05);
          target.connectionWeights.set(source.id, w);
        }
        const w = target.connectionWeights.get(source.id)!;
        
        // W * S (diagonal bounded cross-terms for Pi)
        for (let d = 1; d < this.config.dimensions; d++) {
          nextState[d] += source.state[d] * w[d];
        }
      }
      
      // Activation function (e.g. tanh)
      for (let d = 1; d < this.config.dimensions; d++) {
        nextState[d] = Math.tanh(nextState[d]);
      }
      
      nextStates.set(target.id, nextState);
    }
    
    // Apply updates
    for (const neuron of this.neurons) {
      const next = nextStates.get(neuron.id);
      if (next) {
        neuron.state = next;
      }
    }
  }`
);

code = code.replace(/this\.crossInfluence\(\);/, 'this.computeNext();');

fs.writeFileSync('models && skills/core/hyperdimensional.ts', code, 'utf-8');
