/**
 * Linux permission tools.
 *
 * Every permission capability has a distinct callable tool descriptor. Tools
 * are deny-by-default: they require a current permission grant, Linux runtime,
 * and a registered native adapter. High-impact actions also require per-call
 * human approval. Adapters must use fixed executable allowlists / native APIs;
 * never pass model-authored strings to a shell.
 *
 * A capability is not a privilege escalation. Unix DAC, ACLs, polkit, sudo,
 * capabilities, namespaces, SELinux, AppArmor and administrator policy remain
 * authoritative. Lennox tools require a separately configured official
 * integration and intentionally fail closed when it is absent.
 */

import type { ExtensionPermission } from "../plugin_manager/types.js";

export interface LinuxToolCallContext {
  /** Must verify a grant for this exact capability and requesting extension. */
  isGranted: (extensionId: string, permission: ExtensionPermission) => boolean;
  /** Ask the human for this specific operation; return false on denial/timeout. */
  requestApproval: (request: { tool: string; permission: ExtensionPermission; args: Record<string, unknown>; risk: "high" | "critical" }) => Promise<boolean>;
  /** A native, validated adapter registered by the host for this capability. */
  adapters: Partial<Record<ExtensionPermission, (args: Record<string, unknown>) => Promise<unknown>>>;
  /** Defaults to process.platform; injectable for tests. */
  platform?: NodeJS.Platform;
}

export interface LinuxPermissionTool {
  name: string;
  permission: ExtensionPermission;
  category: string;
  description: string;
  risk: "high" | "critical";
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[]; minimum?: number; maximum?: number }>;
    required: string[];
    additionalProperties: false;
  };
  execute: (args: Record<string, unknown>, context: LinuxToolCallContext, extensionId?: string) => Promise<unknown>;
}

type ToolSpec = {
  permission: ExtensionPermission;
  category: string;
  description: string;
  risk?: "high" | "critical";
  properties?: Record<string, { type: string; description: string; enum?: string[]; minimum?: number; maximum?: number }>;
  required?: string[];
};

