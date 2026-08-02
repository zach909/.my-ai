export interface Capability {
    id: string;
    name: string;
    description: string;
    available: boolean;
    details: Record<string, unknown>;
}
export declare class CapabilitiesRegistry {
    private capabilities;
    constructor();
    private detectAll;
    private register;
    get(id: string): Capability | undefined;
    getAll(): Capability[];
    getAvailable(): Capability[];
    getUnavailable(): Capability[];
    isAvailable(id: string): boolean;
    getSystemPrompt(): string;
    getPersonalizationPrompt(): string;
    formatForPrompt(): string;
    private checkGnome;
    private checkXinput;
    private checkCommand;
    private findScreenshotTools;
}
