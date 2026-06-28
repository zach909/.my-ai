import * as fs from "fs";
import * as path from "path";
import type { PluginDefinition, ExtensionManifest } from "./types";
import { BasePlugin } from "./sdk";

export class PluginLoader {
  async loadPluginFromPath(pluginPath: string): Promise<{
    definition: PluginDefinition;
    manifest: ExtensionManifest;
  } | null> {
    const manifestPath = path.join(pluginPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest: ExtensionManifest = JSON.parse(raw);
    if (!this.validateManifest(manifest)) {
      throw new Error(`Invalid manifest at ${manifestPath}`);
    }
    const definition: PluginDefinition = {
      id: manifest.id,
      name: manifest.name,
      type: "api-connection",
      capabilities: manifest.permissions,
    };
    return { definition, manifest };
  }

  async loadAll(directory: string): Promise<
    Array<{
      definition: PluginDefinition;
      manifest: ExtensionManifest;
    }>
  > {
    const plugins: Array<{
      definition: PluginDefinition;
      manifest: ExtensionManifest;
    }> = [];
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(directory, entry.name);
        const result = await this.loadPluginFromPath(pluginPath);
        if (result) {
          plugins.push(result);
        }
      }
    }
    return plugins;
  }

  instantiatePlugin(definition: PluginDefinition): BasePlugin {
    return new (class extends BasePlugin {
      constructor() {
        super(definition);
      }
    })();
  }

  async scanForPlugins(directory: string): Promise<string[]> {
    const pluginDirs: string[] = [];
    if (!fs.existsSync(directory)) {
      return pluginDirs;
    }
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.join(directory, entry.name, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          pluginDirs.push(path.join(directory, entry.name));
        }
      }
    }
    return pluginDirs;
  }

  validateManifest(manifest: ExtensionManifest): boolean {
    if (!manifest.id || typeof manifest.id !== "string") return false;
    if (!manifest.name || typeof manifest.name !== "string") return false;
    if (!manifest.version || typeof manifest.version !== "string") return false;
    if (!manifest.description || typeof manifest.description !== "string")
      return false;
    if (!Array.isArray(manifest.permissions)) return false;
    if (!manifest.author || typeof manifest.author !== "string") return false;
    if (!manifest.entrypoint || typeof manifest.entrypoint !== "string")
      return false;
    return true;
  }
}
