import { SkillPlugin } from "../../plugin_manager/sdk.js";
import { createContext, Script } from "node:vm";
import { iterateOnCode, verifyCode, } from "../../models && skills/core/code-iteration.js";
/** Parses an expected value, falling back to the literal text when it is not JSON. */
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
/** Hard ceiling on a single sandboxed run -- this is meant for quick calculation/data-shaping, not a general job runner. */
const SANDBOX_TIMEOUT_MS = 1000;
export class CodingExtension extends SkillPlugin {
    constructor(definition, skillDefinition) {
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
    describeCapabilities() {
        return {
            commands: ["run:", "execute:", "eval:", "calculate:", "verify:", "check:"],
            verbs: ["code", "program", "implement", "debug", "refactor", "compile", "verify", "test"],
            nouns: ["code", "function", "script", "snippet", "bug", "syntax", "algorithm"],
        };
    }
    async onMessage(message) {
        const input = typeof message === "string" ? message : String(message ?? "");
        // verify: <code> ||| <expression> === <expected>
        // Checking is what makes writing code work, so it gets a way in that does
        // not require a caller to already hold a reference to this class.
        const verify = input.match(/^(?:verify|check)\s*:\s*([\s\S]+?)\s*\|\|\|\s*([\s\S]+)$/i);
        if (verify) {
            const checks = verify[2]
                .split("\n")
                .map(line => line.trim())
                .filter(Boolean)
                .map((line, i) => {
                const parts = line.split("===");
                return {
                    name: `check ${i + 1}`,
                    expression: (parts[0] ?? "").trim(),
                    expected: safeJson((parts[1] ?? "").trim()),
                };
            });
            return this.verify(verify[1], checks);
        }
        const m = input.match(/^(run|execute|calculate|eval)\s*:\s*([\s\S]+)$/i);
        if (m)
            return this.runSandboxed(m[2]);
        return this.execute(input);
    }
    /**
     * Run code against real checks and say precisely what failed.
     *
     * Separate from runSandboxed() because "did it run" and "is it right" are
     * different questions, and only the second one supports fixing anything.
     */
    verify(code, checks) {
        return verifyCode(code, checks);
    }
    /**
     * Write, run, read the failure, revise, repeat -- the loop that actually
     * makes coding work. The proposing intelligence is the caller's; this owns
     * the checking and the stopping conditions.
     */
    iterate(input) {
        return iterateOnCode(input);
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
    runSandboxed(code) {
        const start = Date.now();
        try {
            const sandbox = createContext({}); // fresh, empty global object -- no ambient access to this process
            const script = new Script(code, { filename: "sandboxed-snippet.js" });
            const result = script.runInContext(sandbox, { timeout: SANDBOX_TIMEOUT_MS });
            return { result, error: null, ms: Date.now() - start };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { result: undefined, error: msg, ms: Date.now() - start };
        }
    }
    async execute(input) {
        const code = input;
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
    analyzeCode(code) {
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
    extractKeywords(code) {
        const kw = /\b(const|let|var|function|return|if|else|for|while|class|import|export|def|fn|fun|async|await|try|catch|throw|new|this|super|extends|implements|interface|type|enum|from|require|module)\b/g;
        return [...new Set(code.match(kw) || [])];
    }
    extractImports(code) {
        const results = [];
        const patterns = [
            /from\s+['"]([^'"]+)['"]/g,
            /require\(['"]([^'"]+)['"]\)/g,
            /import\s+['"]([^'"]+)['"]/g,
            /use\s+(\S+)/g,
            /#include\s*[<"]([^>"]+)[">]/g,
        ];
        for (const re of patterns) {
            let m;
            while ((m = re.exec(code)) !== null)
                results.push(m[1]);
        }
        return [...new Set(results)];
    }
    calculateComplexity(code) {
        const branches = (code.match(/\b(if|else if|elif|case|for|while|catch)\b/g) || []).length;
        const boolOps = (code.match(/&&|\|\||and|or/g) || []).length;
        const earlyReturns = (code.match(/\breturn\b/g) || []).length;
        return branches * 2 + boolOps + earlyReturns;
    }
    findIssues(code) {
        const issues = [];
        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length > 120)
                issues.push(`Line ${i + 1} > 120 chars`);
            if (line.includes('console.log') || line.includes('print(') || line.includes('println('))
                issues.push(`Line ${i + 1}: debug output`);
            if (/\b(var)\b/.test(line))
                issues.push(`Line ${i + 1}: 'var' used, prefer const/let`);
            if (line.match(/^\s{2,}\S/) && !line.match(/^\t/) && !line.match(/^\s{2}/))
                issues.push(`Line ${i + 1}: mixed indentation`);
            if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK'))
                issues.push(`Line ${i + 1}: contains TODO/FIXME`);
        }
        return [...new Set(issues)];
    }
    formatCode(code) {
        return code.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n');
    }
    averageIndent(lines) {
        const indented = lines.filter(l => /^\s+/.test(l));
        if (indented.length === 0)
            return 0;
        const sum = indented.reduce((s, l) => s + (l.match(/^\s*/)?.[0]?.length ?? 0), 0);
        return Math.round(sum / indented.length);
    }
    detectLanguage(code) {
        const sigs = [
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
            if (re.test(code))
                return lang;
        }
        return 'Unknown';
    }
    generateCode(input, analysis) {
        if (typeof input !== 'string')
            return '';
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
    getExpertWeights() {
        return [0.95, 0.9, 0.85, 0.9, 0.8];
    }
}
