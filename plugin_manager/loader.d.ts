import type { PluginDefinition, ExtensionManifest } from "./types";
import { BasePlugin } from "./sdk";
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
