import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NeuroclawLLM } from "./models && skills/llm.js";
import { NeuroPipeline } from "./models && skills/core/pipeline.js";
import { ThesaurusDictionary } from "./models && skills/thesaurus.js";
import { PluginRegistry } from "./plugin_manager/registry.js";
import { NeuroclawRunner } from "./interface/runner.js";
import { WebServer } from "./interface/web-server.js";
import { CLI } from "./interface/cli.js";
import { AlignmentVeto } from "./models && skills/core/alignment-veto.js";
import { ZipIOSystem } from "./models && skills/core/zip-io.js";
import { EmpathyEngine } from "./models && skills/core/empathy.js";

// Plugins
import { AccountInfoPlugin } from "./plugins/account-info.js";
import { AppDiagnosticsPlugin } from "./plugins/app-diagnostics.js";
import { BrowserPlugin } from "./plugins/browser.js";
import { CalendarPlugin } from "./plugins/calendar.js";
import { CallHistoryPlugin } from "./plugins/call-history.js";
import { CameraPlugin } from "./plugins/camera.js";
import { ContactsPlugin } from "./plugins/contacts.js";
import { EmailPlugin } from "./plugins/email.js";
import { FileSystemPlugin } from "./plugins/file-system.js";
import { PhoneCallsPlugin } from "./plugins/phone-calls.js";
import { ImageExtension, UniversalLanguageSkill } from "./plugins/extensions/index.js";
import { pluginExtensions } from "./plugins/index.js";

/**
 * Neuroclaw System - Complete AI with neural networks, extensions, and safety
 *
 * Core subsystems:
 * - NeuroPipeline: orchestrates all computation
 * - AlignmentVeto: safety layer ensuring actions are user-aligned
 * - ZipIOSystem: circular buffer for extended context
 * - EmpathyEngine: tracks user emotion and alignment
 * - PluginRegistry: manages all plugins and skills
 */
export class NeuroclawSystem {
  llm: NeuroclawLLM;
  pipeline: NeuroPipeline;
  thesaurus: ThesaurusDictionary;
  pluginRegistry: PluginRegistry;
  veto: AlignmentVeto;
  zipIO: ZipIOSystem;
  empathy: EmpathyEngine;
  runner: NeuroclawRunner;

  private initialized = false;
  private contextCapacityGB: number;

  constructor(config?: { maxContextGB?: number }) {
    this.llm = new NeuroclawLLM({});
    this.pipeline = new NeuroPipeline({});
    this.thesaurus = new ThesaurusDictionary();
    this.pluginRegistry = new PluginRegistry();
    this.veto = new AlignmentVeto();
    this.contextCapacityGB = config?.maxContextGB || 200000;
    this.zipIO = new ZipIOSystem(this.contextCapacityGB);
    this.empathy = new EmpathyEngine();
    this.runner = new NeuroclawRunner(this.llm, this.pipeline, this.thesaurus, this.pluginRegistry);
  }