const commonPath = { path: { type: "string", description: "Absolute or app-authorized filesystem path." } };
const action = { action: { type: "string", description: "Explicit operation requested from the supported adapter." } };
const target = { target: { type: "string", description: "Target identifier, path, unit, device, or resource name." } };
const specs: ToolSpec[] = [
  { permission: "linux-file-read", category: "Filesystem", description: "Read a file or a bounded file range.", properties: { ...commonPath, offset: { type: "number", description: "Byte offset.", minimum: 0 }, limit: { type: "number", description: "Maximum bytes to return.", minimum: 1, maximum: 1048576 } }, required: ["path"] },
  { permission: "linux-file-write", category: "Filesystem", description: "Write or replace a file; adapter must validate path and content size.", properties: { ...commonPath, content: { type: "string", description: "Text content to write." }, mode: { type: "number", description: "Optional octal mode, e.g. 384 for 0600.", minimum: 0, maximum: 511 } }, required: ["path", "content"] },
  { permission: "linux-file-execute", category: "Filesystem", description: "Execute an explicitly approved executable by absolute path with an argument array.", properties: { path: { type: "string", description: "Absolute executable path; no shell." }, args: { type: "array", description: "Argument list passed without shell expansion." } }, required: ["path", "args"] },
  { permission: "linux-file-create-delete", category: "Filesystem", description: "Create, move, or delete a filesystem entry.", properties: { ...action, path: commonPath.path, destination: { type: "string", description: "Destination path for a move." } }, required: ["action", "path"] },
  { permission: "linux-file-metadata", category: "Filesystem", description: "Read file type, ownership, mode, size, and timestamps.", properties: commonPath, required: ["path"] },
  { permission: "linux-chmod", category: "Unix permissions", description: "Change Unix permission bits using a numeric mode.", properties: { ...commonPath, mode: { type: "number", description: "Octal mode expressed as an integer, e.g. 493 for 0755.", minimum: 0, maximum: 4095 } }, required: ["path", "mode"] },
  { permission: "linux-chown", category: "Unix permissions", description: "Change file owner/group by numeric UID/GID.", properties: { ...commonPath, uid: { type: "number", description: "Numeric user ID.", minimum: 0 }, gid: { type: "number", description: "Numeric group ID.", minimum: 0 } }, required: ["path"] },
  { permission: "linux-suid-sgid-sticky", category: "Unix permissions", description: "Inspect or change SUID, SGID, and sticky bits.", properties: { ...commonPath, mode: { type: "number", description: "Full numeric mode including special bits.", minimum: 0, maximum: 4095 } }, required: ["path"] },
  { permission: "linux-acl-read", category: "ACL", description: "Read POSIX access/default ACL entries.", properties: commonPath, required: ["path"] },
  { permission: "linux-acl-write", category: "ACL", description: "Set or remove explicit POSIX ACL entries.", properties: { ...commonPath, entries: { type: "array", description: "Validated ACL entry list; adapter must reject malformed entries." } }, required: ["path", "entries"] },
  { permission: "linux-extended-attributes", category: "Filesystem security", description: "List, read, set, or remove extended attributes.", properties: { ...commonPath, name: { type: "string", description: "Attribute name." }, value: { type: "string", description: "Attribute value." }, action: { type: "string", description: "list, get, set, or remove.", enum: ["list", "get", "set", "remove"] } }, required: ["path", "action"] },
  { permission: "linux-immutable-append-only", category: "Filesystem security", description: "Inspect or change immutable/append-only filesystem flags.", properties: { ...commonPath, flags: { type: "array", description: "Requested flags: immutable or append-only." }, action: { type: "string", description: "inspect, set, or clear.", enum: ["inspect", "set", "clear"] } }, required: ["path", "action"] },
  { permission: "linux-mount-unmount", category: "Storage", description: "Inspect mounts or mount/unmount an approved device and target.", properties: { ...target, action: { type: "string", description: "list, mount, or unmount.", enum: ["list", "mount", "unmount"] }, source: { type: "string", description: "Device or source for mount." }, path: { type: "string", description: "Mount point." }, filesystem: { type: "string", description: "Filesystem type." } }, required: ["action"] },
  { permission: "linux-removable-storage", category: "Storage", description: "Enumerate and safely eject removable storage.", properties: { ...target, action: { type: "string", description: "list, inspect, or eject.", enum: ["list", "inspect", "eject"] } }, required: ["action"] },
  { permission: "linux-user-group-read", category: "Accounts", description: "Read local account and group metadata without exposing password hashes.", properties: { ...target, kind: { type: "string", description: "user or group.", enum: ["user", "group"] } }, required: ["kind"] },
  { permission: "linux-user-group-admin", category: "Accounts", description: "Create, modify, or remove local users/groups.", properties: { ...action, ...target, kind: { type: "string", description: "user or group.", enum: ["user", "group"] }, uid: { type: "number", description: "Optional numeric UID/GID.", minimum: 0 }, groups: { type: "array", description: "Explicit supplementary groups." } }, required: ["action", "kind", "target"] },
  { permission: "linux-sudo-admin", category: "Administration", description: "Request a narrowly scoped privileged action through polkit or a host-approved helper; never collect a sudo password.", properties: { ...action, ...target }, required: ["action"] , risk:"critical" },
  { permission: "linux-process-inspect", category: "Processes", description: "List processes and inspect selected process metadata.", properties: { ...target, pid: { type: "number", description: "Process ID.", minimum: 1 } }, required: [] },
  { permission: "linux-process-control", category: "Processes", description: "Send a named signal to a process after validating PID ownership and approval.", properties: { pid: { type: "number", description: "Process ID.", minimum: 1 }, signal: { type: "string", description: "Signal name.", enum: ["SIGTERM", "SIGINT", "SIGHUP", "SIGKILL"] } }, required: ["pid", "signal"], risk:"critical" },
  { permission: "linux-service-control", category: "Services", description: "Inspect/start/stop/restart an allowlisted system service.", properties: { ...target, action: { type: "string", description: "status, start, stop, restart, enable, disable.", enum: ["status", "start", "stop", "restart", "enable", "disable"] } }, required: ["target", "action"], risk:"critical" },
  { permission: "linux-package-management", category: "Packages", description: "Query, install, update, or remove packages through the detected package manager.", properties: { ...target, action: { type: "string", description: "search, info, install, update, remove.", enum: ["search", "info", "install", "update", "remove"] } }, required: ["action"], risk:"critical" },
  { permission: "linux-kernel-modules", category: "Kernel", description: "List or request loading/unloading a named kernel module.", properties: { ...target, action: { type: "string", description: "list, inspect, load, unload.", enum: ["list", "inspect", "load", "unload"] } }, required: ["action"], risk:"critical" },
  { permission: "linux-sysctl", category: "Kernel", description: "Read or change an explicitly named sysctl key.", properties: { ...target, value: { type: "string", description: "New value for the named key." }, action: { type: "string", description: "get or set.", enum: ["get", "set"] } }, required: ["target", "action"] },
  { permission: "linux-hostname-time-power", category: "Host", description: "Read hostname/time or request a hostname/time/power change.", properties: { ...action, value: { type: "string", description: "New hostname or ISO timestamp where applicable." } }, required: ["action"] , risk:"critical" },
  { permission: "linux-boot-configuration", category: "Boot", description: "Inspect boot settings or propose a reviewed boot configuration change.", properties: { ...action, ...target, content: { type: "string", description: "Proposed configuration content." } }, required: ["action"], risk:"critical" },
  { permission: "linux-scheduled-jobs", category: "Scheduling", description: "List or manage this user's scheduled jobs.", properties: { ...action, id: { type: "string", description: "Job identifier." }, schedule: { type: "string", description: "Schedule expression." }, command: { type: "string", description: "Executable and arguments, validated by adapter." } }, required: ["action"], risk:"critical" },
  { permission: "linux-environment-variables", category: "Host", description: "Read or set process-scoped environment variables; system-wide changes require approval.", properties: { name: { type: "string", description: "Variable name." }, value: { type: "string", description: "Variable value." }, action: { type: "string", description: "get, set, list.", enum: ["get", "set", "list"] } }, required: ["action"] },
  { permission: "linux-system-logs", category: "Logs", description: "Read filtered system/service logs with bounded output.", properties: { ...target, since: { type: "string", description: "Time window or ISO timestamp." }, limit: { type: "number", description: "Maximum records.", minimum: 1, maximum: 2000 } }, required: [] },
  { permission: "linux-audit-logs", category: "Logs", description: "Read filtered security audit events; secret fields must be redacted.", properties: { ...target, since: { type: "string", description: "Time window or ISO timestamp." }, limit: { type: "number", description: "Maximum records.", minimum: 1, maximum: 2000 } }, required: [] },
  { permission: "linux-system-information", category: "Host", description: "Read distribution, kernel, architecture, resource, and capability information.", properties: action, required: [] },
  { permission: "linux-backup-restore", category: "Recovery", description: "Create, inspect, verify, or restore a scoped backup.", properties: { ...action, source: { type: "string", description: "Source path or backup ID." }, destination: { type: "string", description: "Backup destination or restore target." } }, required: ["action"], risk:"critical" },
  { permission: "linux-capabilities-admin", category: "Security", description: "Inspect or change Linux file capabilities.", properties: { ...commonPath, action: { type: "string", description: "get, set, remove.", enum: ["get", "set", "remove"] }, capabilities: { type: "string", description: "Capability set expression." } }, required: ["path", "action"], risk:"critical" },
  { permission: "linux-selinux-context-read", category: "SELinux", description: "Read SELinux mode, labels, and policy status.", properties: { ...commonPath, action: { type: "string", description: "status or context.", enum: ["status", "context"] } }, required: ["action"] },
  { permission: "linux-selinux-policy-admin", category: "SELinux", description: "Manage SELinux labels or policy through an installed SELinux adapter.", properties: { ...action, ...commonPath, context: { type: "string", description: "Validated SELinux context." }, policy: { type: "string", description: "Named policy module." } }, required: ["action"], risk:"critical" },
  { permission: "linux-apparmor-status-read", category: "AppArmor", description: "Read AppArmor status and profile enforcement state.", properties: action, required: [] },
  { permission: "linux-apparmor-policy-admin", category: "AppArmor", description: "Manage AppArmor profiles through a validated policy adapter.", properties: { ...action, ...target, content: { type: "string", description: "Proposed profile content." } }, required: ["action"], risk:"critical" },
  { permission: "linux-security-policy-admin", category: "Security", description: "Inspect or change host security policy through an allowlisted policy adapter.", properties: { ...action, ...target }, required: ["action"], risk:"critical" },
  { permission: "linux-firewall-admin", category: "Networking", description: "Inspect or manage firewall rules through nftables/firewalld/ufw adapters.", properties: { ...action, ...target, protocol: { type: "string", description: "tcp or udp.", enum: ["tcp", "udp"] }, port: { type: "number", description: "Port number.", minimum: 1, maximum: 65535 } }, required: ["action"], risk:"critical" },
  { permission: "linux-network-config", category: "Networking", description: "Inspect interfaces/routes or request network configuration changes.", properties: { ...action, ...target, address: { type: "string", description: "IP address or CIDR." } }, required: ["action"], risk:"critical" },
  { permission: "linux-dbus-control", category: "Desktop/system bus", description: "Call an explicitly allowlisted D-Bus service/method.", properties: { service: { type: "string", description: "D-Bus service name." }, path: { type: "string", description: "Object path." }, interface: { type: "string", description: "Interface name." }, method: { type: "string", description: "Allowlisted method name." }, args: { type: "array", description: "Typed D-Bus arguments." } }, required: ["service", "path", "interface", "method"] },
  { permission: "linux-device-access", category: "Devices", description: "Enumerate and inspect authorized hardware devices.", properties: { ...target, action: { type: "string", description: "list or inspect.", enum: ["list", "inspect"] } }, required: ["action"] },
  { permission: "linux-container-control", category: "Containers", description: "Inspect/manage allowlisted containers and images.", properties: { ...target, action: { type: "string", description: "list, inspect, start, stop, restart, logs.", enum: ["list", "inspect", "start", "stop", "restart", "logs"] } }, required: ["action"], risk:"critical" },
  { permission: "linux-namespace-control", category: "Isolation", description: "Inspect or create a constrained namespace/sandbox through a host adapter.", properties: { ...action, ...target }, required: ["action"], risk:"critical" },
  { permission: "linux-credential-store", category: "Secrets", description: "Use the desktop secret service/keyring without returning unrelated secrets.", properties: { ...action, key: { type: "string", description: "Namespaced secret identifier." }, value: { type: "string", description: "Secret value for set operation." } }, required: ["action", "key"], risk:"critical" },
  { permission: "linux-ssh-key-access", category: "Secrets", description: "List public SSH keys or use a named key; private key bytes must not be returned.", properties: { ...action, keyId: { type: "string", description: "Key identifier or public-key path." } }, required: ["action"], risk:"critical" },
  { permission: "linux-certificate-store", category: "Certificates", description: "Inspect or manage system/user certificate trust entries.", properties: { ...action, certificate: { type: "string", description: "Certificate path or fingerprint." } }, required: ["action"], risk:"critical" },
  { permission: "linux-cryptographic-key-access", category: "Secrets", description: "Use a named cryptographic key for an approved operation without exporting key material.", properties: { ...action, keyId: { type: "string", description: "Key identifier." }, data: { type: "string", description: "Data for the requested cryptographic operation." } }, required: ["action", "keyId"], risk:"critical" },
  { permission: "linux-screen-capture", category: "Desktop", description: "Capture the active screen/window using the desktop portal and user consent.", properties: { ...target, mode: { type: "string", description: "screen or window.", enum: ["screen", "window"] } }, required: [] },
  { permission: "linux-audio-device", category: "Desktop", description: "List audio devices or capture/play audio after consent.", properties: { ...action, ...target }, required: ["action"] },
  { permission: "linux-input-monitoring", category: "Desktop", description: "Request supported accessibility/input-monitoring access; do not collect passwords or hidden keystrokes.", properties: action, required: ["action"] , risk:"critical" },
  { permission: "linux-keyboard-mouse-control", category: "Desktop", description: "Perform visible, user-authorized keyboard/mouse actions in the active desktop.", properties: { action: { type: "string", description: "click, move, type, keypress.", enum: ["click", "move", "type", "keypress"] }, x: { type: "number", description: "Screen X coordinate." }, y: { type: "number", description: "Screen Y coordinate." }, text: { type: "string", description: "Text to type visibly." }, key: { type: "string", description: "Named key." } }, required: ["action"], risk:"critical" },
  { permission: "linux-clipboard", category: "Desktop", description: "Read or write the current clipboard.", properties: { action: { type: "string", description: "read or write.", enum: ["read", "write"] }, text: { type: "string", description: "Text to place on clipboard." } }, required: ["action"] },
  { permission: "linux-display-settings", category: "Desktop", description: "Read or change display resolution, scale, and monitor layout.", properties: { ...action, ...target }, required: ["action"] },
  { permission: "linux-printer-access", category: "Peripherals", description: "List printers and inspect/submit/cancel a print job.", properties: { ...action, ...target, file: { type: "string", description: "File to print." } }, required: ["action"] },
  { permission: "linux-bluetooth", category: "Peripherals", description: "Inspect or connect/disconnect a Bluetooth device.", properties: { ...action, ...target }, required: ["action"] },
  { permission: "linux-wifi", category: "Networking", description: "Inspect or connect/disconnect a saved Wi-Fi network without exposing credentials.", properties: { ...action, ...target }, required: ["action"] },
  { permission: "lennox-admin-controls", category: "Lennox business integration", description: "Use approved Lennox administrator controls. Requires a configured official integration.", properties: { ...action, ...target }, required: ["action"], risk:"critical" },
  { permission: "lennox-ordering", category: "Lennox business integration", description: "Create or inspect Lennox orders through a configured official integration.", properties: { ...action, ...target, items: { type: "array", description: "Requested order line items." } }, required: ["action"], risk:"critical" },
  { permission: "lennox-inventory", category: "Lennox business integration", description: "Read or update Lennox inventory through a configured official integration.", properties: { ...action, ...target, quantity: { type: "number", description: "Inventory quantity." } }, required: ["action"], risk:"high" },
  { permission: "lennox-pricing-visibility", category: "Lennox business integration", description: "Read authorized Lennox pricing data through a configured official integration.", properties: target, required: ["target"], risk:"high" },
  { permission: "lennox-warranty-returns", category: "Lennox business integration", description: "Inspect or initiate warranty/return workflows through a configured official integration.", properties: { ...action, ...target, orderId: { type: "string", description: "Order identifier." }, reason: { type: "string", description: "Return/warranty reason." } }, required: ["action"], risk:"critical" },
];

