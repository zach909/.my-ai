/**
 * Real root/system-permission access for Linux, narrowly scoped.
 *
 * This is the first working adapter for plugins/linux-permission-tools.ts's
 * "Privilege broker" and "Administration" tools (linux-root-access-request,
 * linux-polkit-elevation, linux-sudo-admin, linux-privileged-helper-manage),
 * which until now had full tool descriptors but no `LinuxToolCallContext`
 * ever injected -- every call failed with "host is not configured".
 *
 * The approach: `pkexec` (PolicyKit's own command, present on virtually
 * every Linux desktop) IS the approval step. It shows the operating
 * system's own authentication dialog; this code never collects a password
 * and never silently becomes root. What it DOES control is which operation
 * a user can trigger at all: only systemd unit actions, and only against
 * units the user has explicitly allowlisted in Settings (deny-by-default,
 * same philosophy as models && skills/core/access-settings.ts). Everything
 * else in the tool's own operation enum (package install, firewall rules,
 * local accounts, mounting, security policy) is honestly reported as not
 * implemented rather than faked.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configFile } from "../../interface/platform/app-paths.js";
import { writeJsonAtomic } from "./atomic-write.js";

const execFileAsync = promisify(execFile);

export interface BrokerSettings {
  /** Master switch. Off refuses every privilege-broker tool call before pkexec is even considered. */
  enabled: boolean;
  /** systemd unit names the user has explicitly allowed start/stop/restart/enable/disable/status on, via pkexec. */
  allowedServices: string[];
}

function defaultSettings(): BrokerSettings {
  return { enabled: true, allowedServices: [] };
}

function brokerFile(): string {
  return configFile("linux-privilege-broker.json", process.env.CORONA_PRIVILEGE_BROKER_FILE).write;
}

function brokerReadFile(): string {
  return configFile("linux-privilege-broker.json", process.env.CORONA_PRIVILEGE_BROKER_FILE).read;
}

export function loadBrokerSettings(file = brokerReadFile()): BrokerSettings {
  try {
    if (!existsSync(file)) return defaultSettings();
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const allowed = Array.isArray(parsed?.allowedServices) ? parsed.allowedServices.filter((s: unknown) => typeof s === "string") : [];
    const enabled = typeof parsed?.enabled === "boolean" ? parsed.enabled : true;
    return { enabled, allowedServices: allowed };
  } catch {
    return defaultSettings();
  }
}

export interface SaveStatus {
  ok: boolean;
  error?: string;
}

export function saveBrokerSettings(settings: BrokerSettings, file = brokerFile()): SaveStatus {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, settings);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** systemd unit names: letters, digits, @, _, ., - only (matches systemd's own naming rules closely enough to reject garbage). */
const UNIT_NAME = /^[a-zA-Z0-9@_.-]+$/;

let pkexecPathCache: string | null | undefined;

async function pkexecPath(): Promise<string | null> {
  if (pkexecPathCache !== undefined) return pkexecPathCache;
  try {
    const { stdout } = await execFileAsync("which", ["pkexec"]);
    pkexecPathCache = stdout.trim() || null;
  } catch {
    pkexecPathCache = null;
  }
  return pkexecPathCache;
}

/** Reset the cached `pkexec` lookup; tests only. */
export function resetPkexecCache(): void {
  pkexecPathCache = undefined;
}

export interface BrokerResult {
  ok: boolean;
  stdout?: string;
  error?: string;
}

const SERVICE_ACTIONS = ["status", "start", "stop", "restart", "enable", "disable"] as const;
type ServiceAction = (typeof SERVICE_ACTIONS)[number];

/**
 * The one real privileged operation this broker performs: a systemctl
 * action against a unit, run through pkexec so the OS's own dialog
 * authenticates it. `status` needs no allowlist entry (read-only, and
 * `systemctl status` on an unprivileged system still works without root
 * for most units, but routed through pkexec here for a consistent path);
 * every other action requires the unit to already be in `allowedServices`.
 */
export async function manageService(
  action: string,
  target: string,
  settings: BrokerSettings = loadBrokerSettings(),
): Promise<BrokerResult> {
  if (!SERVICE_ACTIONS.includes(action as ServiceAction)) {
    return { ok: false, error: `Unsupported action "${action}". Supported: ${SERVICE_ACTIONS.join(", ")}.` };
  }
  if (!UNIT_NAME.test(target)) {
    return { ok: false, error: `"${target}" is not a valid systemd unit name.` };
  }
  if (action !== "status" && !settings.allowedServices.includes(target)) {
    return { ok: false, error: `"${target}" is not in the allowed services list. Add it in Settings > Access before ${action} can run.` };
  }
  const pkexec = await pkexecPath();
  if (!pkexec) {
    return { ok: false, error: "pkexec (PolicyKit) was not found on this system. Install polkit, or this operation cannot authenticate." };
  }
  try {
    const { stdout } = await execFileAsync(pkexec, ["systemctl", action, target], { timeout: 30_000 });
    return { ok: true, stdout: stdout.slice(0, 4000) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.slice(0, 1000) };
  }
}

export interface HelperStatus {
  pkexecAvailable: boolean;
  allowedServiceCount: number;
}

export async function helperStatus(settings: BrokerSettings = loadBrokerSettings()): Promise<HelperStatus> {
  return { pkexecAvailable: (await pkexecPath()) !== null, allowedServiceCount: settings.allowedServices.length };
}

const UNIMPLEMENTED_OPERATIONS = new Set([
  "install-approved-package",
  "configure-approved-firewall-rule",
  "manage-approved-local-account",
  "mount-approved-filesystem",
  "apply-approved-security-policy",
]);

/**
 * linux-root-access-request's full operation enum. Only the two backed by
 * manageService actually run something; the rest fail closed, honestly,
 * rather than pretending to perform a package install or firewall change
 * this broker does not implement.
 */
export async function rootAccessRequest(operation: string, target: string): Promise<BrokerResult> {
  if (operation === "inspect-protected-system-state") return manageService("status", target);
  if (operation === "manage-approved-service") return manageService("start", target);
  if (UNIMPLEMENTED_OPERATIONS.has(operation)) {
    return { ok: false, error: `"${operation}" is not implemented. Only inspecting or starting an allowed systemd service is wired up; nothing else runs.` };
  }
  return { ok: false, error: `Unknown operation "${operation}".` };
}
