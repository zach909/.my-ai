/**
 * The agent's own workspace on this computer.
 *
 * The spec's central principle is "shared computer, separate interaction
 * contexts": the agent gets its own terminals, files and windows on the same
 * machine, while the user keeps theirs. This module is the agent's half. The
 * user's half is represented here only as something observable -- there is no
 * method anywhere in this file that types into, clicks on, or closes a user
 * window, and that absence is the boundary, not a setting.
 *
 * What makes this more than a shell wrapper is that sessions are coordinated
 * rather than isolated. Every command becomes an event, every session keeps
 * its output, and the agent can read any session from any other. That is what
 * lets it start a server in one terminal, run tests in a second, see the
 * failure, edit a file, and come back -- which is the worked example the spec
 * gives, and it is impossible if each command is a fire-and-forget round trip.
 *
 * Everything here goes through the AccessManager first. A capability that was
 * not granted is refused with the name of the capability and the level it
 * needed, because a permission error that does not say what to grant leaves
 * the caller nowhere to go.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AccessManager, type Capability } from "./access-manager.js";

/** Everything that can happen in the workspace, in the order it happened. */
export type WorkspaceEventKind =
  | "terminal.opened"
  | "terminal.closed"
  | "command.started"
  | "command.output"
  | "command.finished"
  | "file.read"
  | "file.written"
  | "file.deleted"
  | "denied";

export interface WorkspaceEvent {
  kind: WorkspaceEventKind;
  at: number;
  /** Which terminal, when the event belongs to one. */
  session?: string;
  detail: string;
  /** Present on command.finished. */
  exitCode?: number;
}

export interface TerminalSession {
  id: string;
  cwd: string;
  /** The command currently running, when one is. */
  running: string | null;
  /** Recent output, oldest first. Capped -- an unbounded log is a memory leak with extra steps. */
  output: string[];
  startedAt: number;
  lastActivity: number;
}

export interface CommandResult {
  session: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Wall-clock milliseconds, so the agent can notice something took far longer than expected. */
  durationMs: number;
  /**
   * Present only when output was dropped. Its absence means what is here is
   * everything the command said -- a truncated result that cannot be
   * distinguished from a complete one is worse than no result.
   */
  truncated?: { stdoutDropped: number; stderrDropped: number; keptBytes: number };
  /** Present only when the command was killed for exceeding its time limit. */
  timedOut?: boolean;
}

const MAX_OUTPUT_LINES = 500;
const MAX_EVENTS = 2000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
/**
 * How much of a command's output is kept.
 *
 * Measured: `yes | head -c 200000000` in one terminal grew the heap by 196MB,
 * because stdout was accumulated into a string with no limit while the
 * session's line buffer next to it was carefully capped. One `cat` of a large
 * file, or one runaway build log, was enough to take the process down.
 *
 * The head is kept rather than the tail: an agent reading command output is
 * usually looking for what a command said first -- the error it opened with --
 * and a truncation notice tells it plainly that there was more.
 */
const MAX_CAPTURED_BYTES = 2 * 1024 * 1024;

/**
 * A copy of a short string that does not retain the string it came from.
 *
 * V8 represents `big.slice(0, 200)` as a SlicedString that keeps the WHOLE
 * parent alive. Every command.output event stored exactly that -- a 200-char
 * excerpt of a multi-kilobyte chunk -- so the capped 2000-event ring was
 * quietly pinning up to 2000 whole chunks. Measured directly: 2000 such
 * slices of a 64KB string retain 125.1 MB; the same 2000 strings flattened
 * retain 0.5 MB.
 *
 * Round-tripping through a Buffer produces a genuinely independent string.
 * At 200 characters the copy costs nothing worth measuring.
 */
function detach(text: string): string {
  return Buffer.from(text, "utf8").toString("utf8");
}

export class WorkspaceError extends Error {}

/**
 * One agent workspace: its terminals, its files, its event stream.
 *
 * Deliberately not a singleton. The spec describes multiple workspaces
 * (Workspace 1, Workspace 2, User Workspace), and a module-level global would
 * make that impossible to express and impossible to test in isolation.
 */
export class AgentWorkspace {
  private sessions = new Map<string, TerminalSession>();
  private events: WorkspaceEvent[] = [];
  private processes = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(
    private readonly access: AccessManager,
    /** Where terminals start, and the root a confined file grant is relative to. */
    private readonly home: string = process.cwd(),
  ) {}

  // ── events ──────────────────────────────────────────────────────────────

