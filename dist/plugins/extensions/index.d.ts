import type { PluginDefinition } from "../../plugin_manager/types";
import { BasePlugin } from "../../plugin_manager/sdk";
export declare class ImageExtension extends BasePlugin {
    onMessage(message: unknown): Promise<unknown>;
    private generateImage;
    private resizeImage;
    private convertFormat;
    private imageInfo;
    onHealthCheck(): Promise<boolean>;
}
export declare class VideoExtension extends BasePlugin {
    onMessage(message: unknown): Promise<unknown>;
    private generateVideo;
    private trimVideo;
    private concatVideos;
    private extractAudio;
    private videoInfo;
    onHealthCheck(): Promise<boolean>;
}
export declare class GameExtension extends BasePlugin {
    private games;
    onMessage(message: unknown): Promise<unknown>;
    private startGame;
    private doAction;
    private rpsResult;
    private getGameState;
    private listGames;
    onHealthCheck(): Promise<boolean>;
}
export declare class SelfHealExtension extends BasePlugin {
    onMessage(message: unknown): Promise<unknown>;
    heal(): Promise<{
        healed: boolean;
        actions: string[];
    }>;
    getHealthStatus(): Promise<unknown>;
    onHealthCheck(): Promise<boolean>;
}
export declare class SkillMakerExtension extends BasePlugin {
    onMessage(message: unknown): Promise<unknown>;
    private generateSkill;
    onHealthCheck(): Promise<boolean>;
}
export declare class PluginMakerExtension extends BasePlugin {
    onMessage(message: unknown): Promise<unknown>;
    private extractCapabilities;
    private generatePlugin;
    private generateManifest;
    onHealthCheck(): Promise<boolean>;
}
/**
 * UniversalLanguageSkill - Creates MoE experts for all 200+ programming languages
 */
export declare class UniversalLanguageSkill extends BasePlugin {
    private builder;
    private moe;
    private languageNeurons;
    private activeLanguages;
    constructor(definition: PluginDefinition);
    private initializeLanguageSkills;
    onMessage(message: unknown): Promise<unknown>;
    private loadLanguage;
    private unloadLanguage;
    private listLanguages;
    private getSkillStatus;
    private createLanguageSkill;
    private detectLanguage;
    private processCode;
    private normalizeLanguageName;
    onHealthCheck(): Promise<boolean>;
}
