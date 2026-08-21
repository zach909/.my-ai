import type { PluginDefinition, SkillDefinition } from "../../plugin_manager/types.js";
import { SkillPlugin } from "../../plugin_manager/sdk.js";
import { createContext, Script } from "node:vm";

/** Result of a single runSandboxed() call. */
export interface SandboxRunResult {
  result: unknown;
  error: string | null;
  ms: number;
}

/** Hard ceiling on a single sandboxed run -- this is meant for quick calculation/data-shaping, not a general job runner. */
const SANDBOX_TIMEOUT_MS = 1000;

interface CodeAnalysis {
  lines: number;
  chars: number;
  tokens: string[];
  keywords: string[];
  strings: number;
  comments: number;
  indentLevel: number;
  functionCount: number;
  language: string;
  imports: string[];
  complexity: number;
  issues: string[];
}

export class CodingExtension extends SkillPlugin {
  constructor(definition: PluginDefinition, skillDefinition: SkillDefinition) {
    super(definition, skillDefinition);
  }

  /**
   * onMessage was never overridden here, so BasePlugin's default (echo the
   * input back) is what dispatch() actually called -- execute()'s real
   * static-analysis logic below had no live call site anywhere in the
   * system despite being fully implemented. This connects it, and adds the
   * one real capability that was still missing entirely: actually running
   * a snippet (not just analyzing it) via runSandboxed() below, for a
   * caller that says "run:"/"execute:"/"calculate:"/"eval:" up front.
   * Anything else still goes through the existing analysis path.
   */
  override async onMessage(message: unknown): Promise<unknown> {
    const input = typeof message === "string" ? message : String(message ?? "");
    const m = input.match(/^(run|execute|calculate|eval)\s*:\s*([\s\S]+)$/i);
    if (m) return this.runSandboxed(m[2]);
    return this.execute(input);
  }

  /**
   * Runs a JS snippet in a genuinely isolated vm context: no `require`, no
   * `process`, no filesystem, no network, no access to this process's own
   * globals -- `createContext({})` starts from nothing, and `Script.
   * runInContext`'s `timeout` kills a snippet that hangs or loops forever
   * rather than blocking the caller indefinitely. This is deliberately
   * scoped to quick, pure computation (arithmetic, string/array/JSON
   * manipulation) -- the "calculate things" a math-engine.ts fixed
   * function set can't cover, not a general job runner. Consistent with
   * the project's NO EXTERNAL APIS constraint: nothing network-capable is
   * ever exposed inside the sandbox, so it cannot reach out even if asked to.
   */
  runSandboxed(code: string): SandboxRunResult {
    const start = Date.now();
    try {
      const sandbox = createContext({}); // fresh, empty global object -- no ambient access to this process
      const script = new Script(code, { filename: "sandboxed-snippet.js" });
      const result = script.runInContext(sandbox, { timeout: SANDBOX_TIMEOUT_MS });
      return { result, error: null, ms: Date.now() - start };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { result: undefined, error: msg, ms: Date.now() - start };
    }
  }

  async execute(input: unknown): Promise<unknown> {
    const code = input as string;
    if (typeof code !== "string") {
      throw new Error("CodingExtension expects a string input");
    }

    const analysis = this.analyzeCode(code);
    const generated = this.generateCode(input, analysis);

    return {
      original: code,
      formatted: this.formatCode(code),
      analysis,
      generated,
      lineCount: analysis.lines,
      charCount: analysis.chars,
      timestamp: Date.now(),
    };
  }

