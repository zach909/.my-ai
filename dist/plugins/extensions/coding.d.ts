import type { PluginDefinition, SkillDefinition } from "../../plugin_manager/types.js";
import { SkillPlugin } from "../../plugin_manager/sdk.js";
export declare class CodingExtension extends SkillPlugin {
    constructor(definition: PluginDefinition, skillDefinition: SkillDefinition);
    execute(input: unknown): Promise<unknown>;
    private analyzeCode;
    private extractKeywords;
    private extractImports;
    private calculateComplexity;
    private findIssues;
    private formatCode;
    private averageIndent;
    private detectLanguage;
    private generateCode;
    getExpertWeights(): number[];
}
