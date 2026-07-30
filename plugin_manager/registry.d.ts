import type { PluginDefinition, SkillDefinition } from "./types";
import type { BasePlugin, PluginContext } from "./sdk";
export declare class PluginRegistry {
    private plugins;
    private definitions;
    private skills;
    private skillPluginMap;
    private activePlugins;
    private intentMap;
    register(definition: PluginDefinition, instance: BasePlugin): void;
    activate(pluginId: string): Promise<void>;
    deactivate(pluginId: string): Promise<void>;
    registerSkill(skill: SkillDefinition, pluginId: string): void;
    unregisterSkill(skillId: string): void;
    listPlugins(): PluginDefinition[];
    listActivePlugins(): PluginDefinition[];
    listSkills(): SkillDefinition[];
    listActiveSkills(): SkillDefinition[];
    getPlugin(pluginId: string): PluginDefinition | undefined;
    getPluginInstance(pluginId: string): BasePlugin | undefined;
    getSkill(skillId: string): SkillDefinition | undefined;
    getPluginCount(): number;
    getSkillCount(): number;
    bootstrap(): Promise<void>;
    setIntentMap(map: Record<string, string[]>): void;
    dispatch(input: string, intent: string): Promise<string | null>;
    healthCheck(): Promise<Map<string, boolean>>;
    createContext(pluginId: string): PluginContext;
}
