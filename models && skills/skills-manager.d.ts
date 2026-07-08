import { ProgrammingSkill } from './programming-skills.js';
import { MoERouter } from './core/moe-router.js';
import { ExpertNetwork } from './core/expert.js';
export interface SkillActivation {
    skillId: string;
    skillName: string;
    activationLevel: number;
    confidence: number;
    timestamp: number;
}
export interface SkillUsageStats {
    skillId: string;
    skillName: string;
    usageCount: number;
    lastUsed: number;
    averageActivation: number;
    successRate: number;
}
export interface SkillsManagerConfig {
    maxActiveSkills: number;
    activationThreshold: number;
    decayRate: number;
    learningRate: number;
}
export declare class SkillsManager {
    private config;
    private activeSkills;
    private skillUsageStats;
    private moeRouter;
    private expertNetworks;
    private skillEmbeddings;
    constructor(config?: Partial<SkillsManagerConfig>);
    connectMoERouter(router: MoERouter): void;
    private initializeSkillStats;
    private registerSkillsAsExperts;
    activateSkill(skillId: string, confidence?: number): boolean;
    deactivateSkill(skillId: string): boolean;
    getActiveSkills(): SkillActivation[];
    getSkillActivation(skillId: string): SkillActivation | undefined;
    searchAndActivate(query: string, maxResults?: number): SkillActivation[];
    private calculateSearchConfidence;
    getSkillsByCategory(category: string): ProgrammingSkill[];
    getSkillsByExpertType(expertType: string): ProgrammingSkill[];
    getAllSkills(): ProgrammingSkill[];
    getSkillUsageStats(skillId: string): SkillUsageStats | undefined;
    getAllUsageStats(): SkillUsageStats[];
    private updateSkillUsageStats;
    private findLeastRecentlyUsedSkill;
    decayActivations(): void;
    getSkillEmbedding(skillId: string): Float32Array | undefined;
    setSkillEmbedding(skillId: string, embedding: Float32Array): void;
    generateSkillEmbedding(skill: ProgrammingSkill): Float32Array;
    routeToSkillExpert(input: Float32Array, skillId: string): Float32Array | null;
    getExpertNetwork(expertType: string): ExpertNetwork | undefined;
    getAllExpertTypes(): string[];
    getRecommendations(context: string, maxRecommendations?: number): ProgrammingSkill[];
    exportActiveSkills(): {
        skills: SkillActivation[];
        timestamp: number;
    };
    importActiveSkills(data: {
        skills: SkillActivation[];
        timestamp: number;
    }): void;
    reset(): void;
    getConfig(): SkillsManagerConfig;
    updateConfig(config: Partial<SkillsManagerConfig>): void;
}
