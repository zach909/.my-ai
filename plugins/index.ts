import type { PluginDefinition, ExtensionManifest, SkillDefinition } from "../plugin_manager/types";
import { LocationPlugin } from "./location";
import { CameraPlugin } from "./camera";
import { MicrophonePlugin } from "./microphone";
import { VoiceActivationPlugin } from "./voice-activation";
import { NotificationsPlugin } from "./notifications";
import { AccountInfoPlugin } from "./account-info";
import { MultiInputPlugin } from "./multi-input";
import { ContactsPlugin } from "./contacts";
import { CalendarPlugin } from "./calendar";
import { PhoneCallsPlugin } from "./phone-calls";
import { CallHistoryPlugin } from "./call-history";
import { EmailPlugin } from "./email";
import { TasksPlugin } from "./tasks";
import { MessagingPlugin } from "./messaging";
import { RadiosPlugin } from "./radios";
import { OtherDevicesPlugin } from "./other-devices";
import { AppDiagnosticsPlugin } from "./app-diagnostics";
import { ScreenshotsPlugin } from "./screenshots";
import { BrowserPlugin } from "./browser";
import { FileSystemPlugin } from "./file-system";
import { PasskeysPlugin } from "./passkeys";
import { CodingExtension } from "./extensions/coding";
import { ImageExtension, VideoExtension, GameExtension, SelfHealExtension, SkillMakerExtension, PluginMakerExtension } from "./extensions";
import type { BasePlugin } from "../plugin_manager/sdk";

export { LocationPlugin } from "./location";
export { CameraPlugin } from "./camera";
export { MicrophonePlugin } from "./microphone";
export { VoiceActivationPlugin } from "./voice-activation";
export { NotificationsPlugin } from "./notifications";
export { AccountInfoPlugin } from "./account-info";
export { ContactsPlugin } from "./contacts";
export { CalendarPlugin } from "./calendar";
export { PhoneCallsPlugin } from "./phone-calls";
export { CallHistoryPlugin } from "./call-history";
export { EmailPlugin } from "./email";
export { TasksPlugin } from "./tasks";
export { MessagingPlugin } from "./messaging";
export { RadiosPlugin } from "./radios";
export { OtherDevicesPlugin } from "./other-devices";
export { AppDiagnosticsPlugin } from "./app-diagnostics";
export { ScreenshotsPlugin } from "./screenshots";
export { BrowserPlugin } from "./browser";
export { FileSystemPlugin } from "./file-system";
export { PasskeysPlugin } from "./passkeys";
export { MultiInputPlugin } from "./multi-input";
export { CodingExtension } from "./extensions/coding";
export { ImageExtension, VideoExtension, GameExtension, SelfHealExtension, SkillMakerExtension, PluginMakerExtension } from "./extensions";

export function createPluginInstance(
  name: string,
  definition: PluginDefinition,
  skillDefinition?: SkillDefinition,
): BasePlugin {
  const lower = name.toLowerCase();
  if (lower === "location") return new LocationPlugin(definition);
  if (lower === "camera") return new CameraPlugin(definition);
  if (lower === "microphone") return new MicrophonePlugin(definition);
  if (lower === "voice activation" || lower === "voice-activation") return new VoiceActivationPlugin(definition);
  if (lower === "notifications") return new NotificationsPlugin(definition);
  if (lower === "account info" || lower === "account-info") return new AccountInfoPlugin(definition);
  if (lower === "contacts") return new ContactsPlugin(definition);
  if (lower === "calendar") return new CalendarPlugin(definition);
  if (lower === "phone calls" || lower === "phone-calls") return new PhoneCallsPlugin(definition);
  if (lower === "call history" || lower === "call-history") return new CallHistoryPlugin(definition);
  if (lower === "email") return new EmailPlugin(definition);
  if (lower === "tasks") return new TasksPlugin(definition);
  if (lower === "messaging") return new MessagingPlugin(definition);
  if (lower === "radios") return new RadiosPlugin(definition);
  if (lower === "other devices" || lower === "other-devices") return new OtherDevicesPlugin(definition);
  if (lower === "app diagnostics" || lower === "app-diagnostics") return new AppDiagnosticsPlugin(definition);
  if (lower === "screenshots" || lower === "screenshots and screen recording") return new ScreenshotsPlugin(definition);
  if (lower === "browser") return new BrowserPlugin(definition);
  if (lower === "file system" || lower === "file-system") return new FileSystemPlugin(definition);
  if (lower === "passkeys") return new PasskeysPlugin(definition);
  if (lower.includes("coding")) return new CodingExtension(definition, skillDefinition!);
  if (lower.includes("image")) return new ImageExtension(definition);
  if (lower.includes("video")) return new VideoExtension(definition);
  if (lower.includes("game")) return new GameExtension(definition);
  if (lower === "self heal" || lower === "self-heal") return new SelfHealExtension(definition);
  if (lower.includes("skill maker") || lower.includes("skill-maker")) return new SkillMakerExtension(definition);
  if (lower.includes("plugin maker") || lower.includes("plugin-maker")) return new PluginMakerExtension(definition);
  if (lower === "multi-input" || lower === "multi input" || lower === "multiinput" || lower.includes("desktop")) return new MultiInputPlugin(definition);
  throw new Error(`Unknown plugin: ${name}`);
}

const pluginExtensions: Record<string, PluginDefinition> = {
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
  coding: { id: "coding", name: "Coding Skill", type: "skill-expert", capabilities: ["coding"] },
  image: { id: "image", name: "Image Skill", type: "skill-expert", capabilities: ["image-generation"] },
  video: { id: "video", name: "Video Skill", type: "skill-expert", capabilities: ["video-generation"] },
  game: { id: "game", name: "Game Skill", type: "skill-expert", capabilities: ["game-development"] },
  "self-heal": { id: "self-heal", name: "Self Heal", type: "api-connection", capabilities: ["self-heal"] },
  "multi-input": { id: "multi-input", name: "Multi Input", type: "api-connection", capabilities: ["multi-desktop", "multi-input", "virtual-devices"] },
  "skill-maker": { id: "skill-maker", name: "Skill Maker", type: "api-connection", capabilities: ["skill-maker"] },
  "plugin-maker": { id: "plugin-maker", name: "Plugin Maker", type: "api-connection", capabilities: ["plugin-maker"] },
};

const allExtensions: ExtensionManifest[] = Object.entries(pluginExtensions).map(([key, def]) => ({
  id: def.id,
  name: def.name,
  version: "1.0.0",
  description: `${def.name} plugin`,
  permissions: def.capabilities as any[],
  author: "Neuroclaw",
  entrypoint: `./plugins/${key}.js`,
}));

export { pluginExtensions, allExtensions as ALL_EXTENSIONS };
