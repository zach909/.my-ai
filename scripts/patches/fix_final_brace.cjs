const fs = require('fs');
let code = fs.readFileSync('models && skills/core/hyperdimensional.ts', 'utf-8');
code = code.replace(/    \}\n  \}\n      \}\n    const resolved: StateTransition/, '    }\n  }\n\n  private resolveStateTransitions(): StateTransition');
fs.writeFileSync('models && skills/core/hyperdimensional.ts', code, 'utf-8');
