import type { PluginDefinition } from "../plugin_manager/types.js";
import { ToolPlugin, type PluginTool } from "../plugin_manager/sdk.js";
import {
  LINUX_PERMISSION_TOOLS,
  type LinuxToolCallContext,
} from "./linux-permission-tools.js";

/**
 * Exposes each Linux permission capability as its own named tool neuron.
 * The host must inject a real permission checker, approval UI, and native
 * adapters before any tool can perform an operation. Without that wiring,
 * calls fail closed instead of pretending to have OS access.
 */
export class LinuxPermissionToolsPlugin extends ToolPlugin {
  private toolContext: LinuxToolCallContext | null = null;

  constructor(definition: PluginDefinition) {
    super(definition);
    for (const descriptor of LINUX_PERMISSION_TOOLS) {
      const required = descriptor.inputSchema.required;
      const tool: PluginTool = {
        name: descriptor.name,
        description: descriptor.description,
        args: required,
        optionalArgs: Object.keys(descriptor.inputSchema.properties).filter((key) => !required.includes(key)),
        capability: descriptor.permission,
        run: async (args) => {
          if (!this.toolContext) {
            throw new Error("Linux permission tool host is not configured. No operation was performed.");
          }
          return descriptor.execute(args, this.toolContext, this.getPluginId());
        },
      };
      this.defineTool(tool);
    }
  }

  /** Inject the host's real permission store, human approval flow, and native adapters. */
  configure(context: LinuxToolCallContext): void {
    this.toolContext = context;
  }

  async onMessage(message: unknown): Promise<unknown> {
    const input = String(message).trim();
    if (/^(?:list|show) linux permission tools$/i.test(input)) {
      return {
        plugin: "linux-permission-tools",
        count: this.getTools().length,
        tools: this.getTools().map(({ name, description, capability, args }) => ({ name, description, permission: capability, requiredArgs: args })),
        note: "Tools are registered individually. Each call requires a permission grant, and high-impact calls require per-call human approval.",
      };
    }
    const match = input.match(/^describe linux tool ([a-z0-9_]+)$/i);
    if (match) {
      const tool = this.getTool(match[1]);
      return tool ? { name: tool.name, description: tool.description, capability: tool.capability, requiredArgs: tool.args, optionalArgs: tool.optionalArgs ?? [] } : null;
    }
    return null;
  }
}
