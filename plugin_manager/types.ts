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

/**
 * Cross-platform capability vocabulary. Linux capabilities describe actions
 * the app may request; they do not bypass Unix DAC, ACLs, Linux capabilities,
 * namespaces, SELinux, AppArmor, polkit, or administrator policy.
 */
export type ExtensionPermission =
  | "location" | "camera" | "microphone" | "voice-activation" | "notifications"
  | "account-info" | "contacts" | "calendar" | "phone-calls" | "call-history"
  | "email" | "tasks" | "messaging" | "radios" | "other-devices"
  | "app-diagnostics" | "automatic-file-downloads" | "documents" | "downloads-folder"
  | "music-library" | "pictures" | "videos" | "file-system"
  | "screenshots-screen-recording" | "text-image-generation" | "passkeys" | "browser"
  | "self-heal" | "plugin-maker" | "skill-maker" | "coding" | "image-generation"
  | "video-generation" | "game-development" | "multi-desktop" | "multi-input"
  | "virtual-devices" | "wiki"
  // Linux filesystem and Unix permission model
  | "linux-file-read" | "linux-file-write" | "linux-file-execute"
  | "linux-file-create-delete" | "linux-file-metadata" | "linux-chmod"
  | "linux-chown" | "linux-suid-sgid-sticky" | "linux-acl-read" | "linux-acl-write"
  | "linux-extended-attributes" | "linux-immutable-append-only"
  | "linux-mount-unmount" | "linux-removable-storage"
  // Linux accounts, processes, and host administration
  | "linux-user-group-read" | "linux-user-group-admin" | "linux-sudo-admin"
  | "linux-process-inspect" | "linux-process-control" | "linux-service-control"
  | "linux-package-management" | "linux-kernel-modules" | "linux-sysctl"
  | "linux-hostname-time-power" | "linux-boot-configuration" | "linux-scheduled-jobs"
  | "linux-environment-variables" | "linux-system-logs" | "linux-audit-logs"
  | "linux-system-information" | "linux-backup-restore"
  // Linux security and isolation
  | "linux-capabilities-admin" | "linux-selinux-context-read" | "linux-selinux-policy-admin"
  | "linux-apparmor-status-read" | "linux-apparmor-policy-admin"
  | "linux-security-policy-admin" | "linux-firewall-admin" | "linux-network-config"
  | "linux-dbus-control" | "linux-device-access" | "linux-container-control"
  | "linux-namespace-control" | "linux-credential-store" | "linux-ssh-key-access"
  | "linux-certificate-store" | "linux-cryptographic-key-access"
  // Desktop and peripheral access
  | "linux-screen-capture" | "linux-audio-device" | "linux-input-monitoring"
  | "linux-keyboard-mouse-control" | "linux-clipboard" | "linux-display-settings"
  | "linux-printer-access" | "linux-bluetooth" | "linux-wifi"
  // Lennox business/platform profile permissions (only when that integration exists)
  | "lennox-admin-controls" | "lennox-ordering" | "lennox-inventory"
  | "lennox-pricing-visibility" | "lennox-warranty-returns";

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
