const fs = require('fs');
let code = fs.readFileSync('models && skills/core/hyperdimensional.ts', 'utf-8');

code = code.replace(
  /      this\.neurons\.push\(\{\n        id: i,\n        state,\n        energy: 0,\n        transitions: \[\],\n        influenceRadius: 0\.1 \+ Math\.random\(\) \* 0\.4,\n        activationThreshold: 0\.3 \+ Math\.random\(\) \* 0\.4,\n      \}\);/,
  `      this.neurons.push({
        id: i,
        state,
        energy: 0,
        transitions: [],
        influenceRadius: 0.1 + Math.random() * 0.4,
        activationThreshold: 0.3 + Math.random() * 0.4,
        bias: (Math.random() * 2 - 1) * 0.1,
        connectionWeights: new Map()
      });`
);

fs.writeFileSync('models && skills/core/hyperdimensional.ts', code, 'utf-8');
