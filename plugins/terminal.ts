/**
 * Terminal plugin — execute shell commands with output capture.
 *
 * Runs commands via a real subprocess. A best-effort blocklist rejects the
 * specific destructive patterns named below (rm -rf on a root-like path,
 * mkfs, a fork bomb, shutdown/reboot/halt/poweroff, dd writing to a raw
 * disk device) before handing the command to the shell. This is NOT a
 * security boundary: a blocklist over free-form shell text can never
 * enumerate every way to destroy a filesystem (a node one-liner,
 * `find -delete`, `truncate`, overwriting a device via `cp`, ...), and
 * quoting/escaping/subshells can obscure a command from these patterns
 * entirely. Treat this as a guardrail against the most common catastrophic
 * accidents, not protection against a deliberately hostile command.
 *
 * Ported from the (already real, already tested) Python track's
 * plugins/plugin_terminal.py so the same guardrail logic and tool surface
 * (run/run_bg/which/env) exists on the live TS/web app side too, where
 * 'terminal' was already referenced as a dispatch candidate (plugin_manager/
 * registry.ts's intentToPlugins `command` bucket) but never actually
 * implemented or registered.
 */
import { exec, spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { PluginDefinition } from "../plugin_manager/types.js";
import { ToolPlugin } from "../plugin_manager/sdk.js";

const execAsync = promisify(exec);

const FORK_BOMB = /:\(\)\{\s*[:\s|&]+\};:/;
const DANGEROUS_SIMPLE = /\bmkfs|\bshutdown|\breboot|\bhalt|\bpoweroff/i;
const DD_RAW_DISK = /\bdd\b.*\bof=\/dev\/(sd[a-z]|nvme|mmcblk)/i;
const SENSITIVE_ENV_PATTERN =
  /key|secret|password|token|auth|pass|credential|cert|cookie|jwt|hash|salt|ssh|database|db_|session|bearer|sig|private/i;

// `rm -rf /` matched literally would miss trivial variants: trailing
// content after the slash (`rm -rf /*`, `rm -rf //`), reordered short
// flags (`rm -fr`), separated flags (`rm -r -f`), and long-form flags
// (`rm --recursive --force`). Matched independently instead, mirroring
// plugin_terminal.py's _is_blocked() exactly: the command name `rm`, a
// recursive indicator, a force indicator, and a root-like target (just
// slashes, optionally followed by a wildcard or single `.`) can each
// appear anywhere in the string and in any order/spacing.
const RM_CMD = /\brm\b/i;
const RM_RECURSIVE = /(?<![\w-])-[a-zA-Z]*r[a-zA-Z]*(?![\w-])|--recursive\b/i;
const RM_FORCE = /(?<![\w-])-[a-zA-Z]*f[a-zA-Z]*(?![\w-])|--force\b/i;
const ROOT_LIKE_PATH = /(?<!\S)\/+[*.]{0,3}(?=\s|$|;|&|\|)/;

export function isBlockedCommand(cmd: string): boolean {
  if (FORK_BOMB.test(cmd) || DANGEROUS_SIMPLE.test(cmd) || DD_RAW_DISK.test(cmd)) return true;
  if (RM_CMD.test(cmd) && RM_RECURSIVE.test(cmd) && RM_FORCE.test(cmd) && ROOT_LIKE_PATH.test(cmd)) return true;
  return false;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  returncode: number | null;
  error?: string;
}

/** How much of a background terminal's output is kept readable, per stream. */
const SESSION_BUFFER_CHARS = 64_000;

/** One background terminal, and what it has said so far. */
export interface TerminalSession {
  pid: number;
  command: string;
  cwd?: string;
  running: boolean;
  exitCode: number | null;
  signal: string | null;
  startedAt: number;
  endedAt?: number;
  stdout: string;
  stderr: string;
  /** True when the buffer dropped the oldest output to stay bounded. */
  truncated: boolean;
}

/** Past this, read_file hands back the head and says it stopped. */
const READ_FILE_LIMIT_CHARS = 256_000;

function textArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  return value;
}

