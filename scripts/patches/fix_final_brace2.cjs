const fs = require('fs');
let code = fs.readFileSync('models && skills/core/hyperdimensional.ts', 'utf-8');
code = code.replace(/  private resolveStateTransitions\(\): StateTransition\[\] = \[\];/, '  private resolveStateTransitions(): StateTransition[] {\n    const resolved: StateTransition[] = [];');
fs.writeFileSync('models && skills/core/hyperdimensional.ts', code, 'utf-8');
