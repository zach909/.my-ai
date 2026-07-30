const fs = require('fs');
let code = fs.readFileSync('models && skills/core/hyperdimensional.ts', 'utf-8');
code = code.replace(/    for \(let d = 1; d < this\.config\.dimensions; d\+\+\) \{\n    for \(let d = 0; d < this\.config\.dimensions; d\+\+\) \{/, '    for (let d = 1; d < this.config.dimensions; d++) {');
fs.writeFileSync('models && skills/core/hyperdimensional.ts', code, 'utf-8');
