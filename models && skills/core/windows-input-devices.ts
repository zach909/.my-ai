/**
 * Windows input-device enumeration, via PowerShell's own, pre-installed
 * Win32_PointingDevice and Win32_Keyboard WMI classes -- every Windows
 * install ships PowerShell and WMI; shelling out to them is the same kind
 * of "OS-provided tool" this project already shells out to elsewhere
 * (pkexec on Linux, IExpress for the Windows installer), not third-party
 * code. Counts and names connected mice/keyboards -- something no browser
 * API can do at all.
 *
 * Deliberately metadata-only, matching linux-input-devices.ts: this never
 * calls the Win32 Raw Input API (WM_INPUT / RegisterRawInputDevices) to
 * read live pointer/key events. That would need a native addon this
 * project's architecture does not have (no Electron, no node-gyp build),
 * and even if it did, it would make the agent a system-wide keylogger --
 * a line this project does not cross, on any platform. "Which
 * mouse/keyboard is plugged in" is answered here; "what did you just type
 * on it" is not, on purpose.
 *
 * NOT RUN OR VERIFIED in this repository's own development sandbox: that
 * sandbox is Linux, with no Windows host to run `powershell.exe` against.
 * Written carefully and syntax-checked, same caveat as this project's
 * uncompiled Android Kotlin / iOS Swift edits -- see docs/PLATFORMS.md,
 * "Tests: what ran, what did not".
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type InputDeviceKind = "mouse" | "keyboard";

export interface InputDevice {
  /** The device's own name, from WMI's Name (falling back to Caption). */
  name: string;
  kind: InputDeviceKind;
}

interface WmiRow {
  Name?: string;
  Caption?: string;
}

function toRows(parsed: unknown): WmiRow[] {
  if (Array.isArray(parsed)) return parsed as WmiRow[];
  if (parsed && typeof parsed === "object") return [parsed as WmiRow];
  return [];
}

/**
 * Parses what `Get-CimInstance ... | Select-Object Name,Caption |
 * ConvertTo-Json -Compress` prints: a JSON object for one result, or a
 * JSON array for several. A pure function, testable with a fixture string
 * independent of whether PowerShell is actually available.
 */
export function parseWmiDeviceNames(json: string): string[] {
  if (!json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  return toRows(parsed)
    .map((row) => row.Name || row.Caption || "")
    .filter((name) => name.length > 0);
}

export interface ListResult {
  available: boolean;
  reason?: string;
  devices: InputDevice[];
}

const psCommand = (wmiClass: string): string =>
  `Get-CimInstance -ClassName ${wmiClass} | Select-Object Name,Caption | ConvertTo-Json -Compress`;

async function wmiDeviceNames(wmiClass: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", psCommand(wmiClass)],
    { timeout: 10_000 },
  );
  return parseWmiDeviceNames(stdout);
}

/**
 * Lists connected mice and keyboards by shelling out to PowerShell's own
 * Win32_PointingDevice / Win32_Keyboard WMI classes. Never throws: not
 * being on Windows, or PowerShell failing for any reason, comes back as
 * available: false with why, rather than crashing the caller.
 */
export async function listInputDevices(): Promise<ListResult> {
  if (process.platform !== "win32") {
    return { available: false, reason: "Not Windows: Win32_PointingDevice/Win32_Keyboard only exist there.", devices: [] };
  }
  try {
    const [mice, keyboards] = await Promise.all([
      wmiDeviceNames("Win32_PointingDevice"),
      wmiDeviceNames("Win32_Keyboard"),
    ]);
    const devices: InputDevice[] = [
      ...mice.map((name): InputDevice => ({ name, kind: "mouse" })),
      ...keyboards.map((name): InputDevice => ({ name, kind: "keyboard" })),
    ];
    return { available: true, devices };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err), devices: [] };
  }
}

export function summarizeDevices(devices: InputDevice[]): { mice: number; keyboards: number } {
  return {
    mice: devices.filter((d) => d.kind === "mouse").length,
    keyboards: devices.filter((d) => d.kind === "keyboard").length,
  };
}
