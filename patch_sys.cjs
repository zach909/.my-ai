const fs = require('fs');
let code = fs.readFileSync('models && skills/core/zip-io.ts', 'utf-8');
code = code.replace(
  /  async ingest\(input: string\): Promise<void> \{\n    await this.inputLoop.zipInput\(input\);\n  \}/,
  `  private actionCount = 0;
  async ingest(input: string): Promise<void> {
    await this.inputLoop.zipInput(input);
    if (++this.actionCount % 100 === 0) {
      await this.inputLoop.checkpoint();
      await this.outputLoop.checkpoint();
    }
  }`
);
code = code.replace(
  /  async emit\(output: string\): Promise<void> \{\n    await this.outputLoop.zipInput\(output\);\n  \}/,
  `  async emit(output: string): Promise<void> {
    await this.outputLoop.zipInput(output);
    if (++this.actionCount % 100 === 0) {
      await this.inputLoop.checkpoint();
      await this.outputLoop.checkpoint();
    }
  }`
);
fs.writeFileSync('models && skills/core/zip-io.ts', code, 'utf-8');
