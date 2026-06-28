import type { PluginDefinition, SkillDefinition } from "./types";

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
