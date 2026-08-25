import { LocationPlugin } from "./location.js";
import { CameraPlugin } from "./camera.js";
import { MicrophonePlugin } from "./microphone.js";
import { VoiceActivationPlugin } from "./voice-activation.js";
import { NotificationsPlugin } from "./notifications.js";
import { AccountInfoPlugin } from "./account-info.js";
import { MultiInputPlugin } from "./multi-input.js";
import { ContactsPlugin } from "./contacts.js";
import { CalendarPlugin } from "./calendar.js";
import { PhoneCallsPlugin } from "./phone-calls.js";
import { CallHistoryPlugin } from "./call-history.js";
import { EmailPlugin } from "./email.js";
import { TasksPlugin } from "./tasks.js";
import { MessagingPlugin } from "./messaging.js";
import { RadiosPlugin } from "./radios.js";
import { OtherDevicesPlugin } from "./other-devices.js";
import { AppDiagnosticsPlugin } from "./app-diagnostics.js";
import { ScreenshotsPlugin } from "./screenshots.js";
import { BrowserPlugin } from "./browser.js";
import { FileSystemPlugin } from "./file-system.js";
import { PasskeysPlugin } from "./passkeys.js";
import { RoboticsPlugin } from "./robotics.js";
import { CodingExtension } from "./extensions/coding.js";
import { ImageExtension, VideoExtension, GameExtension, SelfHealExtension, SkillMakerExtension, PluginMakerExtension, UniversalLanguageSkill } from "./extensions/index.js";
import { ResearchPlugin } from "./research.js";
import { WikiPlugin } from "./wiki.js";
import { TerminalPlugin } from "./terminal.js";
import { ToolsPlugin } from "./tools.js";
import { StorePlugin } from "./store.js";
import { ComputerAccessPlugin } from "./computer-access.js";
export { LocationPlugin } from "./location.js";
export { CameraPlugin } from "./camera.js";
export { MicrophonePlugin } from "./microphone.js";
export { VoiceActivationPlugin } from "./voice-activation.js";
export { NotificationsPlugin } from "./notifications.js";
export { AccountInfoPlugin } from "./account-info.js";
export { ContactsPlugin } from "./contacts.js";
export { CalendarPlugin } from "./calendar.js";
export { PhoneCallsPlugin } from "./phone-calls.js";
export { CallHistoryPlugin } from "./call-history.js";
export { EmailPlugin } from "./email.js";
export { TasksPlugin } from "./tasks.js";
export { MessagingPlugin } from "./messaging.js";
export { RadiosPlugin } from "./radios.js";
export { OtherDevicesPlugin } from "./other-devices.js";
export { AppDiagnosticsPlugin } from "./app-diagnostics.js";
export { ScreenshotsPlugin } from "./screenshots.js";
export { BrowserPlugin } from "./browser.js";
export { FileSystemPlugin } from "./file-system.js";
export { PasskeysPlugin } from "./passkeys.js";
export { RoboticsPlugin } from "./robotics.js";
export { MultiInputPlugin } from "./multi-input.js";
export { CodingExtension } from "./extensions/coding.js";
export { ImageExtension, VideoExtension, GameExtension, SelfHealExtension, SkillMakerExtension, PluginMakerExtension, UniversalLanguageSkill } from "./extensions/index.js";
export { ResearchPlugin } from "./research.js";
export { WikiPlugin } from "./wiki.js";
export { TerminalPlugin } from "./terminal.js";
export { ToolsPlugin } from "./tools.js";
export { StorePlugin } from "./store.js";
export { ComputerAccessPlugin } from "./computer-access.js";
export function createPluginInstance(name, definition, skillDefinition, 
/** The agent's one shared NeuronMesh, for plugins that allocate their own neurons. */
sharedMesh) {
    const lower = name.toLowerCase();
    if (lower === "location")
        return new LocationPlugin(definition);
    if (lower === "camera")
        return new CameraPlugin(definition);
    if (lower === "microphone")
        return new MicrophonePlugin(definition);
    if (lower === "voice activation" || lower === "voice-activation")
        return new VoiceActivationPlugin(definition);
    if (lower === "notifications")
        return new NotificationsPlugin(definition);
    if (lower === "account info" || lower === "account-info")
        return new AccountInfoPlugin(definition);
    if (lower === "contacts")
        return new ContactsPlugin(definition);
    if (lower === "calendar")
        return new CalendarPlugin(definition);
    if (lower === "phone calls" || lower === "phone-calls")
        return new PhoneCallsPlugin(definition);
    if (lower === "call history" || lower === "call-history")
        return new CallHistoryPlugin(definition);
    if (lower === "email")
        return new EmailPlugin(definition);
    if (lower === "tasks")
        return new TasksPlugin(definition);
    if (lower === "messaging")
        return new MessagingPlugin(definition);
    if (lower === "radios")
        return new RadiosPlugin(definition);
    if (lower === "other devices" || lower === "other-devices")
        return new OtherDevicesPlugin(definition);
    if (lower === "app diagnostics" || lower === "app-diagnostics")
        return new AppDiagnosticsPlugin(definition);
    if (lower === "screenshots" || lower === "screenshots and screen recording")
        return new ScreenshotsPlugin(definition);
    if (lower === "browser")
        return new BrowserPlugin(definition);
    if (lower === "file system" || lower === "file-system")
        return new FileSystemPlugin(definition);
    if (lower === "passkeys")
        return new PasskeysPlugin(definition);
    if (lower === "robotics" || lower === "robotics-api")
        return new RoboticsPlugin(definition);
    if (lower.includes("coding"))
        return new CodingExtension(definition, skillDefinition);
    if (lower.includes("image"))
        return new ImageExtension(definition);
    if (lower.includes("video"))
        return new VideoExtension(definition);
    if (lower.includes("game"))
        return new GameExtension(definition);
    if (lower === "self heal" || lower === "self-heal")
        return new SelfHealExtension(definition);
    if (lower.includes("skill maker") || lower.includes("skill-maker"))
        return new SkillMakerExtension(definition);
    if (lower.includes("plugin maker") || lower.includes("plugin-maker"))
        return new PluginMakerExtension(definition);
    if (lower === "multi-input" || lower === "multi input" || lower === "multiinput" || lower.includes("desktop"))
        return new MultiInputPlugin(definition);
    if (lower.includes("language") || lower.includes("universal-language"))
        return new UniversalLanguageSkill(definition, sharedMesh);
    if (lower === "research")
        return new ResearchPlugin(definition);
    if (lower === "wiki")
        return new WikiPlugin(definition);
    if (lower === "terminal")
        return new TerminalPlugin(definition);
    if (lower === "tools")
        return new ToolsPlugin(definition);
    if (lower === "store")
        return new StorePlugin(definition);
    if (lower === "computer access" || lower === "computer-access")
        return new ComputerAccessPlugin(definition);
    throw new Error(`Unknown plugin: ${name}`);
}
const pluginExtensions = {
    location: { id: "location", name: "Location", type: "api-connection", capabilities: ["location"] },
    camera: { id: "camera", name: "Camera", type: "api-connection", capabilities: ["camera"] },
    microphone: { id: "microphone", name: "Microphone", type: "api-connection", capabilities: ["microphone"] },
    "voice-activation": { id: "voice-activation", name: "Voice Activation", type: "api-connection", capabilities: ["voice-activation"] },
    notifications: { id: "notifications", name: "Notifications", type: "api-connection", capabilities: ["notifications"] },
    "account-info": { id: "account-info", name: "Account Info", type: "api-connection", capabilities: ["account-info"] },
    contacts: { id: "contacts", name: "Contacts", type: "api-connection", capabilities: ["contacts"] },
    calendar: { id: "calendar", name: "Calendar", type: "api-connection", capabilities: ["calendar"] },
    "phone-calls": { id: "phone-calls", name: "Phone Calls", type: "api-connection", capabilities: ["phone-calls"] },
    "call-history": { id: "call-history", name: "Call History", type: "api-connection", capabilities: ["call-history"] },
    email: { id: "email", name: "Email", type: "api-connection", capabilities: ["email"] },
    tasks: { id: "tasks", name: "Tasks", type: "api-connection", capabilities: ["tasks"] },
    messaging: { id: "messaging", name: "Messaging", type: "api-connection", capabilities: ["messaging"] },
    radios: { id: "radios", name: "Radios", type: "api-connection", capabilities: ["radios"] },
    "other-devices": { id: "other-devices", name: "Other Devices", type: "api-connection", capabilities: ["other-devices"] },
    "app-diagnostics": { id: "app-diagnostics", name: "App Diagnostics", type: "api-connection", capabilities: ["app-diagnostics"] },
    screenshots: { id: "screenshots", name: "Screenshots", type: "api-connection", capabilities: ["screenshots-screen-recording"] },
    "file-system": { id: "file-system", name: "File System", type: "api-connection", capabilities: ["file-system"] },
    passkeys: { id: "passkeys", name: "Passkeys", type: "api-connection", capabilities: ["passkeys"] },
    browser: { id: "browser", name: "Browser", type: "api-connection", capabilities: ["browser"] },
    robotics: { id: "robotics", name: "Robotics", type: "api-connection", capabilities: ["robotics", "robot-control", "sensors"] },
    coding: { id: "coding", name: "Coding Skill", type: "skill-expert", capabilities: ["coding"] },
    image: { id: "image", name: "Image Skill", type: "skill-expert", capabilities: ["image-generation"] },
    video: { id: "video", name: "Video Skill", type: "skill-expert", capabilities: ["video-generation"] },
    game: { id: "game", name: "Game Skill", type: "skill-expert", capabilities: ["game-development"] },
    "self-heal": { id: "self-heal", name: "Self Heal", type: "api-connection", capabilities: ["self-heal"] },
    "multi-input": { id: "multi-input", name: "Multi Input", type: "api-connection", capabilities: ["multi-desktop", "multi-input", "virtual-devices"] },
    "skill-maker": { id: "skill-maker", name: "Skill Maker", type: "api-connection", capabilities: ["skill-maker"] },
    "plugin-maker": { id: "plugin-maker", name: "Plugin Maker", type: "api-connection", capabilities: ["plugin-maker"] },
    "universal-language-skill": { id: "universal-language-skill", name: "Universal Language Skill", type: "skill-expert", capabilities: ["language-support", "code-detection", "neuron-clusters"] },
    research: { id: "research", name: "Research", type: "api-connection", capabilities: ["memory-search", "drive-search", "web-search"] },
    wiki: { id: "wiki", name: "Wiki", type: "api-connection", capabilities: ["wiki"] },
    // Already referenced as a dispatch candidate in plugin_manager/registry.ts's
    // intentToPlugins `command` bucket (['self-heal', 'terminal', 'file-system'])
    // but never actually implemented/registered on the TS side -- 'terminal'
    // could never be reached even though the routing already named it.
    terminal: { id: "terminal", name: "Terminal", type: "api-connection", capabilities: ["terminal", "shell"] },
    // The GNOME graphical layer and the terminal/file layer, behind one set
    // of switches. Both modules existed before this entry; neither was reachable.
    "computer-access": {
        id: "computer-access",
        name: "Computer Access",
        type: "api-connection",
        capabilities: ["desktop-control", "terminal", "file-system", "screen-observe"],
    },
    store: { id: "store", name: "Store", type: "api-connection", capabilities: ["store", "publish", "share"] },
    tools: { id: "tools", name: "Tools", type: "api-connection", capabilities: ["tools", "calculator", "hashing", "encoding", "units"] },
};
const allExtensions = Object.entries(pluginExtensions).map(([key, def]) => ({
    id: def.id,
    name: def.name,
    version: "1.0.0",
    description: `${def.name} plugin`,
    permissions: def.capabilities,
    author: "Neuroclaw",
    entrypoint: `./plugins/${key}.js`,
}));
export { pluginExtensions, allExtensions as ALL_EXTENSIONS };
