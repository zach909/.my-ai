import * as readline from 'node:readline';
import type { NeuroclawLLM } from "../models && skills/llm.js";
import type { NeuroPipeline } from "../models && skills/core/pipeline.js";
import type { ThesaurusDictionary } from "../models && skills/thesaurus.js";
import type { PluginRegistry } from "../plugin_manager/registry.js";
import type { SystemAccess } from "./system-access.js";
import type { MultiDesktopManager } from "./multi-desktop.js";
import { NeuroLangInterpreter } from "../models && skills/core/neuro-lang.js";

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const GRAY = '\x1b[90m';

export class CLI {
  private llm: NeuroclawLLM;
  private pipeline: NeuroPipeline;
  private thesaurus: ThesaurusDictionary;
  private pluginRegistry: PluginRegistry;
  private systemAccess?: SystemAccess;
  private multiDesktop?: MultiDesktopManager;
  private rl: readline.Interface | null = null;
  private interactiveMode = false;
  private commandQueue: Array<() => Promise<void>> = [];
  private queueRunning = false;
  private neuriBlockMode = false;
  private neuriBlockLines: string[] = [];

  constructor(
    llm: NeuroclawLLM,
    pipeline: NeuroPipeline,
    thesaurus: ThesaurusDictionary,
    pluginRegistry: PluginRegistry,
    systemAccess?: SystemAccess,
    multiDesktop?: MultiDesktopManager,
  ) {
    this.llm = llm;
    this.pipeline = pipeline;
    this.thesaurus = thesaurus;
    this.pluginRegistry = pluginRegistry;
    this.systemAccess = systemAccess;
    this.multiDesktop = multiDesktop;
  }

  private enqueue(fn: () => Promise<void>): void {
    this.commandQueue.push(fn);
    if (!this.queueRunning) this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    this.queueRunning = true;
    while (this.commandQueue.length > 0) {
      const fn = this.commandQueue.shift()!;
      try { await fn(); } catch (e) { console.error(this.colorize(RED, `  Error: ${e}`)); }
    }
    this.queueRunning = false;
    this.rl?.prompt();
  }

  private colorize(color: string, text: string): string {
    return `${color}${text}${RESET}`;
  }

  private printLogo(): void {
    console.log('');
    console.log(this.colorize(CYAN, '  ╔═══════════════════════════════════════╗'));
    console.log(this.colorize(CYAN, '  ║') + this.colorize(BOLD + WHITE, '         N E U R O C L A W           ') + this.colorize(CYAN, '║'));
    console.log(this.colorize(CYAN, '  ║') + this.colorize(GRAY, '     Autonomous AI System v0.1.0      ') + this.colorize(CYAN, '║'));
    console.log(this.colorize(CYAN, '  ╚═══════════════════════════════════════╝'));
    console.log('');
  }

  private printWelcome(): void {
    this.printLogo();
    const stats = this.llm.getStats();
    console.log(this.colorize(GRAY, `  LLM: ${stats.neuronCount} neurons, ${stats.expertCount} MoE experts`));
    console.log(this.colorize(GRAY, `  Pipeline: ${this.pipeline.getStats().runsCount} runs`));
    console.log(this.colorize(GRAY, `  Plugins: ${this.pluginRegistry.getPluginCount()} registered`));
    console.log('');
    console.log(this.colorize(GRAY, '  Type ') + this.colorize(GREEN, 'help') + this.colorize(GRAY, ' for commands or ') + this.colorize(GREEN, 'chat') + this.colorize(GRAY, ' to talk.'));
    console.log('');
  }

