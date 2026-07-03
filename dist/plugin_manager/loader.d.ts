import type { PluginDefinition, ExtensionManifest } from "./types.js";
import { BasePlugin } from "./sdk.js";
export declare class PluginLoader {
    loadPluginFromPath(pluginPath: string): Promise<{
        definition: PluginDefinition;
        manifest: ExtensionManifest;
    } | null>;
    loadAll(directory: string): Promise<Array<{
        definition: PluginDefinition;
        manifest: ExtensionManifest;
    }>>;
    instantiatePlugin(definition: PluginDefinition): BasePlugin;
    scanForPlugins(directory: string): Promise<string[]>;
    validateManifest(manifest: ExtensionManifest): boolean;
}