  /**
   * Initialize all subsystems
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log("Initializing Neuroclaw core subsystems...");
    await this.pluginRegistry.bootstrap();

    // Register real plugin implementations
    this.pluginRegistry.register(pluginExtensions["account-info"], new AccountInfoPlugin(pluginExtensions["account-info"]));
    this.pluginRegistry.register(pluginExtensions["app-diagnostics"], new AppDiagnosticsPlugin(pluginExtensions["app-diagnostics"]));
    this.pluginRegistry.register(pluginExtensions["browser"], new BrowserPlugin(pluginExtensions["browser"]));
    this.pluginRegistry.register(pluginExtensions["calendar"], new CalendarPlugin(pluginExtensions["calendar"]));
    this.pluginRegistry.register(pluginExtensions["call-history"], new CallHistoryPlugin(pluginExtensions["call-history"]));
    this.pluginRegistry.register(pluginExtensions["camera"], new CameraPlugin(pluginExtensions["camera"]));
    this.pluginRegistry.register(pluginExtensions["contacts"], new ContactsPlugin(pluginExtensions["contacts"]));
    this.pluginRegistry.register(pluginExtensions["email"], new EmailPlugin(pluginExtensions["email"]));
    this.pluginRegistry.register(pluginExtensions["file-system"], new FileSystemPlugin(pluginExtensions["file-system"]));
    this.pluginRegistry.register(pluginExtensions["phone-calls"], new PhoneCallsPlugin(pluginExtensions["phone-calls"]));
    this.pluginRegistry.register(pluginExtensions["image"], new ImageExtension(pluginExtensions["image"]));
    this.pluginRegistry.register(pluginExtensions["universal-language-skill"], new UniversalLanguageSkill(pluginExtensions["universal-language-skill"]));

    // Wire dependencies
    const callHistoryInstance = (this.pluginRegistry as any).plugins.get("call-history") as CallHistoryPlugin;
    const phoneCallsInstance = (this.pluginRegistry as any).plugins.get("phone-calls") as PhoneCallsPlugin;
    if (callHistoryInstance && phoneCallsInstance) {
      callHistoryInstance.setSource(phoneCallsInstance);
    }

    // Activate all plugins
    console.log("Activating registered extensions & MoE experts...");
    for (const id of Object.keys(pluginExtensions)) {
      try {
        await this.pluginRegistry.activate(id);
      } catch (e) {
        console.warn(`Failed to activate plugin "${id}":`, e);
      }
    }

    this.initialized = true;
    console.log("Neuroclaw subsystems initialized successfully");
  }

  /**
   * Process a user query through the complete pipeline
   */
  async processQuery(input: string): Promise<string> {
    if (!this.initialized) await this.initialize();

    // 1. Read the user's emotional state / intent so downstream decisions
    //    stay aligned (Empathy).
    this.empathy.updateUserContext(input);
    const emotion = this.empathy.analyzeEmotion(input);

    // 2. Store the (compressed) input in the circular ZIP-IO context buffer.
    await this.zipIO.ingest(input);

    // 3. Gate the "respond" action through the AlignmentVeto before running.
    //    A negative-valence user under high arousal lowers our confidence,
    //    surfacing as self-model surprise the veto can escalate on.
    const decision = this.veto.evaluate(
      { id: `respond:${Date.now()}`, name: "respond to user", capabilities: ["text-generate"], reversible: true },
      { selfModelSurprise: emotion.valence < 0 ? emotion.arousal * 0.5 : 0 }
    );
    if (!decision.allowed) {
      const blocked = `[Withheld] ${decision.reasons.join("; ")}`;
      await this.zipIO.emit(blocked);
      return blocked;
    }

    // 4. Run the query through the real neural runner (THORNS intent →
    //    plugin/skill dispatch → mesh + hyperdimensional + MoE generation).
    try {
      let result = await this.runner.generate(input);
      if (decision.requiresConfirmation) {
        result = `${result}\n  [Confirm before acting: ${decision.reasons.join("; ")}]`;
      }

      // 5. Store the (compressed) output in the ZIP-IO output loop and keep
      //    the empathy model's alignment score current.
      await this.zipIO.emit(result);
      return result;
    } catch (error) {
      console.error("Error processing query:", error);
      throw error;
    }
  }

  /**
   * Get system status
   */
  getStatus(): {
    initialized: boolean;
    activePlugins: number;
    contextCapacity: string;
    alignment: number;
  } {
    return {
      initialized: this.initialized,
      activePlugins: this.pluginRegistry.listActivePlugins().length,
      contextCapacity: `${this.contextCapacityGB}GB available`,
      alignment: this.empathy.getAlignmentScore(),
    };
  }
}

// Singleton instance for module-level access
let system: NeuroclawSystem | null = null;

/**
 * Get or create the Neuroclaw system singleton
 */
export async function getNeuroclawSystem(): Promise<NeuroclawSystem> {
  if (!system) {
    system = new NeuroclawSystem();
    await system.initialize();
  }
  return system;
}

/**
 * Main entry point
 */
async function main() {
  const system = await getNeuroclawSystem();

  const mode = process.argv[2];
  if (mode === "web") {
    const port = parseInt(process.argv[3] || "3000", 10);
    console.log(`Starting TS backend web server on port ${port}...`);
    const webServer = new WebServer(system.runner);
    await webServer.start(port);
    console.log(`Neuroclaw TS backend online at http://localhost:${port}`);
  } else if (mode === "cli") {
    console.log("Launching interactive Neuroclaw command-line interface...");
    const cli = new CLI(system.llm, system.pipeline, system.thesaurus, system.pluginRegistry);
    await cli.startInteractive();
  } else {
    // Default mode: start on port 3000
    const port = 3000;
    console.log(`No mode specified. Starting default web server on port ${port}...`);
    const webServer = new WebServer(system.runner);
    await webServer.start(port);
    console.log(`Neuroclaw operational at http://localhost:${port}`);
  }
}

/** True when this module is the process entry point (not merely imported). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main().catch((err) => {
  console.error("Fatal startup error in Neuroclaw launcher:", err);
  process.exit(1);
});