  private record(event: Omit<WorkspaceEvent, "at">): void {
    this.events.push({ ...event, at: Date.now() });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  /**
   * The activity stream, newest last. Filterable by session so the agent can
   * ask "what happened in the test terminal" without reading everything.
   */
  eventStream(opts: { session?: string; kinds?: WorkspaceEventKind[]; limit?: number } = {}): WorkspaceEvent[] {
    const limit = Math.max(1, opts.limit ?? 100);
    return this.events
      .filter(e => (!opts.session || e.session === opts.session) && (!opts.kinds || opts.kinds.includes(e.kind)))
      .slice(-limit);
  }

  /** Refusals are events too -- an agent that cannot see its own denials cannot learn what it may do. */
  private deny(capability: Capability, err: unknown): never {
    const detail = err instanceof Error ? err.message : String(err);
    this.record({ kind: "denied", detail });
    throw err instanceof Error ? err : new WorkspaceError(detail);
  }

  private guard(capability: Capability, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.deny(capability, err);
    }
  }

  // ── terminals ───────────────────────────────────────────────────────────

  /** Open a terminal session. Many may be open at once; that is the point. */
  openTerminal(id: string, cwd?: string): TerminalSession {
    this.guard("terminal.open", () => this.access.require("terminal.open"));
    if (this.sessions.has(id)) throw new WorkspaceError(`A terminal called "${id}" is already open.`);

    const dir = path.resolve(cwd ?? this.home);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new WorkspaceError(`"${dir}" is not a directory.`);
    }
    const session: TerminalSession = {
      id,
      cwd: dir,
      running: null,
      output: [],
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.sessions.set(id, session);
    this.record({ kind: "terminal.opened", session: id, detail: dir });
    return session;
  }

  closeTerminal(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.processes.get(id)?.kill();
    this.processes.delete(id);
    this.sessions.delete(id);
    this.record({ kind: "terminal.closed", session: id, detail: "closed" });
    return true;
  }

