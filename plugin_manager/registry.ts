import type { PluginDefinition, SkillDefinition } from "./types.js";
import type { BasePlugin, PluginContext, PluginLogger } from "./sdk.js";
import { PLUGIN_LIST, LANGUAGE_SKILLS } from "./registry-data.js";

export class PluginRegistry {
  private plugins: Map<string, BasePlugin> = new Map();
  private definitions: Map<string, PluginDefinition> = new Map();
  private skills: Map<string, SkillDefinition> = new Map();
  private skillPluginMap: Map<string, string> = new Map();
  private activePlugins: Set<string> = new Set();
  private intentMap: Record<string, string[]> = {};

  register(definition: PluginDefinition, instance: BasePlugin): void {
    this.definitions.set(definition.id, definition);
    this.plugins.set(definition.id, instance);
  }

  async activate(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    const context = this.createContext(pluginId);
    await plugin.onActivate(context);
    this.activePlugins.add(pluginId);
  }

  async deactivate(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    await plugin.onDeactivate();
    this.activePlugins.delete(pluginId);
  }

  registerSkill(skill: SkillDefinition, pluginId: string): void {
    this.skills.set(skill.id, skill);
    this.skillPluginMap.set(skill.id, pluginId);
  }

  unregisterSkill(skillId: string): void {
    this.skills.delete(skillId);
    this.skillPluginMap.delete(skillId);
  }

  listPlugins(): PluginDefinition[] {
    return Array.from(this.definitions.values());
  }

  listActivePlugins(): PluginDefinition[] {
    return Array.from(this.activePlugins).map(
      (id) => this.definitions.get(id)!,
    );
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  listActiveSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter((skill) =>
      this.activePlugins.has(this.skillPluginMap.get(skill.id) ?? ""),
    );
  }

  getPlugin(pluginId: string): PluginDefinition | undefined {
    return this.definitions.get(pluginId);
  }

  getPluginInstance(pluginId: string): BasePlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getSkill(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  getPluginCount(): number {
    return this.definitions.size;
  }

  getSkillCount(): number {
    return this.skills.size;
  }

  async bootstrap(): Promise<void> {
    for (const pluginName of PLUGIN_LIST) {
      const definition: PluginDefinition = {
        id: pluginName.toLowerCase().replace(/\s+/g, "-"),
        name: pluginName,
        type: "api-connection",
        capabilities: [],
      };
      this.definitions.set(definition.id, definition);
    }
    for (const lang of LANGUAGE_SKILLS) {
      const skill: SkillDefinition = {
        id: lang.toLowerCase().replace(/\s+/g, "-"),
        name: lang,
        description: `Skill for ${lang}`,
        expertIndex: 0,
        specialization: lang,
        selfAuthored: true,
      };
      this.skills.set(skill.id, skill);
    }
  }

  setIntentMap(map: Record<string, string[]>): void {
    this.intentMap = map;
  }

  // Route an input to the most relevant active plugin based on intent keyword
  async dispatch(input: string, intent: string): Promise<string | null> {
    const intentToPlugins: Record<string, string[]> = {
      ...{
        command: ['self-heal', 'terminal', 'file-system'],
        creation: ['skill-maker', 'plugin-maker', 'file-system', 'browser'],
        // skill-maker always succeeds (even on empty input, it returns a
        // usage message rather than null), so the generic "creation" bucket
        // above can never actually reach plugin-maker regardless of caller
        // intent -- a real request for an *extension* would silently get a
        // skill instead. These give a caller that already knows which one it
        // wants a way to actually reach it.
        "skill-creation": ['skill-maker', 'file-system', 'browser'],
        "extension-creation": ['plugin-maker', 'file-system', 'browser'],
        exploration: ['browser', 'file-system'],
        analysis: ['file-system', 'browser'],
        query: ['browser'],
        desktop: ['multi-input'],
        input: ['multi-input'],
        workspace: ['multi-input'],
        terminal: ['terminal'],
      },
      ...this.intentMap,
    };
    // Unmapped intents (plain conversation) get no plugin candidates — the
    // runner falls through to full neural generation instead of a web search.
    const candidates = intentToPlugins[intent] ?? [];
    for (const pluginId of candidates) {
      const plugin = this.plugins.get(pluginId);
      if (plugin && this.activePlugins.has(pluginId)) {
        try {
          const result = await plugin.onMessage?.(input);
          if (result != null) return typeof result === "string" ? result : JSON.stringify(result);
        } catch { /* plugin failed, try next */ }
      }
    }
    return null;
  }

  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const pluginId of this.activePlugins) {
      const plugin = this.plugins.get(pluginId);
      if (plugin && plugin.onHealthCheck) {
        try {
          const ok = await plugin.onHealthCheck();
          results.set(pluginId, ok);
        } catch {
          results.set(pluginId, false);
        }
      }
    }
    return results;
  }

  createContext(pluginId: string): PluginContext {
    const logger: PluginLogger = {
      info: (message: string, ...args: unknown[]) => {
        console.log(`[${pluginId}] INFO: ${message}`, ...args);
      },
      warn: (message: string, ...args: unknown[]) => {
        console.warn(`[${pluginId}] WARN: ${message}`, ...args);
      },
      error: (message: string, ...args: unknown[]) => {
        console.error(`[${pluginId}] ERROR: ${message}`, ...args);
      },
      debug: (message: string, ...args: unknown[]) => {
        console.debug(`[${pluginId}] DEBUG: ${message}`, ...args);
      },
    };
    return {
      pluginId,
      dataDir: `./data/${pluginId}`,
      config: {},
      logger,
    };
  }
}
