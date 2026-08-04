import type { BasePlugin } from "../plugin_manager/sdk.js";

export interface PluginMetadata {
    id: string;
    name: string;
    type: 'api-connection' | 'skill-expert';
    capabilities: string[];
    enabled: boolean;
    config: Record<string, any>;
}
export interface PluginInstance {
    metadata: PluginMetadata;
    real: BasePlugin | null;
    initialized: boolean;
    error?: string;
    lastUsed: number;
}
export interface PluginManagerConfig {
    pluginsDirectory: string;
    autoLoad: boolean;
    maxPlugins: number;
    sandbox: boolean;
}
export declare class PluginManager {
    private config;
    private plugins;
    private pluginHooks;
    constructor(config?: Partial<PluginManagerConfig>);
    private ensureDirectory;
    private initializeCorePlugins;
    private createContext;
    private resolveMethod;
    registerPlugin(metadata: PluginMetadata): boolean;
    unregisterPlugin(pluginId: string): boolean;
    enablePlugin(pluginId: string): boolean;
    disablePlugin(pluginId: string): boolean;
    initializePlugin(pluginId: string): Promise<boolean>;
    getPlugin(pluginId: string): PluginInstance | undefined;
    listPlugins(type?: 'api-connection' | 'skill-expert'): PluginMetadata[];
    getEnabledPlugins(): PluginMetadata[];
    getInitializedPlugins(): PluginMetadata[];
    loadPlugins(): void;
    savePlugin(pluginId: string): boolean;
    saveAllPlugins(): void;
    updatePluginConfig(pluginId: string, config: Record<string, any>): boolean;
    registerHook(hookName: string, callback: (data: any) => any): void;
    unregisterHook(hookName: string, callback: (data: any) => any): void;
    executeHook(hookName: string, data: any): Promise<any[]>;
    executePlugin(pluginId: string, action: string, data?: any): Promise<any>;
    getPluginStats(): {
        total: number;
        enabled: number;
        initialized: number;
        byType: Record<string, number>;
    };
    searchPlugins(query: string): PluginMetadata[];
    getConfig(): PluginManagerConfig;
    updateConfig(config: Partial<PluginManagerConfig>): void;
    autoUpdatePlugins(): Promise<Array<{ pluginId: string; type: string }>>;
    shutdown(): Promise<void>;
}
