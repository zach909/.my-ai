const fs = require('fs');
let code = fs.readFileSync('models && skills/core/zip-io.ts', 'utf-8');
code = code.replace(
  /this\.diskSpillPath = join\(tmpdir\(\), \`prometheus-zip-\$\{randomUUID\(\)\}\`\);/,
  "this.diskSpillPath = join(tmpdir(), `prometheus-zip-${randomUUID()}.json`);"
);
code = code.replace(
  /  \/\*\*\n   \* "Zip" an input/,
  `  async checkpoint(): Promise<void> {
    if (!this.diskSpillPath) return;
    const exportData = {
      capacity: this.capacity,
      head: this.head,
      tail: this.tail,
      size: this.size,
      buffer: this.buffer.map(chunk => chunk ? {
        ...chunk,
        data: chunk.data.toString('base64')
      } : null)
    };
    await writeFile(this.diskSpillPath, JSON.stringify(exportData), 'utf-8');
    console.log(\`[ZipLoop] Checkpointed state to \${this.diskSpillPath}\`);
  }

  async reload(): Promise<void> {
    if (!this.diskSpillPath || !existsSync(this.diskSpillPath)) return;
    try {
      const content = await readFile(this.diskSpillPath, 'utf-8');
      const importData = JSON.parse(content);
      this.capacity = importData.capacity;
      this.head = importData.head;
      this.tail = importData.tail;
      this.size = importData.size;
      this.buffer = importData.buffer.map((chunk: any) => chunk ? {
        ...chunk,
        data: Buffer.from(chunk.data, 'base64')
      } : null);
      console.log(\`[ZipLoop] Reloaded state from \${this.diskSpillPath}\`);
    } catch (e) {
      console.warn(\`[ZipLoop] Failed to reload state from \${this.diskSpillPath}\`, e);
    }
  }

  /**
   * "Zip" an input`
);
fs.writeFileSync('models && skills/core/zip-io.ts', code, 'utf-8');