  terminals(): TerminalSession[] {
    return [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  /**
   * Cross-terminal awareness: read any session's recent output from anywhere.
   *
   * This is the capability the worked example turns on -- tests fail in
   * terminal B, and the agent reasoning in terminal A has to be able to see
   * that. Without it the sessions are separate programs that happen to share a
   * process.
   */
  readTerminal(id: string, lines = 50): string[] {
    const session = this.sessions.get(id);
    if (!session) throw new WorkspaceError(`No terminal called "${id}".`);
    return session.output.slice(-Math.max(1, lines));
  }

  /**
   * Run a command in a session and wait for it.
   *
   * Uses an argument array rather than a shell string: commands can be
   * assembled from model output, and handing that to a shell is how a
   * filename with a semicolon in it becomes a second command.
   */
  async run(
    id: string,
    command: string,
    args: string[] = [],
    opts: { timeoutMs?: number } = {},
  ): Promise<CommandResult> {
    this.guard("terminal.execute", () => this.access.require("terminal.execute"));
    const session = this.sessions.get(id);
    if (!session) throw new WorkspaceError(`No terminal called "${id}". Open it first.`);
    if (session.running) throw new WorkspaceError(`"${id}" is busy running: ${session.running}`);

    const printable = [command, ...args].join(" ");
    session.running = printable;
    this.record({ kind: "command.started", session: id, detail: printable });
    const started = Date.now();

    const append = (chunk: string) => {
      const lines = chunk.split("\n");
      // Only the tail can survive a chunk anyway, so pushing every line of a
      // huge one just to shift it straight back out is work with no outcome.
      // A single `yes | head -c 200MB` produced ~7.4 million lines, each
      // pushed and then shifted off a 500-element array one at a time.
      const keep = lines.length > MAX_OUTPUT_LINES ? lines.slice(-MAX_OUTPUT_LINES) : lines;
      for (const line of keep) {
        if (line.length === 0) continue;
        // Detached for the same reason as the event detail above: these 500
        // lines outlive the chunk they came from, and a retained line that is
        // a view into a megabyte of output keeps the megabyte.
        session.output.push(line.length > 200 ? detach(line.slice(0, 4096)) : line);
      }
      // One splice instead of a shift per line: shift() is O(n) in the array
      // length and was being called once per line of output.
      if (session.output.length > MAX_OUTPUT_LINES) {
        session.output.splice(0, session.output.length - MAX_OUTPUT_LINES);
      }
      session.lastActivity = Date.now();
    };

    return await new Promise<CommandResult>(resolve => {
      const child = spawn(command, args, { cwd: session.cwd, env: process.env });
      this.processes.set(id, child as ChildProcessWithoutNullStreams);

      let stdout = "";
      let stderr = "";
      let stdoutDropped = 0;
      let stderrDropped = 0;
      let settled = false;
      let timedOut = false;

      // Appends up to the cap and counts what it had to drop, so the result
      // can say so instead of quietly returning a truncated answer as if it
      // were the whole thing.
      const capped = (current: string, addition: string): { text: string; dropped: number } => {
        const room = MAX_CAPTURED_BYTES - current.length;
        if (room <= 0) return { text: current, dropped: addition.length };
        if (addition.length <= room) return { text: current + addition, dropped: 0 };
        return { text: current + addition.slice(0, room), dropped: addition.length - room };
      };

      const timeoutMs = opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (!settled) {
          timedOut = true;
          child.kill("SIGKILL");
        }
      }, timeoutMs);

      child.stdout?.on("data", d => {
        const text = String(d);
        const r = capped(stdout, text);
        stdout = r.text;
        stdoutDropped += r.dropped;
        append(text);
        this.record({ kind: "command.output", session: id, detail: detach(text.trim().slice(0, 200)) });
      });
      child.stderr?.on("data", d => {
        const text = String(d);
        const r = capped(stderr, text);
        stderr = r.text;
        stderrDropped += r.dropped;
        append(text);
        this.record({ kind: "command.output", session: id, detail: detach(text.trim().slice(0, 200)) });
      });

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.processes.delete(id);
        session.running = null;
        session.lastActivity = Date.now();
        this.record({ kind: "command.finished", session: id, detail: printable, exitCode });
        resolve({
          session: id,
          command: printable,
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - started,
          ...(stdoutDropped > 0 || stderrDropped > 0
            ? { truncated: { stdoutDropped, stderrDropped, keptBytes: MAX_CAPTURED_BYTES } }
            : {}),
          ...(timedOut ? { timedOut: true } : {}),
        });
      };

      child.on("error", err => {
        // A command that could not start is a failed command, not a crash of
        // the workspace -- the agent needs the failure, not an exception.
        stderr += String(err);
        append(String(err));
        finish(127);
      });
      child.on("close", code => finish(code ?? 0));
    });
  }

  // ── files ───────────────────────────────────────────────────────────────

  private resolveInside(target: string): string {
    return path.resolve(this.home, target);
  }

  listDirectory(target: string): Array<{ name: string; directory: boolean; bytes: number }> {
    const full = this.resolveInside(target);
    this.guard("files.read", () => this.access.requirePath("files.read", full));
    if (!existsSync(full) || !statSync(full).isDirectory()) throw new WorkspaceError(`"${full}" is not a directory.`);
    return readdirSync(full).map(name => {
      const s = statSync(path.join(full, name));
      return { name, directory: s.isDirectory(), bytes: s.isFile() ? s.size : 0 };
    });
  }

  readFile(target: string): string {
    const full = this.resolveInside(target);
    this.guard("files.read", () => this.access.requirePath("files.read", full));
    if (!existsSync(full) || !statSync(full).isFile()) throw new WorkspaceError(`"${full}" is not a file.`);
    const text = readFileSync(full, "utf8");
    this.record({ kind: "file.read", detail: full });
    return text;
  }

  writeFile(target: string, content: string): void {
    const full = this.resolveInside(target);
    this.guard("files.write", () => this.access.requirePath("files.write", full));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
    this.record({ kind: "file.written", detail: full });
  }

  moveFile(from: string, to: string): void {
    const src = this.resolveInside(from);
    const dst = this.resolveInside(to);
    // Both ends are checked: a move is a write to the destination AND a
    // removal from the source, and confining only one of them would let a
    // confined grant relocate a file out of its own boundary.
    this.guard("files.write", () => {
      this.access.requirePath("files.write", src);
      this.access.requirePath("files.write", dst);
    });
    mkdirSync(path.dirname(dst), { recursive: true });
    renameSync(src, dst);
    this.record({ kind: "file.written", detail: `${src} -> ${dst}` });
  }

  deleteFile(target: string): void {
    const full = this.resolveInside(target);
    this.guard("files.delete", () => this.access.requirePath("files.delete", full));
    if (!existsSync(full)) throw new WorkspaceError(`"${full}" does not exist.`);
    rmSync(full, { recursive: true, force: true });
    this.record({ kind: "file.deleted", detail: full });
  }

  // ── shutting down ───────────────────────────────────────────────────────

  /** Closes every terminal and kills anything still running. */
  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.closeTerminal(id);
  }
}
