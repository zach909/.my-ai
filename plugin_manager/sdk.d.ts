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
export declare abstract class BasePlugin implements PluginLifecycle {
    protected definition: PluginDefinition;
    protected active: boolean;
    protected context: PluginContext | null;
    constructor(definition: PluginDefinition);
    getDefinition(): PluginDefinition;
    isActive(): boolean;
    onActivate(context: PluginContext): Promise<void>;
    onDeactivate(): Promise<void>;
    onMessage(message: unknown): Promise<unknown>;
    onHealthCheck(): Promise<boolean>;
}
export declare abstract class APIPlugin extends BasePlugin {
    protected serviceUrl: string;
    protected apiKey: string;
    constructor(definition: PluginDefinition);
    abstract callEndpoint(endpoint: string, method: string, body?: unknown, headers?: Record<string, string>): Promise<unknown>;
    fetchFromService(path: string, options?: RequestInit): Promise<Response>;
}
export declare abstract class SkillPlugin extends BasePlugin {
    protected skillDefinition: SkillDefinition;
    constructor(definition: PluginDefinition, skillDefinition: SkillDefinition);
    getSkillDefinition(): SkillDefinition;
    abstract execute(input: unknown): Promise<unknown>;
    abstract getExpertWeights(): number[];
}
