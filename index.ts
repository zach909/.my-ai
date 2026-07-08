import { NeuroclawLLM } from "./models && skills/llm.js";
import { NeuroPipeline } from "./models && skills/core/pipeline.js";
import { ThesaurusDictionary } from "./models && skills/thesaurus.js";
import { PluginRegistry } from "./plugin_manager/registry.js";
import { NeuroclawRunner } from "./interface/runner.js";
import { WebServer } from "./interface/web-server.js";
import { CLI } from "./interface/cli.js";

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

async function main() {
  console.log("Initializing Neuroclaw core subsystems...");
  const llm = new NeuroclawLLM({});
  const pipeline = new NeuroPipeline({});
  const thesaurus = new ThesaurusDictionary();
  const pluginRegistry = new PluginRegistry();

  await pluginRegistry.bootstrap();

  // Register real plugin implementations
  pluginRegistry.register(pluginExtensions["account-info"], new AccountInfoPlugin(pluginExtensions["account-info"]));
  pluginRegistry.register(pluginExtensions["app-diagnostics"], new AppDiagnosticsPlugin(pluginExtensions["app-diagnostics"]));
  pluginRegistry.register(pluginExtensions["browser"], new BrowserPlugin(pluginExtensions["browser"]));
  pluginRegistry.register(pluginExtensions["calendar"], new CalendarPlugin(pluginExtensions["calendar"]));
  pluginRegistry.register(pluginExtensions["call-history"], new CallHistoryPlugin(pluginExtensions["call-history"]));
  pluginRegistry.register(pluginExtensions["camera"], new CameraPlugin(pluginExtensions["camera"]));
  pluginRegistry.register(pluginExtensions["contacts"], new ContactsPlugin(pluginExtensions["contacts"]));
  pluginRegistry.register(pluginExtensions["email"], new EmailPlugin(pluginExtensions["email"]));
  pluginRegistry.register(pluginExtensions["file-system"], new FileSystemPlugin(pluginExtensions["file-system"]));
  pluginRegistry.register(pluginExtensions["phone-calls"], new PhoneCallsPlugin(pluginExtensions["phone-calls"]));
  pluginRegistry.register(pluginExtensions["image-extension"], new ImageExtension(pluginExtensions["image-extension"]));
  pluginRegistry.register(pluginExtensions["universal-language"], new UniversalLanguageSkill(pluginExtensions["universal-language"]));

  // Wire dependencies
  const callHistoryInstance = (pluginRegistry as any).plugins.get("call-history") as CallHistoryPlugin;
  const phoneCallsInstance = (pluginRegistry as any).plugins.get("phone-calls") as PhoneCallsPlugin;
  if (callHistoryInstance && phoneCallsInstance) {
    callHistoryInstance.setSource(phoneCallsInstance);
  }

  // Activate all plugins
  console.log("Activating registered extensions & MoE experts...");
  for (const id of Object.keys(pluginExtensions)) {
    try {
      await pluginRegistry.activate(id);
    } catch (e) {
      console.warn(`Failed to activate plugin "${id}":`, e);
    }
  }

  const runner = new NeuroclawRunner(llm, pipeline, thesaurus, pluginRegistry);

  const mode = process.argv[2];
  if (mode === "web") {
    const port = parseInt(process.argv[3] || "3000", 10);
    console.log(`Starting TS backend web server on port ${port}...`);
    const webServer = new WebServer(runner);
    await webServer.start(port);
    console.log(`Neuroclaw TS backend online at http://localhost:${port}`);
  } else if (mode === "cli") {
    console.log("Launching interactive Neuroclaw command-line interface...");
    const cli = new CLI(llm, pipeline, thesaurus, pluginRegistry);
    await cli.startInteractive();
  } else {
    // Default mode: start on port 3000
    const port = 3000;
    console.log(`No mode specified. Starting default web server on port ${port}...`);
    const webServer = new WebServer(runner);
    await webServer.start(port);
    console.log(`Neuroclaw operational at http://localhost:${port}`);
  }
}

main().catch((err) => {
  console.error("Fatal startup error in Neuroclaw launcher:", err);
  process.exit(1);
});