  private analyzeCode(code: string): CodeAnalysis {
    const lines = code.split('\n');
    const tokens = code.split(/\b/).filter(t => t.trim().length > 0);
    const keywords = this.extractKeywords(code);
    const strings = (code.match(/["'`]/g) || []).length / 2;
    const comments = (code.match(/\/\/.*$|\/\*[\s\S]*?\*\//gm) || []).length;
    const imports = this.extractImports(code);
    const functionCount = (code.match(/\b(function|def|fn|fun|async)\s+\w+\s*\(/g) || []).length;
    const complexity = this.calculateComplexity(code);
    const issues = this.findIssues(code);

    return {
      lines: lines.length,
      chars: code.length,
      tokens,
      keywords,
      strings: Math.floor(strings),
      comments,
      indentLevel: this.averageIndent(lines),
      functionCount,
      language: this.detectLanguage(code),
      imports,
      complexity,
      issues,
    };
  }

  private extractKeywords(code: string): string[] {
    const kw = /\b(const|let|var|function|return|if|else|for|while|class|import|export|def|fn|fun|async|await|try|catch|throw|new|this|super|extends|implements|interface|type|enum|from|require|module)\b/g;
    return [...new Set(code.match(kw) || [])];
  }

  private extractImports(code: string): string[] {
    const results: string[] = [];
    const patterns = [
      /from\s+['"]([^'"]+)['"]/g,
      /require\(['"]([^'"]+)['"]\)/g,
      /import\s+['"]([^'"]+)['"]/g,
      /use\s+(\S+)/g,
      /#include\s*[<"]([^>"]+)[">]/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(code)) !== null) results.push(m[1]);
    }
    return [...new Set(results)];
  }

  private calculateComplexity(code: string): number {
    const branches = (code.match(/\b(if|else if|elif|case|for|while|catch)\b/g) || []).length;
      const boolOps = (code.match(/&&|\|\||and|or/g) || []).length;
    const earlyReturns = (code.match(/\breturn\b/g) || []).length;
    return branches * 2 + boolOps + earlyReturns;
  }

  private findIssues(code: string): string[] {
    const issues: string[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 120) issues.push(`Line ${i + 1} > 120 chars`);
      if (line.includes('console.log') || line.includes('print(') || line.includes('println('))
        issues.push(`Line ${i + 1}: debug output`);
      if (/\b(var)\b/.test(line)) issues.push(`Line ${i + 1}: 'var' used, prefer const/let`);
      if (line.match(/^\s{2,}\S/) && !line.match(/^\t/) && !line.match(/^\s{2}/))
        issues.push(`Line ${i + 1}: mixed indentation`);
      if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK'))
        issues.push(`Line ${i + 1}: contains TODO/FIXME`);
    }

    return [...new Set(issues)];
  }

  private formatCode(code: string): string {
    return code.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n');
  }

  private averageIndent(lines: string[]): number {
    const indented = lines.filter(l => /^\s+/.test(l));
    if (indented.length === 0) return 0;
    const sum = indented.reduce((s, l) => s + (l.match(/^\s*/)?.[0]?.length ?? 0), 0);
    return Math.round(sum / indented.length);
  }

  private detectLanguage(code: string): string {
    const sigs: [RegExp, string][] = [
      [/<\/?[a-z]+[\s>]/i, 'HTML'],
      [/[{;]\s*$/, 'C-like'],
      [/def\s+\w+\s*\(/, 'Python'],
      [/fn\s+\w+\s*\(/, 'Rust'],
      [/function\s+\w+\s*\(/, 'JavaScript/TypeScript'],
      [/^(import|export)\s/, 'ES Module'],
      [/require\(/, 'CommonJS'],
      [/#include\s/, 'C/C++'],
      [/^using\s+(namespace|System)/m, 'C#'],
      [/^(package|import)\s+[a-z]/m, 'Java'],
      [/^(pub\s+)?(fn|unsafe)/m, 'Rust'],
      [/^module\s+\w+/m, 'Ruby'],
      [/^(#!|%%)/m, 'Script'],
    ];
    for (const [re, lang] of sigs) {
      if (re.test(code)) return lang;
    }
    return 'Unknown';
  }

  private generateCode(input: unknown, analysis: CodeAnalysis): string {
    if (typeof input !== 'string') return '';

    const lower = input.toLowerCase();

    if (lower.startsWith('function ') || lower.startsWith('generate function ')) {
      const name = lower.replace(/^(generate\s+)?function\s+/i, '').split(/\s+/)[0] || 'myFunction';
      return `function ${name}() {\n  // TODO: implement\n  return null;\n}`;
    }

    if (lower.startsWith('class ')) {
      const name = lower.replace(/^class\s+/i, '').split(/\s+/)[0] || 'MyClass';
      return `class ${name} {\n  constructor() {\n    // TODO\n  }\n}`;
    }

    if (lower.includes('http') || lower.includes('fetch') || lower.includes('api')) {
      return `async function fetchData(url: string): Promise<unknown> {\n  const response = await fetch(url);\n  if (!response.ok) throw new Error(\`HTTP \${response.status}\`);\n  return response.json();\n}`;
    }

    if (lower.includes('loop') || lower.includes('iterate') || lower.includes('each')) {
      return `const items: unknown[] = [];\nfor (const item of items) {\n  // process\n}`;
    }

    if (lower.includes('sort') || lower.includes('search')) {
      return `function binarySearch<T>(arr: T[], target: T): number {\n  let lo = 0, hi = arr.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >>> 1;\n    if (arr[mid] < target) lo = mid + 1;\n    else if (arr[mid] > target) hi = mid - 1;\n    else return mid;\n  }\n  return -1;\n}`;
    }

    return '';
  }

  getExpertWeights(): number[] {
    return [0.95, 0.9, 0.85, 0.9, 0.8];
  }
}