  async startInteractive(): Promise<void> {
    this.interactiveMode = true;
    this.printWelcome();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.colorize(CYAN, 'neuroclaw> '),
    });
    this.rl.on('line', (line) => {
      // NeuriLang block mode: collect lines until blank, then run
      if (this.neuriBlockMode) {
        if (line.trim() === '') {
          this.neuriBlockMode = false;
          const code = this.neuriBlockLines.join('\n');
          this.neuriBlockLines = [];
          this.handleNeuri(code);
          this.rl?.setPrompt(this.colorize(CYAN, 'neuroclaw> '));
        } else {
          this.neuriBlockLines.push(line);
          this.rl?.prompt();
        }
        return;
      }
      const trimmed = line.trim();
      if (trimmed === '' || trimmed === 'exit' || trimmed === 'quit') {
        if (trimmed === 'exit' || trimmed === 'quit') { this.rl?.close(); return; }
        this.rl?.prompt(); return;
      }
      const lower = trimmed.toLowerCase();
      // Sync commands: finish instantly, prompt immediately
      if (lower === 'help') { this.printHelp(); this.rl?.prompt(); return; }
      if (lower === 'status') { this.printStatus(); this.rl?.prompt(); return; }
      if (lower === 'desktop') { this.printStatus(); this.printDesktopStatus(); this.rl?.prompt(); return; }
      if (lower === 'plugins' || lower === 'skills') { this.printPlugins(); this.rl?.prompt(); return; }
      if (lower === 'neuri') {
        // Enter block mode — collect NeuriLang lines until a blank line
        this.neuriBlockMode = true;
        this.neuriBlockLines = [];
        this.rl?.setPrompt(this.colorize(YELLOW, '  neuri> '));
        console.log(this.colorize(GRAY, '  Enter NeuriLang code. Blank line to run.'));
        this.rl?.prompt(); return;
      }
      if (lower.startsWith('train ')) { this.handleTrain(trimmed.slice(6)); this.rl?.prompt(); return; }
      if (lower.startsWith('search ')) { this.handleSearch(trimmed.slice(7)); this.rl?.prompt(); return; }
      if (lower.startsWith('nsearch ')) { this.handleNetSearchGenerate(trimmed.slice(8)); this.rl?.prompt(); return; }
      if (lower.startsWith('neuri ')) { this.handleNeuri(trimmed.slice(6)); this.rl?.prompt(); return; }
      if (lower.startsWith('build ')) { this.handleBuild(trimmed.slice(6)); this.rl?.prompt(); return; }
      if (lower.startsWith('dict ') || lower.startsWith('lookup ')) {
        const word = trimmed.includes(' ') ? trimmed.slice(trimmed.indexOf(' ') + 1) : '';
        this.handleDict(word); this.rl?.prompt(); return;
      }
      // Async commands: queue so they run sequentially (prevents race when stdin is piped)
      if (lower === 'chat' || lower === 'start') { this.enqueue(() => this.startChat()); return; }
      if (lower === 'save') { this.enqueue(() => this.handleSave()); return; }
      if (lower === 'quantize') { this.enqueue(() => this.handleQuantize()); return; }
      if (lower.startsWith('generate ') || trimmed.startsWith('"') || trimmed.startsWith("'")) {
        const prompt = lower.startsWith('generate ') ? trimmed.slice(9) : trimmed.replace(/^["']/, '').replace(/["']$/, '');
        this.enqueue(() => this.handleGenerate(prompt)); return;
      }
      if (lower.startsWith('think ')) { this.enqueue(() => this.handleThink(trimmed.slice(6))); return; }
      if (lower.startsWith('trace ')) { this.enqueue(() => this.handleTrace(trimmed.slice(6))); return; }
      // Default: THORNS → plugin dispatch → LLM fallback
      this.enqueue(async () => {
        const before = Date.now();
        const thorns = await this.llm.thinkAbout(trimmed);
        const pluginResult = await this.pluginRegistry.dispatch(trimmed, thorns.intent.intent);
        const response = pluginResult != null
          ? pluginResult
          : await this.llm.generate(trimmed);
        const ms = Date.now() - before;
        console.log(this.colorize(CYAN, '  ai> ') + response);
        console.log(this.colorize(GRAY, `       (${ms}ms)`));
      });
    });
    this.rl.on('close', () => {
      console.log('');
      process.exit(0);
    });
    this.rl.prompt();
  }

  private printHelp(): void {
    console.log(this.colorize(BOLD, '  Commands:'));
    console.log(`    ${this.colorize(GREEN, 'chat')}            ${this.colorize(GRAY, 'Start interactive chat session')}`);
    console.log(`    ${this.colorize(GREEN, 'generate')} ${this.colorize(YELLOW, '<text>')} ${this.colorize(GRAY, 'Generate AI response')}`);
    console.log(`    ${this.colorize(GREEN, 'think')} ${this.colorize(YELLOW, '<prompt>')}  ${this.colorize(GRAY, 'Show THORNS intent analysis')}`);
    console.log(`    ${this.colorize(GREEN, 'trace')} ${this.colorize(YELLOW, '<id> <dim>')} ${this.colorize(GRAY, 'Symbolic trace of a hyperdimensional neuron')}`);
    console.log(`    ${this.colorize(GREEN, 'train')} ${this.colorize(YELLOW, '<text>')}    ${this.colorize(GRAY, 'Train LLM on custom text')}`);
    console.log(`    ${this.colorize(GREEN, 'search')} ${this.colorize(YELLOW, '<query>')}  ${this.colorize(GRAY, 'Search neurons by name/label')}`);
    console.log(`    ${this.colorize(GREEN, 'nsearch')} ${this.colorize(YELLOW, '<query>')} ${this.colorize(GRAY, 'Net Search: semantic match + generate a network')}`);
    console.log(`    ${this.colorize(GREEN, 'neuri')} ${this.colorize(YELLOW, '<code>')}    ${this.colorize(GRAY, 'Run NeuriLang neuron definition')}`);
    console.log(`    ${this.colorize(GREEN, 'dict')} ${this.colorize(YELLOW, '<word>')}     ${this.colorize(GRAY, 'Look up word in dictionary (Y/X/Z)')}`);
    console.log(`    ${this.colorize(GREEN, 'build')} ${this.colorize(YELLOW, '<name>')}    ${this.colorize(GRAY, 'Create a new extension project')}`);
    console.log(`    ${this.colorize(GREEN, 'plugins')}         ${this.colorize(GRAY, 'List all plugins and skills')}`);
    console.log(`    ${this.colorize(GREEN, 'save')}            ${this.colorize(GRAY, 'Save model (full precision)')}`);
    console.log(`    ${this.colorize(GREEN, 'quantize')}        ${this.colorize(GRAY, 'Save model with quantization')}`);
    console.log(`    ${this.colorize(GREEN, 'status')}          ${this.colorize(GRAY, 'Show system status')}`);
    console.log(`    ${this.colorize(GREEN, 'desktop')}         ${this.colorize(GRAY, 'Show desktop & input device status')}`);
    console.log(`    ${this.colorize(GREEN, 'help')}            ${this.colorize(GRAY, 'Show this help')}`);
    console.log(`    ${this.colorize(GREEN, 'exit')}            ${this.colorize(GRAY, 'Exit')}`);
    console.log('');
  }

  private printStatus(): void {
    const stats = this.llm.getStats();
    this.printLogo();
    console.log(this.colorize(BOLD, '  AI System Status:'));
    console.log(`    ${this.colorize(GREEN, '✓')} LLM: ${stats.neuronCount} neurons, ${stats.connectionCount} connections`);
    console.log(`    ${this.colorize(GREEN, '✓')} MoE: ${stats.expertCount} experts`);
    console.log(`    ${this.colorize(GREEN, '✓')} Hyper-dimensional: ${stats.hyperPatternsSeen} patterns seen`);
    console.log(`    ${this.colorize(GREEN, '✓')} RLM: ${stats.rlmBufferSize} experiences, exploration rate ${(stats.rlmExplorationRate * 100).toFixed(1)}%`);
    console.log(`    ${this.colorize(GREEN, '✓')} Self-extensions: ${stats.selfExtensionCount}`);
    console.log(`    ${this.colorize(GREEN, '✓')} Context: ${stats.contextLength} chars`);
    console.log(`    ${this.colorize(GREEN, '✓')} Generations: ${stats.generationCount}`);
    if (this.multiDesktop) {
      const ws = this.multiDesktop.getAiWorkspace();
      const gnome = this.multiDesktop.isGnomeAvailable();
      const xinput = this.multiDesktop.hasXinput();
      const current = this.multiDesktop.getCurrentDesktop();
      const wsActive = ws === 'active';
      console.log(`    ${wsActive ? this.colorize(GREEN, '✓') : this.colorize(YELLOW, '○')} Multi-desktop: ${wsActive ? `AI on workspace ${current}` : 'not initialized'} ${gnome ? '(GNOME)' : '(simulated)'}`);
      console.log(`    ${xinput ? this.colorize(GREEN, '✓') : this.colorize(GRAY, '○')} Xinput: ${xinput ? 'available' : 'not available'}`);
      if (gnome) console.log(`    ${this.colorize(GRAY, '  Current desktop:')} ${current}${current === 'ai' ? this.colorize(CYAN, ' ← AI') : ''}`);
    }
    console.log('');
  }

  private printDesktopStatus(): void {
    if (!this.multiDesktop) {
      console.log(this.colorize(GRAY, '  Multi-desktop not enabled'));
      return;
    }
    const desktops = this.multiDesktop.listDesktops();
    const devices = this.multiDesktop.getVirtualDevices();
    const bindings = this.multiDesktop.getAllBindings();
    const aiWs = this.multiDesktop.getAiWorkspace();
    console.log(this.colorize(BOLD, '  Desktop Status:'));
    console.log(`    ${this.colorize(GREEN, 'Workspaces:')} ${desktops.length}`);
    for (const desktopId of desktops) {
      const session = this.multiDesktop.getSession(desktopId);
      if (!session) continue;
      const marker = session.isActive ? this.colorize(CYAN, '→') : ' ';
      const aiTag = desktopId === 'ai' ? this.colorize(MAGENTA, ' [AI]') : '';
      console.log(`      ${marker} ${session.name}${aiTag}${session.isActive ? this.colorize(GRAY, ' (active)') : ''}`);
    }
    console.log(`    ${this.colorize(GREEN, 'Virtual devices:')} ${devices.length}`);
    for (const d of devices) {
      console.log(`      ${this.colorize(CYAN, '•')} ${d.name} (${d.type})`);
    }
    console.log(`    ${this.colorize(GREEN, 'Device bindings:')} ${bindings.length}`);
    for (const b of bindings) {
      console.log(`      ${this.colorize(CYAN, '•')} ${b.deviceId} → workspace ${b.desktopId} (${b.mode})`);
    }
    console.log(`    ${this.colorize(GREEN, 'Input isolation:')} ${this.multiDesktop.hasXinput() ? this.colorize(GREEN, 'xinput available') : this.colorize(GRAY, 'none')}`);
    console.log(`    ${this.colorize(GREEN, 'AI workspace:')} ${aiWs === 'active' ? this.colorize(GREEN, 'active') : this.colorize(GRAY, 'not initialized')}`);
    console.log('');
  }

  private async startChat(): Promise<void> {
    console.log(this.colorize(CYAN, '  Chat mode. Type ') + this.colorize(YELLOW, '/exit') + this.colorize(CYAN, ' to return.'));
    console.log('');
    const chatRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.colorize(MAGENTA, '  you> '),
    });
    chatRl.prompt();
    chatRl.on('line', async (line) => {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.toLowerCase() === '/exit' || trimmed.toLowerCase() === '/quit') {
        chatRl.close();
        return;
      }
      const before = Date.now();
      const response = await this.llm.generate(trimmed);
      const ms = Date.now() - before;
      console.log(this.colorize(CYAN, `  ai> `) + response);
      console.log(this.colorize(GRAY, `       (${ms}ms)`));
      chatRl.prompt();
    });
    chatRl.on('close', () => {
      console.log(this.colorize(GRAY, '  Exiting chat mode.'));
      if (this.interactiveMode) {
        this.rl?.prompt();
      }
    });
  }

  private async handleGenerate(prompt: string): Promise<void> {
    const before = Date.now();
    const response = await this.llm.generate(prompt);
    const ms = Date.now() - before;
    console.log(this.colorize(CYAN, '  ai> ') + response);
    console.log(this.colorize(GRAY, `       (${ms}ms)`));
    console.log('');
  }

  private async handleTrace(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/);
    const neuronId = Number(parts[0]);
    const dim = Number(parts[1] ?? 0);
    if (!Number.isInteger(neuronId) || !Number.isInteger(dim)) {
      console.log(this.colorize(GRAY, '  Usage: trace <neuronId> <dim>   (Section 9 symbolic trace)'));
      return;
    }
    const trace = this.llm.traceNeuron(neuronId, dim);
    if (!trace) {
      console.log(this.colorize(RED, `  No neuron ${neuronId} / dim ${dim} to trace.`));
      return;
    }
    console.log('');
    console.log(this.colorize(BOLD, '  Symbolic trace:'));
    console.log(`    ${this.colorize(GREEN, trace.equation)}`);
    if (trace.inputClamped) {
      console.log(this.colorize(GRAY, '    (this neuron was input-clamped; the equation is the counterfactual it would settle to)'));
    }
    console.log('');
  }

  private async handleThink(prompt: string): Promise<void> {
    if (!prompt) { console.log(this.colorize(GRAY, '  Usage: think <prompt>')); return; }
    const before = Date.now();
    const out = await this.llm.thinkAbout(prompt);
    const ms = Date.now() - before;
    console.log('');
    console.log(this.colorize(BOLD, '  THORNS Analysis:'));
    console.log(`    Intent:      ${this.colorize(YELLOW, out.intent.intent)} (${(out.intent.confidence * 100).toFixed(1)}%)`);
    console.log(`    Keywords:    ${out.intent.keywords.join(', ')}`);
    console.log(`    Entities:    ${out.intent.entities.join(', ')}`);
    console.log(`    Cross-check: ${(out.crossCheck.overallConfidence * 100).toFixed(1)}% confidence`);
    console.log(`    Action plan: ${this.colorize(GREEN, out.actionPlan.join(' → '))}`);
    console.log(`    Best action: ${out.simulation.bestAction}`);
    console.log(`    Response:    ${this.colorize(GRAY, out.response)}`);
    console.log(this.colorize(GRAY, `    (${ms}ms)`));
    console.log('');
  }

  private handleTrain(text: string): void {
    if (!text) { console.log(this.colorize(GRAY, '  Usage: train <text>')); return; }
    this.llm.trainOnText(text);
    const stats = this.llm.getStats();
    console.log(this.colorize(GREEN, `  Trained on ${text.length} chars. Total samples: ${stats.samplesProcessed}`));
  }

  private handleSearch(query: string): void {
    if (!query) { console.log(this.colorize(GRAY, '  Usage: search <query>')); return; }
    const results = this.llm.searchNeurons(query);
    if (results.length === 0) {
      console.log(this.colorize(GRAY, `  No neurons matching "${query}"`));
      return;
    }
    console.log(this.colorize(BOLD, `  Found ${results.length} neuron(s) for "${query}":`));
    for (const n of results.slice(0, 10)) {
      console.log(`    ${this.colorize(CYAN, n.id)} ${this.colorize(GRAY, n.name)} value:${n.value.toFixed(4)}`);
    }
    console.log('');
  }

  // Section 22: unlike `search` (plain substring match), this semantically
  // scores every neuron against the query and generates a new neuron wired
  // to the best matches with similarity-weighted edges. LLM.netSearchGenerate()
  // was fully built (extension-builder/builder.js) but had no live caller.
  private handleNetSearchGenerate(query: string): void {
    if (!query) { console.log(this.colorize(GRAY, '  Usage: nsearch <query>')); return; }
    const result = this.llm.netSearchGenerate(query);
    if (!result) {
      console.log(this.colorize(GRAY, `  No semantic matches for "${query}" -- nothing generated`));
      return;
    }
    console.log(this.colorize(BOLD, `  Generated "${result.neuron.name}" from ${result.matches.length} match(es):`));
    for (const m of result.matches) {
      console.log(`    ${this.colorize(CYAN, m.name)} ${this.colorize(GRAY, `(score ${m.score.toFixed(3)})`)}`);
    }
    console.log('');
  }

  private handleNeuri(code: string): void {
    if (!code) { console.log(this.colorize(GRAY, '  Usage: neuri <NeuriLang code>')); return; }
    const interp = new NeuroLangInterpreter();
    const parsed = interp.parse(code);
    if (parsed.errors.length > 0) {
      console.log(this.colorize(RED, '  NeuriLang errors:'));
      for (const err of parsed.errors) console.log(`    ${err}`);
      return;
    }
    const neurons = interp.evaluate(parsed);
    console.log(this.colorize(GREEN, `  NeuriLang: ${neurons.size} neurons defined`));
    for (const [name, n] of neurons) {
      // Execute attached code first so value reflects computed result
      let codeResult: string | null = null;
      if (n.code) {
        // Security: Only allow safe characters (math, hex) to prevent RCE via NeuriLang @code
        if (/^[0-9a-fx+\-*/().\s]*$/i.test(n.code)) {
          try {
            const result = new Function(`"use strict"; return (${n.code})`)();
            if (typeof result === 'number' && isFinite(result)) {
              n.value = result;
              codeResult = String(result);
            } else if (result !== undefined) {
              codeResult = String(result).slice(0, 80);
            }
          } catch { /* code failed to eval — ignore */ }
        }
      }
      const tags: string[] = [];
      if (n.isNetSearch) tags.push(`netsearch:${n.netLocation}`);
      if (n.isCodeNet) tags.push('code-net');
      if (n.code) tags.push(`code:"${n.code.slice(0, 30)}"`);
      const conns = Array.from(n.connections.entries()).map(([t, w]) => `.${t}*${w.toFixed(2)}`).join(' ');
      console.log(`    ${this.colorize(CYAN, name)} value:${n.value} ${this.colorize(GRAY, n.definition || '')} ${tags.length > 0 ? this.colorize(YELLOW, '[' + tags.join(',') + ']') : ''}`);
      if (conns.length > 0 && neurons.size <= 4) {
        console.log(`      → ${this.colorize(GRAY, conns.slice(0, 100))}${conns.length > 100 ? '...' : ''}`);
      }
      if (codeResult !== null) {
        console.log(`      ${this.colorize(YELLOW, '↳')} code result: ${codeResult}`);
      }
      // Section 21: `@code=` also compiles a real behavioral Code-to-Net
      // (interp.getCodeNet()/testCodeNet()) alongside the plain value eval
      // above -- previously computed silently and never surfaced anywhere.
      const codeNet = interp.getCodeNet(name);
      if (codeNet) {
        const test = interp.testCodeNet(name);
        const modeInfo = codeNet.mode === 'function' ? `function(arity ${codeNet.arity})` : 'embedding';
        const testInfo = test ? `, self-test ${test.passed ? 'passed' : 'FAILED'} (meanAbsErr ${test.meanAbsError.toFixed(4)})` : '';
        console.log(`      ${this.colorize(YELLOW, '↳')} code-to-net: ${modeInfo}${testInfo}`);
      }
      // Section 22: search the current NeuroLang neuron mesh via the
      // interpreter's own NetSearchEngine -- previously this called
      // `this.llm.netSearch()`, an unrelated legacy project-file search
      // (extension-builder), contradicting NeuroLangInterpreter.netSearch()'s
      // own documented "self"/"mesh" = "the current neuron map" semantics.
      if (n.isNetSearch && n.netLocation) {
        const hits = interp.netSearch(n.netLocation);
        if (hits.length > 0) {
          console.log(`      ${this.colorize(YELLOW, '↳')} netsearch(${n.netLocation}): ${hits.slice(0, 3).map(h => `${h.name}(${h.score.toFixed(2)})`).join(', ')}`);
        } else {
          console.log(`      ${this.colorize(GRAY, '↳')} netsearch(${n.netLocation}): no results`);
        }
      }
    }
    if (parsed.printOutputs.length > 0) {
      console.log(this.colorize(BOLD, '  Output:'));
      for (const line of parsed.printOutputs) console.log(`    ${line}`);
    }
    console.log('');
  }

  private handleDict(word: string): void {
    if (!word) { console.log(this.colorize(GRAY, '  Usage: dict <word>')); return; }
    const def = this.thesaurus.getDefinition(word);
    const syns = this.thesaurus.getSynonyms(word);
    const examples = this.thesaurus.getExamples(word);
    if (!def && syns.length === 0) {
      console.log(this.colorize(GRAY, `  "${word}" not in dictionary`));
      return;
    }
    console.log('');
    console.log(this.colorize(BOLD, `  ${word}:`));
    if (def) console.log(`    ${this.colorize(YELLOW, 'Y')} (definition): ${def}`);
    if (syns.length > 0) console.log(`    ${this.colorize(GREEN, 'X')} (synonyms):   ${syns.join(', ')}`);
    if (examples.length > 0) console.log(`    ${this.colorize(CYAN, 'Z')} (examples):   ${examples.slice(0, 2).join(' | ')}`);
    console.log('');
  }

  private handleBuild(name: string): void {
    if (!name) { console.log(this.colorize(GRAY, '  Usage: build <extension-name>')); return; }
    const builder = this.llm.getBuilder();
    const proj = builder.createProject(name, `Extension: ${name}`);
    const n = builder.addNeuron(proj.id, `${name}_input`, 0, { x: 0, y: 0 });
    const o = builder.addNeuron(proj.id, `${name}_output`, 1, { x: 200, y: 0 });
    if (n && o) {
      builder.connectNeurons(proj.id, n.id, o.id, 0.5);
      builder.dragLabel(proj.id, n.id, 'input');
      builder.dragLabel(proj.id, o.id, 'output');
    }
    builder.trainNetSearch(proj.id, 10);
    console.log(this.colorize(GREEN, `  Extension "${name}" created (project id: ${proj.id})`));
    console.log(this.colorize(GRAY, '  Use save/quantize to persist it.'));
    console.log('');
  }

  private printPlugins(): void {
    const plugins = this.pluginRegistry.listPlugins();
    const skills = this.pluginRegistry.listSkills();
    console.log('');
    console.log(this.colorize(BOLD, `  Plugins (${plugins.length}):`));
    for (const p of plugins.slice(0, 15)) {
      console.log(`    ${this.colorize(GREEN, '•')} ${p.name} ${this.colorize(GRAY, `[${p.type}]`)}`);
    }
    if (plugins.length > 15) console.log(this.colorize(GRAY, `    ... and ${plugins.length - 15} more`));
    console.log('');
    console.log(this.colorize(BOLD, `  Language Skills (${skills.length}):`));
    const sample = skills.slice(0, 10).map(s => s.name).join(', ');
    console.log(`    ${this.colorize(GRAY, sample + (skills.length > 10 ? ` ... +${skills.length - 10} more` : ''))}`);
    console.log('');
  }

  private async handleSave(): Promise<void> {
    const saved = this.llm.save();
    if (saved) {
      const bytes = Buffer.byteLength(saved, 'utf8');
      console.log(this.colorize(GREEN, `  Model saved (${(bytes / 1024).toFixed(1)} KB, full precision)`));
    } else {
      console.log(this.colorize(RED, '  Save failed — model not built'));
    }
  }

  private async handleQuantize(): Promise<void> {
    console.log(this.colorize(GRAY, '  Quantizing...'));
    const quantized = await this.llm.quantize();
    if (quantized) {
      const bytes = Buffer.byteLength(quantized, 'utf8');
      console.log(this.colorize(GREEN, `  Model quantized (${(bytes / 1024).toFixed(1)} KB, 4-bit)`));
    } else {
      console.log(this.colorize(RED, '  Quantize failed — model not built'));
    }
  }
}
