import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export class catsAreMammalsPlugin extends BasePlugin {
  constructor(definition: PluginDefinition) { super(definition); }

  async onMessage(message: unknown): Promise<unknown> {
    const input = String(message ?? '').trim();
    return { type: 'cats-are-mammals', input, processed: true, timestamp: Date.now() };
  }

  async onHealthCheck(): Promise<boolean> { return true; }
}

export const pluginDefinition: PluginDefinition = {
  id: "cats-are-mammals",
  name: "Cats are mammals.",
  type: "api-connection",
  capabilities: ["custom"],
};
