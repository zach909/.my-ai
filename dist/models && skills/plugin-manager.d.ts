export interface PluginMetadata {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    category: 'input' | 'output' | 'processing' | 'storage' | 'network' | 'system';
    enabled: boolean;
    permissions: string[];
    dependencies: string[];
    config: Record<string, any>;
}
export interface PluginInstance {
    metadata: PluginMetadata;
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
    registerPlugin(metadata: PluginMetadata): boolean;
    unregisterPlugin(pluginId: string): boolean;
    enablePlugin(pluginId: string): boolean;
    disablePlugin(pluginId: string): boolean;
    initializePlugin(pluginId: string): boolean;
    getPlugin(pluginId: string): PluginInstance | undefined;
    listPlugins(category?: string): PluginMetadata[];
    getEnabledPlugins(): PluginMetadata[];
    getInitializedPlugins(): PluginMetadata[];
    loadPlugins(): void;
    savePlugin(pluginId: string): boolean;
    saveAllPlugins(): void;
    updatePluginConfig(pluginId: string, config: Record<string, any>): boolean;
    registerHook(hookName: string, callback: (data: any) => any): void;
    unregisterHook(hookName: string, callback: (data: any) => any): void;
    executeHook(hookName: string, data: any): Promise<any[]>;
    executePlugin(pluginId: string, action: string, data: any): any;
    private executeInputPlugin;
    private executeOutputPlugin;
    private executeProcessingPlugin;
    private executeStoragePlugin;
    private executeNetworkPlugin;
    private executeSystemPlugin;
    getPluginStats(): {
        total: number;
        enabled: number;
        initialized: number;
        byCategory: Record<string, number>;
    };
    searchPlugins(query: string): PluginMetadata[];
    getConfig(): PluginManagerConfig;
    updateConfig(config: Partial<PluginManagerConfig>): void;
    shutdown(): void;
}