const highRisk = new Set<ExtensionPermission>(specs.filter(s => s.risk === "critical" || s.risk === "high").map(s => s.permission));

/** All distinct tools, one per Linux/Lennox capability. */
export const LINUX_PERMISSION_TOOLS: LinuxPermissionTool[] = specs.map((spec) => {
  const name = spec.permission.replace(/-/g, "_");
  const risk = spec.risk ?? "high";
  return {
    name,
    permission: spec.permission,
    category: spec.category,
    description: spec.description,
    risk,
    inputSchema: {
      type: "object",
      properties: spec.properties ?? {},
      required: spec.required ?? [],
      additionalProperties: false,
    },
    execute: async (args, context, extensionId = "linux-permission-tools") => {
      if ((context.platform ?? process.platform) !== "linux") {
        throw new Error(`${name} is Linux-only; current platform is ${context.platform ?? process.platform}.`);
      }
      if (!context.isGranted(extensionId, spec.permission)) {
        throw new Error(`Permission denied: grant ${spec.permission} to ${extensionId} before calling ${name}.`);
      }
      if (risk === "high" || risk === "critical" || highRisk.has(spec.permission)) {
        const approved = await context.requestApproval({ tool: name, permission: spec.permission, args, risk });
        if (!approved) throw new Error(`Human approval denied for ${name}; no operation was performed.`);
      }
      const adapter = context.adapters[spec.permission];
      if (!adapter) {
        throw new Error(`Tool ${name} is registered, but no native adapter is configured for ${spec.permission}. No operation was performed.`);
      }
      return adapter(args);
    },
  };
});

/** Resolve a tool by its public name; useful to connect this catalogue to the agent's tool-call router. */
export function getLinuxPermissionTool(name: string): LinuxPermissionTool | undefined {
  return LINUX_PERMISSION_TOOLS.find(tool => tool.name === name);
}

/** Tool names and required permissions for UI discovery and permission screens. */
export function listLinuxPermissionTools(): Array<Pick<LinuxPermissionTool, "name" | "permission" | "category" | "description" | "risk" | "inputSchema">> {
  return LINUX_PERMISSION_TOOLS.map(({ execute: _execute, ...tool }) => tool);
}
