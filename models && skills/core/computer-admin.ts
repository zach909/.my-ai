/**
 * Is the person running this server the computer's administrator?
 *
 * The admin of NeuroClaw is the computer's own administrator: the one who sets
 * the machine up. They set this up once, from the machine, and after that
 * everyone gets access by signing up. This asks the operating system, with its
 * own commands and nothing else, whether the account the server runs as is an
 * administrator:
 *
 *   Linux and macOS   root, or a member of the sudo, wheel, admin or root group
 *   Windows           a member of the built-in Administrators group
 *
 * It says no whenever it cannot tell. A "no" is not a dead end: the setup code
 * the server prints on its console still sets it up, because only someone with
 * the console can read it.
 */

import { execFileSync } from "node:child_process";
import os from "node:os";

export interface AdminProbe {
  platform: NodeJS.Platform;
  /** The effective user id, where the platform has one. */
  uid: number | null;
  /** Runs a program and gives back what it printed, or throws. */
  run(file: string, args: string[]): string;
}

const ADMIN_GROUPS = new Set(["root", "sudo", "wheel", "admin"]);
const WINDOWS_ADMINS_SID = "S-1-5-32-544";

const realProbe = (): AdminProbe => ({
  platform: process.platform,
  uid: typeof process.geteuid === "function" ? process.geteuid() : null,
  run: (file, args) => execFileSync(file, args, { encoding: "utf8", timeout: 4000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }),
});

export function checkComputerAdministrator(probe: AdminProbe): boolean {
  try {
    if (probe.platform === "win32") return probe.run("whoami", ["/groups"]).includes(WINDOWS_ADMINS_SID);
    if (probe.uid === 0) return true;
    return probe
      .run("id", ["-Gn"])
      .split(/\s+/)
      .some(g => ADMIN_GROUPS.has(g));
  } catch {
    return false;
  }
}

let cached: boolean | null = null;

/** Whether this process runs as a computer administrator. Asked once; the answer does not change while the server runs. */
export function isComputerAdministrator(): boolean {
  if (cached === null) cached = checkComputerAdministrator(realProbe());
  return cached;
}

/** Tests drop the remembered answer. */
export function resetComputerAdministrator(): void {
  cached = null;
}

/** The name of the account the server runs as, for the page to say who it thinks you are. */
export function runningAs(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "this account";
  }
}
