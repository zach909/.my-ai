import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export class parisIsInFrancePlugin extends BasePlugin {
  constructor(definition: PluginDefinition) { super(definition); }

  async onMessage(message: unknown): Promise<unknown> {
    const input = String(message ?? '').trim();
    return { type: 'paris-is-in-france', input, processed: true, timestamp: Date.now() };
  }

  async onHealthCheck(): Promise<boolean> { return true; }
}

export const pluginDefinition: PluginDefinition = {
  id: "paris-is-in-france",
  name: "Paris is in France.",
  type: "api-connection",
  capabilities: ["custom"],
};
