const fs = require('fs');
let code = fs.readFileSync('models && skills/core/mesh.ts', 'utf-8');

code = code.replace(
  /  getNodeCount\(\): number \{\n    return this\.nodes\.size;\n  \}/,
  `  getNodeCount(): number {
    return this.nodes.size;
  }

  // Section 9: Symbolic State — On-Demand, Not Continuous
  traceSymbolic(nodeId: number, depth: number = 2): string {
    if (depth <= 0) return \`N\${nodeId}\`;
    const node = this.nodes.get(nodeId);
    if (!node) return \`N\${nodeId}\`;
    
    const terms: string[] = [];
    if (Math.abs(node.bias) > 0.01) {
      terms.push(node.bias.toFixed(3));
    }
    
    // Find active connections
    for (const [neighborId, weight] of node.connections) {
      if (Math.abs(weight) > 0.05) {
        const neighbor = this.nodes.get(neighborId);
        // Only trace active neurons to avoid expression swell
        if (neighbor && Math.abs(neighbor.activation) > 0.1) {
          const subTrace = this.traceSymbolic(neighborId, depth - 1);
          terms.push(\`(\${weight.toFixed(2)} * \${subTrace})\`);
        }
      }
    }
    
    if (terms.length === 0) return \`N\${nodeId}\`;
    return \`\${this.config.activationFunction || 'relu'}(\${terms.join(' + ')})\`;
  }`
);

fs.writeFileSync('models && skills/core/mesh.ts', code, 'utf-8');
