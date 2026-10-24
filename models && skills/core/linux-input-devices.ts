/**
 * Linux input-device enumeration: tells separate physical mice and
 * keyboards apart by reading /proc/bus/input/devices, which lists every
 * connected input device and its name -- something no browser API can do
 * at all (the DOM reports pointer/keyboard events with no device identity).
 *
 * Deliberately metadata-only. This does NOT open /dev/input/eventN to read
 * raw event streams: that would let the agent capture every keystroke and
 * click system-wide, including in windows that have nothing to do with it
 * -- a keylogging primitive this project chooses not to build, not one it
 * merely hasn't gotten to. "Which mouse/keyboard is plugged in" is answered
 * here; "what did you just type on it" is not, on purpose.
 */
import { existsSync, readFileSync } from "node:fs";

export type InputDeviceKind = "mouse" | "keyboard" | "other";

export interface InputDevice {
  /** The device's own name string, e.g. "Logitech USB Receiver". */
  name: string;
  /** Physical/topology string the kernel reports, when given. */
  phys: string;
  /** Kernel-registered handler names for this device (mouse0, kbd, event4, ...). */
  handlers: string[];
  kind: InputDeviceKind;
}

/** Parses /proc/bus/input/devices' block format. A pure function, independent of whether this process can actually read that file, so it is testable with a fixture. */
export function parseInputDevices(text: string): InputDevice[] {
  const devices: InputDevice[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const nameMatch = block.match(/^N: Name="([^"]*)"/m);
    if (!nameMatch) continue;
    const physMatch = block.match(/^P: Phys=(.*)$/m);
    const handlersMatch = block.match(/^H: Handlers=(.*)$/m);
    const handlers = (handlersMatch?.[1] ?? "").trim().split(/\s+/).filter(Boolean);
    const kind: InputDeviceKind = handlers.some((h) => h.startsWith("mouse"))
      ? "mouse"
      : handlers.some((h) => h.startsWith("kbd"))
        ? "keyboard"
        : "other";
    devices.push({ name: nameMatch[1], phys: (physMatch?.[1] ?? "").trim(), handlers, kind });
  }
  return devices;
}

export interface ListResult {
  available: boolean;
  reason?: string;
  devices: InputDevice[];
}

/** Lists connected input devices. Never throws: an unreadable or absent file (every non-Linux platform, or a Linux box with no /proc) comes back as available: false with why. */
export function listInputDevices(file = "/proc/bus/input/devices"): ListResult {
  if (!existsSync(file)) return { available: false, reason: `${file} does not exist (not Linux, or /proc is unavailable).`, devices: [] };
  try {
    return { available: true, devices: parseInputDevices(readFileSync(file, "utf8")) };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err), devices: [] };
  }
}

export function summarizeDevices(devices: InputDevice[]): { mice: number; keyboards: number; other: number } {
  return {
    mice: devices.filter((d) => d.kind === "mouse").length,
    keyboards: devices.filter((d) => d.kind === "keyboard").length,
    other: devices.filter((d) => d.kind === "other").length,
  };
}
