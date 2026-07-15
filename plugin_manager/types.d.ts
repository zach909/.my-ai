export type PluginDefinition = {
    id: string;
    name: string;
    type: "api-connection" | "skill-expert";
    serviceUrl?: string;
    apiKey?: string;
    expertWeights?: number[];
    capabilities: string[];
};
export type SkillDefinition = {
    id: string;
    name: string;
    description: string;
    expertIndex: number;
    specialization: string;
    trainingData?: string;
    selfAuthored: boolean;
};
export type ChromeAppConfig = {
    id: string;
    name: string;
    url: string;
    permissions: string[];
    autoConnect: boolean;
    dataSync: boolean;
};
export type ExtensionPermission = "location" | "camera" | "microphone" | "voice-activation" | "notifications" | "account-info" | "contacts" | "calendar" | "phone-calls" | "call-history" | "email" | "tasks" | "messaging" | "radios" | "other-devices" | "app-diagnostics" | "automatic-file-downloads" | "documents" | "downloads-folder" | "music-library" | "pictures" | "videos" | "file-system" | "screenshots-screen-recording" | "text-image-generation" | "passkeys" | "browser" | "self-heal" | "plugin-maker" | "skill-maker" | "coding" | "image-generation" | "video-generation" | "game-development" | "multi-desktop" | "multi-input" | "virtual-devices";
export type APIEndpoint = {
    path: string;
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
};
export type ExtensionManifest = {
    id: string;
    name: string;
    version: string;
    description: string;
    permissions: ExtensionPermission[];
    author: string;
    homepage?: string;
    entrypoint: string;
    apiEndpoints?: APIEndpoint[];
};