function optionalText(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export class TerminalPlugin extends ToolPlugin {
  private bgProcs: ChildProcess[] = [];
  /**
   * What every background terminal has said, kept readable.
   *
   * runBg() span with stdio: "ignore", so a background terminal's output was
   * discarded by the operating system before anything could look at it. The
   * agent got a process id and nothing else -- no logs, no errors, no exit
   * code. "If a development server running in one terminal crashes, the AI
   * can detect the event and respond from another terminal" was not possible:
   * the crash went to /dev/null.
   *
   * Bounded per stream, and the oldest output goes first, because a server
   * left running for a day must not become the reason the process runs out of
   * memory. Losing the start of a long log is a smaller loss than losing the
   * machine.
   */
  private sessions: Map<number, TerminalSession> = new Map();

  constructor(definition: PluginDefinition) {
    super(definition);
    this.defineTools();
  }

  /**
   * The terminal's tools. Each is one output neuron in the network (see
   * models && skills/core/tool-neurons.ts), so each is one nameable action.
   *
   * The file tools live here rather than only in the file-system plugin
   * because a terminal session is where files get written in practice -- a
   * build writes output, a script needs a config -- and "write a new file" is
   * the action the network most needs as a single neuron of its own.
   */
  private defineTools(): void {
    this.defineTool({
      name: "run",
      description: "Run a shell command and wait for it to finish.",
      args: ["command"],
      optionalArgs: ["cwd", "timeoutMs"],
      capability: "terminal.execute",
      run: async args => this.run(textArg(args, "command"), {
        cwd: optionalText(args, "cwd"),
        timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
      }),
    });
    this.defineTool({
      name: "run_background",
      description: "Start a shell command in its own background terminal and return its process id.",
      args: ["command"],
      optionalArgs: ["cwd"],
      capability: "terminal.execute",
      run: async args => ({ pid: this.runBg(textArg(args, "command"), optionalText(args, "cwd")) }),
    });
    this.defineTool({
      name: "list_terminals",
      description: "Every background terminal and whether it is still running.",
      args: [],
      capability: "terminal.open",
      run: async () => this.terminals().map(({ stdout: _out, stderr: _err, ...rest }) => rest),
    });
    this.defineTool({
      name: "read_terminal",
      description: "What one background terminal has printed so far.",
      args: ["pid"],
      capability: "terminal.open",
      run: async args => {
        const session = this.terminal(Number(args.pid));
        if (!session) throw new Error(`No background terminal with pid ${String(args.pid)}.`);
        return session;
      },
    });
    this.defineTool({
      name: "write_file",
      description: "Write a new file (or replace one), creating its folder if needed.",
      args: ["path", "content"],
      optionalArgs: ["cwd"],
      capability: "files.write",
      run: async args => {
        const full = resolve(optionalText(args, "cwd") ?? process.cwd(), textArg(args, "path"));
        mkdirSync(dirname(full), { recursive: true });
        const content = textArg(args, "content");
        writeFileSync(full, content, "utf8");
        return { path: full, bytes: Buffer.byteLength(content, "utf8") };
      },
    });
    this.defineTool({
      name: "read_file",
      description: "Read a text file.",
      args: ["path"],
      optionalArgs: ["cwd"],
      capability: "files.read",
      run: async args => {
        const full = resolve(optionalText(args, "cwd") ?? process.cwd(), textArg(args, "path"));
        if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`"${full}" is not a file.`);
        const text = readFileSync(full, "utf8");
        return text.length > READ_FILE_LIMIT_CHARS
          ? { path: full, content: text.slice(0, READ_FILE_LIMIT_CHARS), truncated: text.length - READ_FILE_LIMIT_CHARS }
          : { path: full, content: text };
      },
    });
    this.defineTool({
      name: "list_directory",
      description: "What is in a folder.",
      args: ["path"],
      optionalArgs: ["cwd"],
      capability: "files.read",
      run: async args => {
        const full = resolve(optionalText(args, "cwd") ?? process.cwd(), textArg(args, "path"));
        if (!existsSync(full) || !statSync(full).isDirectory()) throw new Error(`"${full}" is not a directory.`);
        return readdirSync(full).map(name => ({ name, directory: statSync(join(full, name)).isDirectory() }));
      },
    });
    this.defineTool({
      name: "which",
      description: "Where a program is installed, or null when it is not.",
      args: ["name"],
      capability: "system.info",
      run: async args => this.which(textArg(args, "name")),
    });
  }

  async run(cmd: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
    if (isBlockedCommand(cmd)) {
      return { stdout: "", stderr: "", returncode: null, error: "Blocked: destructive command pattern detected" };
    }
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 30_000,
      });
      return { stdout, stderr, returncode: 0 };
    } catch (err: unknown) {
      const e = err as { code?: number; killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
      if (e.killed) {
        return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", returncode: null, error: `Timeout after ${(opts.timeoutMs ?? 30_000) / 1000}s` };
      }
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", returncode: typeof e.code === "number" ? e.code : null, error: e.message };
    }
  }

  /** Starts a background process, returns its PID. Throws if blocked. */
  runBg(cmd: string, cwd?: string): number {
    if (isBlockedCommand(cmd)) {
      throw new Error("Blocked: destructive command pattern detected");
    }
    // Piped, not ignored: a terminal nobody can read is not a terminal the
    // agent can work with.
    const proc = spawn(cmd, { shell: true, cwd, stdio: ["ignore", "pipe", "pipe"] });
    this.bgProcs.push(proc);
    if (proc.pid === undefined) throw new Error("Failed to start background process");

    const session: TerminalSession = {
      pid: proc.pid,
      command: cmd,
      cwd,
      running: true,
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      stdout: "",
      stderr: "",
      truncated: false,
    };
    this.sessions.set(proc.pid, session);

    const append = (stream: "stdout" | "stderr", chunk: Buffer | string): void => {
      const text = session[stream] + String(chunk);
      if (text.length > SESSION_BUFFER_CHARS) {
        session[stream] = text.slice(text.length - SESSION_BUFFER_CHARS);
        session.truncated = true;
      } else {
        session[stream] = text;
      }
    };
    proc.stdout?.on("data", chunk => append("stdout", chunk));
    proc.stderr?.on("data", chunk => append("stderr", chunk));
    proc.on("exit", (code, signal) => {
      session.running = false;
      session.exitCode = code;
      session.signal = signal ?? null;
      session.endedAt = Date.now();
    });
    proc.on("error", err => {
      append("stderr", `\n${err.message}\n`);
      session.running = false;
      session.endedAt = Date.now();
    });

    return proc.pid;
  }

  /**
   * Every background terminal and what it is doing.
   *
   * This is the cross-terminal awareness the architecture asks for: one
   * terminal running a server, another running tests, and the agent able to
   * see what happened in either from wherever it currently is.
   */
  terminals(): TerminalSession[] {
    return Array.from(this.sessions.values(), session => ({ ...session }));
  }

  /** One background terminal, or null when no such session was started here. */
  terminal(pid: number): TerminalSession | null {
    const session = this.sessions.get(pid);
    return session ? { ...session } : null;
  }

  /**
   * Forget a finished terminal.
   *
   * Only a finished one: dropping the record of a process that is still
   * running would leave it going with nothing watching it.
   */
  forgetTerminal(pid: number): boolean {
    const session = this.sessions.get(pid);
    if (!session || session.running) return false;
    this.sessions.delete(pid);
    return true;
  }

  which(name: string): string | null {
    return execWhichSync(name);
  }

  env(varName?: string): Record<string, string | undefined> {
    if (varName) {
      if (SENSITIVE_ENV_PATTERN.test(varName)) {
        throw new Error(`Security Error: Access to sensitive environment variable is blocked: ${varName}`);
      }
      return { [varName]: process.env[varName] };
    }
    const safeEnv: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!SENSITIVE_ENV_PATTERN.test(k)) safeEnv[k] = v;
    }
    return safeEnv;
  }

  /**
   * Colon is optional -- "run: ls -la" and "run ls -la" both work, so
   * "you say run and then you say [the] command" (however it's punctuated)
   * reaches real execution. Returns null (not the echoed input) when the
   * message isn't actually a run-prefixed command, so dispatch()'s
   * 'command' bucket correctly falls through to the next candidate
   * (skill-maker/wiki/etc for "make a skill"-shaped messages) instead of
   * this plugin trivially "succeeding" on everything routed to it.
   */
  override async onMessage(message: unknown): Promise<unknown> {
    const input = typeof message === "string" ? message : String(message ?? "");
    const m = input.match(/^(run|exec|execute|shell|terminal)\s*:?\s+([\s\S]+)$/i);
    if (!m) return null;
    // Through callTool, not run() directly: a command typed in chat is a call
    // of the "run" tool like any other, so the network hears about it on the
    // run neuron and gets the output back on the terminal's result channel.
    const event = await this.callTool("run", { command: m[2] }, "message");
    return event.ok ? event.result : { stdout: "", stderr: "", returncode: null, error: event.error };
  }

  async onHealthCheck(): Promise<boolean> {
    return this.active;
  }
}

/** Cross-platform `which`/`where` lookup, matching Python's shutil.which() semantics (returns null rather than throwing when the binary isn't found). */
function execWhichSync(name: string): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(cmd, [name], { encoding: "utf8" }).trim();
    return out.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}
