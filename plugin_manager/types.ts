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
  | "lennox-pricing-visibility" | "lennox-warranty-returns"
  // Additional Linux kernel, filesystem, security, desktop, network, and service controls
  | "linux-umask"
  | "linux-default-acl"
  | "linux-filesystem-quota"
  | "linux-filesystem-project-id"
  | "linux-filesystem-snapshot"
  | "linux-filesystem-repair"
  | "linux-filesystem-encryption"
  | "linux-disk-encryption"
  | "linux-logical-volume-management"
  | "linux-software-raid"
  | "linux-swap-management"
  | "linux-filesystem-export"
  | "linux-fuse-mounts"
  | "linux-file-locks"
  | "linux-filesystem-watchers"
  | "linux-process-priority"
  | "linux-process-scheduler"
  | "linux-process-resource-limits"
  | "linux-process-trace"
  | "linux-cgroup-control"
  | "linux-seccomp-policy"
  | "linux-landlock-policy"
  | "linux-bpf-control"
  | "linux-perf-events"
  | "linux-polkit-policy"
  | "linux-pam-configuration"
  | "linux-sudo-policy"
  | "linux-login-session-control"
  | "linux-user-session-control"
  | "linux-authentication-status"
  | "linux-account-lock-status"
  | "linux-ssh-configuration"
  | "linux-ssh-agent"
  | "linux-gpg-keyring"
  | "linux-keyring-management"
  | "linux-trust-store"
  | "linux-secure-boot-status"
  | "linux-tpm-access"
  | "linux-firmware-management"
  | "linux-udev-rules"
  | "linux-device-node-permissions"
  | "linux-usb-access"
  | "linux-serial-port-access"
  | "linux-gpu-access"
  | "linux-hardware-sensors"
  | "linux-power-management"
  | "linux-thermal-control"
  | "linux-time-sync"
  | "linux-locale-settings"
  | "linux-dns-configuration"
  | "linux-vpn-control"
  | "linux-network-manager"
  | "linux-packet-capture"
  | "linux-traffic-control"
  | "linux-proxy-settings"
  | "linux-hosts-file"
  | "linux-network-sharing"
  | "linux-mdns-discovery"
  | "linux-network-filesystems"
  | "linux-dbus-policy"
  | "linux-desktop-portals"
  | "linux-notification-control"
  | "linux-screen-lock-control"
  | "linux-accessibility-control"
  | "linux-speech-recognition"
  | "linux-camera-device"
  | "linux-scanner-access"
  | "linux-print-queue-admin"
  | "linux-flatpak-permissions"
  | "linux-snap-permissions"
  | "linux-app-permission-inventory"
  | "linux-package-repository-admin"
  | "linux-automatic-updates"
  | "linux-kernel-log-access"
  | "linux-journal-management"
  | "linux-audit-policy"
  | "linux-integrity-monitoring"
  | "linux-yama-policy"
  | "linux-smack-policy"
  | "linux-tomoyo-policy"
  | "linux-lsm-inventory"
  | "linux-kernel-lockdown"
  | "linux-module-signature-policy"
  | "linux-iommu-status"
  | "linux-virtualization-control"
  | "linux-libvirt-control"
  | "linux-systemd-unit-files"
  | "linux-systemd-timers"
  | "linux-user-crontab"
  | "linux-service-permission-inventory"
  | "linux-policykit-inventory"
  | "linux-permission-inventory"
  | "linux-permission-control-discovery"
  | "linux-effective-access-check";

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
