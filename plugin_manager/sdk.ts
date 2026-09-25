import type { PluginDefinition, SkillDefinition } from "./types.js";

export type PluginLogger = {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
};

export type PluginContext = {
  pluginId: string;
  dataDir: string;
  config: Record<string, unknown>;
  logger: PluginLogger;
};

export interface PluginLifecycle {
  onActivate(context: PluginContext): Promise<void>;
  onDeactivate(): Promise<void>;
  onMessage?(message: unknown): Promise<unknown>;
  onHealthCheck?(): Promise<boolean>;
}

export abstract class BasePlugin implements PluginLifecycle {
  protected definition: PluginDefinition;
  protected active: boolean = false;
  protected context: PluginContext | null = null;

  constructor(definition: PluginDefinition) {
    this.definition = definition;
  }

  getDefinition(): PluginDefinition {
    return this.definition;
  }

  isActive(): boolean {
    return this.active;
  }

  async onActivate(context: PluginContext): Promise<void> {
    this.context = context;
    this.active = true;
    context.logger.info(`Plugin ${this.definition.name} activated`);
  }

  async onDeactivate(): Promise<void> {
    this.active = false;
    this.context = null;
  }

  async onMessage(message: unknown): Promise<unknown> {
    return message;
  }

  async onHealthCheck(): Promise<boolean> {
    return this.active;
  }
}

/** Who asked for a tool call: the network firing its neuron, a chat message, or code. */
export type ToolOrigin = "network" | "message" | "direct";

/**
 * One thing a plugin can do, by name.
 *
 * A tool is the unit the network calls. Each one becomes its own output
 * neuron (see models && skills/core/tool-neurons.ts), so it has to be a single,
 * nameable action -- "write a file", "list windows" -- not a free-form
 * message handler that decides what it is being asked from the text.
 */
export interface PluginTool {
  name: string;
  description: string;
  /** Arguments the tool cannot run without. A call missing one fails before it starts. */
  args: string[];
  optionalArgs?: string[];
  /**
   * The access capability (models && skills/core/access-manager.ts) this tool
   * exercises. Declared so a caller that must respect the Access page -- the
   * network firing a tool on its own -- can check it before running anything.
   */
  capability?: string;
  run(args: Record<string, unknown>): Promise<unknown>;
}

/** What one tool call did. A failed call is still an event: the error is the result. */
export interface ToolCallEvent {
  plugin: string;
  tool: string;
  args: Record<string, unknown>;
  origin: ToolOrigin;
  ok: boolean;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt: number;
}

/**
 * A plugin whose abilities are a fixed set of named tools.
 *
 * Every call goes through callTool(), whoever makes it, so anything watching
 * (the tool neuron layer) sees every call exactly once -- including ones that
 * arrived as a chat message rather than as a neuron firing. callTool() never
 * throws: a tool that fails produces an event whose error is the outcome,
 * because a failure the network is never told about is one it cannot learn
 * from.
 */
export abstract class ToolPlugin extends BasePlugin {
  private readonly tools = new Map<string, PluginTool>();
  private readonly toolObservers = new Set<(event: ToolCallEvent) => void>();

  protected defineTool(tool: PluginTool): void {
    this.tools.set(tool.name, tool);
  }

  /** The id tools are filed under. Falls back to the name for definitions built without an id. */
  getPluginId(): string {
    return this.definition.id ?? this.definition.name;
  }

  getTools(): PluginTool[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): PluginTool | undefined {
    return this.tools.get(name);
  }

  /** Be told about every call. Returns the function that stops it. */
  onToolCall(observer: (event: ToolCallEvent) => void): () => void {
    this.toolObservers.add(observer);
    return () => this.toolObservers.delete(observer);
  }

  async callTool(name: string, args: Record<string, unknown> = {}, origin: ToolOrigin = "direct"): Promise<ToolCallEvent> {
    const startedAt = Date.now();
    const event: ToolCallEvent = { plugin: this.getPluginId(), tool: name, args, origin, ok: false, startedAt, endedAt: startedAt };
    const tool = this.tools.get(name);
    if (!tool) {
      event.error = `${this.getPluginId()} has no tool called "${name}". It has: ${[...this.tools.keys()].join(", ")}.`;
    } else {
      const missing = tool.args.filter(arg => args[arg] === undefined || args[arg] === null);
      if (missing.length > 0) {
        event.error = `${name} needs ${missing.join(", ")}.`;
      } else {
        try {
          event.result = await tool.run(args);
          event.ok = true;
        } catch (err) {
          event.error = err instanceof Error ? err.message : String(err);
        }
      }
    }
    event.endedAt = Date.now();
    for (const observer of this.toolObservers) {
      try {
        observer(event);
      } catch {
        // An observer that breaks must not turn a finished call into a failed one.
      }
    }
    return event;
  }
}

export abstract class APIPlugin extends BasePlugin {
  protected serviceUrl: string;
  protected apiKey: string;

  constructor(definition: PluginDefinition) {
    super(definition);
    if (!definition.serviceUrl) {
      throw new Error("serviceUrl is required for APIPlugin");
    }
    if (!definition.apiKey) {
      throw new Error("apiKey is required for APIPlugin");
    }
    this.serviceUrl = definition.serviceUrl;
    this.apiKey = definition.apiKey;
  }

  abstract callEndpoint(
    endpoint: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<unknown>;

  async fetchFromService(
    path: string,
    options?: RequestInit,
  ): Promise<Response> {
    const url = `${this.serviceUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...((options?.headers as Record<string, string>) || {}),
    };
    return fetch(url, { ...options, headers });
  }
}

export abstract class SkillPlugin extends BasePlugin {
  protected skillDefinition: SkillDefinition;

  constructor(definition: PluginDefinition, skillDefinition: SkillDefinition) {
    super(definition);
    this.skillDefinition = skillDefinition;
  }

  getSkillDefinition(): SkillDefinition {
    return this.skillDefinition;
  }

  abstract execute(input: unknown): Promise<unknown>;

  abstract getExpertWeights(): number[];
}
