import type { PluginDefinition } from "../plugin_manager/types.js";

export const pluginExtensions: Record<string, PluginDefinition> = {
  "account-info": {
    id: "account-info",
    name: "Account Information",
    type: "api-connection",
    capabilities: ["account", "info", "system", "environment"]
  },
  "app-diagnostics": {
    id: "app-diagnostics",
    name: "Application Diagnostics",
    type: "api-connection",
    capabilities: ["diagnostics", "health", "system", "performance"]
  },
  "browser": {
    id: "browser",
    name: "Web Browser",
    type: "api-connection",
    capabilities: ["search", "fetch", "navigate", "browser"]
  },
  "calendar": {
    id: "calendar",
    name: "Calendar Scheduler",
    type: "api-connection",
    capabilities: ["calendar", "schedule", "events", "time"]
  },
  "call-history": {
    id: "call-history",
    name: "Call History Analyzer",
    type: "api-connection",
    capabilities: ["calls", "history", "stats", "communication"]
  },
  "camera": {
    id: "camera",
    name: "Camera Manager",
    type: "api-connection",
    capabilities: ["camera", "capture", "image", "media"]
  },
  "contacts": {
    id: "contacts",
    name: "Contact Book",
    type: "api-connection",
    capabilities: ["contacts", "address", "phone", "email"]
  },
  "email": {
    id: "email",
    name: "Email Client",
    type: "api-connection",
    capabilities: ["email", "send", "receive", "inbox"]
  },
  "file-system": {
    id: "file-system",
    name: "File System Manager",
    type: "api-connection",
    capabilities: ["file", "directory", "read", "write", "storage"]
  },
  "phone-calls": {
    id: "phone-calls",
    name: "Phone Call Simulator",
    type: "api-connection",
    capabilities: ["calls", "dial", "history", "voice"]
  },
  "image-extension": {
    id: "image-extension",
    name: "Image Extension",
    type: "api-connection",
    capabilities: ["generate", "resize", "convert", "image"]
  },
  "universal-language": {
    id: "universal-language",
    name: "Universal Language Skill",
    type: "api-connection",
    capabilities: ["programming", "languages", "coding", "moe"]
  }
};
