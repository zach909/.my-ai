/**
 * macOS input-device enumeration, via `ioreg`'s own, pre-installed IOKit
 * registry dump (`ioreg -c IOHIDDevice -r -l`) -- ships on every Mac;
 * shelling out to it is the same kind of "OS-provided tool" this project
 * already shells out to elsewhere (pkexec on Linux, PowerShell on
 * Windows), not third-party code. Each HID device ioreg reports carries a
 * standard USB-HID "usage page"/"usage" pair (part of the public USB-IF
 * HID Usage Tables spec, not an Apple API): usage page 1 ("Generic
 * Desktop"), usage 2 is a mouse and usage 6 is a keyboard. That lets this
 * module count and name connected mice/keyboards -- something no browser
 * API can do at all.
 *
 * Deliberately metadata-only, matching linux-input-devices.ts and
 * windows-input-devices.ts: this never reads IOHIDManager's live input
 * value stream. That needs native (Objective-C/Swift) code this project's
 * macOS package does not have (NeuroClaw.app is only the bundled Node
 * runtime in a WKWebView window -- see docs/PLATFORMS.md), and even if it
 * did, reading live key/pointer events would make the agent a
 * system-wide keylogger -- a line this project does not cross, on any
 * platform. "Which mouse/keyboard is plugged in" is answered here; "what
 * did you just type on it" is not, on purpose.
 *
 * NOT RUN OR VERIFIED in this repository's own development sandbox: that
 * sandbox is Linux, with no Mac to run `ioreg` against. Written carefully
 * from ioreg's documented/known output shape and syntax-checked, same
 * caveat as this project's uncompiled Android Kotlin / iOS Swift edits --
 * see docs/PLATFORMS.md, "Tests: what ran, what did not".
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type InputDeviceKind = "mouse" | "keyboard" | "other";

export interface InputDevice {
  /** The device's own name, from ioreg's "Product" field. */
  name: string;
  kind: InputDeviceKind;
}

/** HID usage page 1 ("Generic Desktop"), per the USB-IF HID Usage Tables. */
const GENERIC_DESKTOP_PAGE = 1;
const USAGE_MOUSE = 2;
const USAGE_KEYBOARD = 6;

/**
 * Parses `ioreg -c IOHIDDevice -r -l` text output: one block per device,
 * each starting at a "+-o <name> <class ...>" header line (however deeply
 * indented in the tree) and containing "Product"/"PrimaryUsagePage"/
 * "PrimaryUsage" key-value lines. A pure function, testable with a
 * fixture string independent of whether ioreg is actually available.
 */
export function parseIoregOutput(text: string): InputDevice[] {
  const devices: InputDevice[] = [];
  const blocks = text.split(/\n(?=\s*\+-o )/);
  for (const block of blocks) {
    const productMatch = block.match(/"Product"\s*=\s*"([^"]*)"/);
    if (!productMatch) continue;
    const pageMatch = block.match(/"PrimaryUsagePage"\s*=\s*(\d+)/);
    const usageMatch = block.match(/"PrimaryUsage"\s*=\s*(\d+)/);
    const page = pageMatch ? Number(pageMatch[1]) : null;
    const usage = usageMatch ? Number(usageMatch[1]) : null;
    const kind: InputDeviceKind =
      page === GENERIC_DESKTOP_PAGE && usage === USAGE_MOUSE ? "mouse"
      : page === GENERIC_DESKTOP_PAGE && usage === USAGE_KEYBOARD ? "keyboard"
      : "other";
    devices.push({ name: productMatch[1], kind });
  }
  return devices;
}

export interface ListResult {
  available: boolean;
  reason?: string;
  devices: InputDevice[];
}

/**
 * Lists connected mice and keyboards by shelling out to `ioreg`. Never
 * throws: not being on macOS, or ioreg failing for any reason, comes back
 * as available: false with why, rather than crashing the caller.
 */
export async function listInputDevices(): Promise<ListResult> {
  if (process.platform !== "darwin") {
    return { available: false, reason: "Not macOS: ioreg's IOHIDDevice registry only exists there.", devices: [] };
  }
  try {
    const { stdout } = await execFileAsync("ioreg", ["-c", "IOHIDDevice", "-r", "-l"], { timeout: 10_000 });
    return { available: true, devices: parseIoregOutput(stdout) };
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
