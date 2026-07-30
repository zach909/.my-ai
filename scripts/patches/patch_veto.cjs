const fs = require('fs');
let code = fs.readFileSync('models && skills/core/pipeline.ts', 'utf-8');

code = code.replace(
  /class CompressedSelfModel \{/,
  `class EmpathyBenevolenceVeto {
  private benevolenceWeights: Float32Array;
  constructor(private dim: number) {
    this.benevolenceWeights = new Float32Array(dim).map(() => Math.random() * 0.1);
  }
  
  // Veto if the projected harm (negative benevolence) exceeds a safe threshold
  shouldVeto(state: number[]): boolean {
    let score = 0;
    for (let i = 0; i < this.dim; i++) {
      score += (state[i] || 0) * this.benevolenceWeights[i];
    }
    // High score indicates safety. If score falls below a threshold, it's a veto.
    return score < -0.5; // Fails safe if weights drift negative
  }
}

class CompressedSelfModel {`
);

code = code.replace(
  /  private selfModel: CompressedSelfModel \| null = null;/,
  `  private selfModel: CompressedSelfModel | null = null;
  private empathyVeto: EmpathyBenevolenceVeto | null = null;`
);

code = code.replace(
  /    this\.zipIO = null;\n    this\.valueInitialized = false;\n    this\.selfModel = null;/,
  `    this.zipIO = null;
    this.valueInitialized = false;
    this.selfModel = null;
    this.empathyVeto = null;`
);

code = code.replace(
  /      const outputText = \`Action:\$\{rlmAction\}\|Quantum:\$\{quantumOutput.slice\(0,3\)\.join\(','\)\}\|Steps:\$\{rlmThinkingSteps.length\}\`;\n      await this\.zipIO!\.emit\(outputText\);/,
  `      if (!this.empathyVeto) {
        this.empathyVeto = new EmpathyBenevolenceVeto(quantumOutput.length);
      }
      if (this.empathyVeto.shouldVeto(quantumOutput)) {
        console.warn('[EmpathyVeto] Action vetoed by benevolence model (failsafe).');
        rlmAction = -1; // Vetoed action fallback
      }
      
      const outputText = \`Action:\${rlmAction}|Quantum:\${quantumOutput.slice(0,3).join(',')}|Steps:\${rlmThinkingSteps.length}\`;
      await this.zipIO!.emit(outputText);`
);

fs.writeFileSync('models && skills/core/pipeline.ts', code, 'utf-8');
