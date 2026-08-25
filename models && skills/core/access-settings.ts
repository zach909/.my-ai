/**
 * Where the access switches live between runs.
 *
 * A kill switch that forgets it was thrown is not a kill switch. If someone
 * turns the desktop layer off and the next launch quietly turns it back on,
 * the switch was decoration. So the state is written to disk the moment it
 * changes, and read back before anything that checks a capability runs.
 *
 * Grants are persisted alongside the switches for the same reason, with one
 * asymmetry that is on purpose: an unreadable or corrupt settings file falls
 * back to the safe defaults rather than to "allow", and a file that says
 * nothing about a switch is treated as ON only because switches govern grants
 * that are themselves deny-by-default. Nothing here can widen access beyond
 * what was explicitly granted.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ACCESS_SWITCHES,
  AccessManager,
  CAPABILITIES,
  CAPABILITY_MINIMUM,
  CAPABILITY_SWITCH,
  SWITCH_DESCRIPTION,
  SWITCH_LABEL,
  defaultGrants,
  type AccessGrant,
  type AccessLevel,
  type AccessSwitch,
  type Capability,
} from "./access-manager.js";

export function accessSettingsPath(): string {
  // Overridable so tests never touch the real one.
  return process.env.CORONA_ACCESS_FILE
    ? path.resolve(process.env.CORONA_ACCESS_FILE)
    : path.resolve(process.cwd(), "config", "access.json");
}

export interface AccessSettings {
  switches: Record<AccessSwitch, boolean>;
  grants: AccessGrant[];
}

function defaultSwitches(): Record<AccessSwitch, boolean> {
  return { all: true, desktop: true, workspace: true };
}

export function defaultSettings(): AccessSettings {
  return { switches: defaultSwitches(), grants: defaultGrants() };
}

/** Never throws. A settings file we cannot understand means defaults, not a crash at boot. */
export function loadSettings(file = accessSettingsPath()): AccessSettings {
  if (!existsSync(file)) return defaultSettings();
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AccessSettings>;
    const switches = defaultSwitches();
    for (const name of ACCESS_SWITCHES) {
      const value = raw.switches?.[name];
      if (typeof value === "boolean") switches[name] = value;
    }
    // Unknown capability names are dropped rather than carried: a renamed
    // capability must not come back as a grant nothing checks.
    const grants = (Array.isArray(raw.grants) ? raw.grants : []).filter(
      (g): g is AccessGrant =>
        Boolean(g) && (CAPABILITIES as readonly string[]).includes(g.capability) && typeof g.level === "string",
    );
    return { switches, grants: grants.length > 0 ? grants : defaultGrants() };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AccessSettings, file = accessSettingsPath()): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

/**
 * An AccessManager backed by the settings file: reads it at construction, and
 * writes back whenever a switch flips.
 */
export function loadAccessManager(file = accessSettingsPath()): AccessManager {
  const settings = loadSettings(file);
  const manager = new AccessManager([], settings.switches);
  for (const grant of settings.grants) {
    // A grant below its capability's minimum throws; skip it rather than
    // refusing to start, since the rest of the file is still usable.
    try {
      manager.grant(grant);
    } catch {
      /* ignore an invalid stored grant */
    }
  }
  manager.onSwitchChange(switches => saveSettings({ switches, grants: manager.list() }, file));
  return manager;
}

let shared: AccessManager | null = null;

/** The one the running system uses. */
export function sharedAccessManager(): AccessManager {
  if (!shared) shared = loadAccessManager();
  return shared;
}

/** Tests and the settings route both need to drop the cached instance. */
export function resetSharedAccessManager(): void {
  shared = null;
}

export interface CapabilityView {
  capability: Capability;
  level: AccessLevel | null;
  minimum: AccessLevel;
  switch: Exclude<AccessSwitch, "all">;
  /** True only when the grant AND every switch above it allow it. */
  effective: boolean;
  /** Set when a switch is why this is off, so the UI can say so rather than blaming the grant. */
  blockedBySwitch: AccessSwitch | null;
}

export interface SwitchView {
  name: AccessSwitch;
  label: string;
  description: string;
  on: boolean;
  /** False when a switch above this one is off, so the UI can show it as overridden. */
  effective: boolean;
}

/** Everything a settings screen needs, in one shape. */
export function describeAccess(manager: AccessManager): { switches: SwitchView[]; capabilities: CapabilityView[] } {
  const state = manager.switchState();
  const switches: SwitchView[] = ACCESS_SWITCHES.map(name => ({
    name,
    label: SWITCH_LABEL[name],
    description: SWITCH_DESCRIPTION[name],
    on: state[name],
    effective: name === "all" ? state.all : state.all && state[name],
  }));

  const capabilities: CapabilityView[] = CAPABILITIES.map(capability => {
    const group = CAPABILITY_SWITCH[capability];
    const blockedBySwitch: AccessSwitch | null = !state.all ? "all" : state[group] ? null : group;
    return {
      capability,
      level: manager.granted(capability),
      minimum: CAPABILITY_MINIMUM[capability],
      switch: group,
      effective: manager.allows(capability),
      blockedBySwitch,
    };
  });

  return { switches, capabilities };
}
