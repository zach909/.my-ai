const fs = require('fs');
let code = fs.readFileSync('models && skills/core/mesh.ts', 'utf-8');

code = code.replace(
  /  propagate\(inputActivations: Map<number, number> \| Map<string, number>\): PropagationResult \{/,
  `  propagate(
    inputActivations: Map<number, number> | Map<string, number>,
    onTick?: (state: Map<number, number>) => boolean
  ): PropagationResult {`
);

code = code.replace(
  /      if \(this\.checkConvergence\(residual\)\) \{\n        converged = true;\n        break;\n      \}/,
  `      if (this.checkConvergence(residual)) {
        converged = true;
        break;
      }
      if (onTick && onTick(this.captureState())) {
        converged = false;
        break; // Divergence detected
      }`
);

fs.writeFileSync('models && skills/core/mesh.ts', code, 'utf-8');
