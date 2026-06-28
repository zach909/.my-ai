import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { EventEmitter } from 'node:events';
import os from 'node:os';

export interface ShellSession {
  id: string;
  pid: number | null;
  active: boolean;
  cwd: string;
  created: number;
  lastActivity: number;
}

export class PersistentShell extends EventEmitter {
  private sessions: Map<string, { proc: ChildProcess; rl: Interface; session: ShellSession }> = new Map();
  private shellPath: string;
  private nextId = 1;

  constructor() {
    super();
    this.shellPath = os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash';
  }

  createSession(cwd?: string): ShellSession {
    const id = `sh_${this.nextId++}`;
    const proc = spawn(this.shellPath, [], {
      cwd: cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env as Record<string, string>, TERM: 'xterm-256color', PS1: '\nNEURO_SHELL_READY\n' },
    });

    const session: ShellSession = {
      id, pid: proc.pid, active: true,
      cwd: cwd ?? process.cwd(),
      created: Date.now(), lastActivity: Date.now(),
    };

    const rl = createInterface({ input: proc.stdout!, terminal: false });
    let buffer = '';

    rl.on('line', (line: string) => {
      buffer += line + '\n';
      if (line.includes('NEURO_SHELL_READY')) {
        this.emit('ready', { sessionId: id, prompt: buffer });
        buffer = '';
      }
    });

    proc.stdout?.on('data', (data: Buffer) => {
      session.lastActivity = Date.now();
      this.emit('output', { sessionId: id, data: data.toString() });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      session.lastActivity = Date.now();
      this.emit('output', { sessionId: id, data: data.toString(), stream: 'stderr' });
    });

    proc.on('exit', (code) => {
      session.active = false;
      this.emit('exit', { sessionId: id, code });
      this.sessions.delete(id);
    });

    proc.on('error', (err) => {
      session.active = false;
      this.emit('error', { sessionId: id, error: err.message });
    });

    this.sessions.set(id, { proc, rl, session });
    this.emit('created', { sessionId: id, pid: proc.pid });
    return session;
  }

  async exec(sessionId: string, command: string, timeout = 30000): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    if (!s.session.active) throw new Error(`Session ${sessionId} is closed`);

    s.session.lastActivity = Date.now();
    return new Promise((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      let resolved = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const onData = (data: string) => { stdout.push(data); };
      const onErr = (data: string) => { stderr.push(data); };
      const onExit = (code: number | null) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({ stdout: stdout.join(''), stderr: stderr.join(''), exitCode: code });
      };

      const onOutput = (info: { sessionId: string; data: string; stream?: string }) => {
        if (info.sessionId !== sessionId) return;
        if (info.stream === 'stderr') stderr.push(info.data);
        else stdout.push(info.data);
      };

      const onReady = (info: { sessionId: string }) => {
        if (info.sessionId !== sessionId || resolved) return;
        resolved = true;
        cleanup();
        resolve({ stdout: stdout.join(''), stderr: stderr.join(''), exitCode: 0 });
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.removeListener('output', onOutput);
        this.removeListener('ready', onReady);
        this.removeListener('exit', onExit);
      };

      if (timeout > 0) {
        timer = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          cleanup();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }

      this.on('output', onOutput);
      this.on('ready', onReady);
      this.on('exit', onExit);

      // Send command followed by a marker to detect completion
      const marker = `ECHO NEURO_DONE_${Date.now()}`;
      s.proc.stdin?.write(`${command}\n`);
      s.proc.stdin?.write(`echo "${marker}"\n`);
    });
  }

  async execSync(command: string, timeout = 30000): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const session = this.createSession();
    try {
      const result = await this.exec(session.id, command, timeout);
      return result;
    } finally {
      this.destroySession(session.id);
    }
  }

  writeStdin(sessionId: string, input: string): void {
    const s = this.sessions.get(sessionId);
    if (!s || !s.session.active) throw new Error(`Session ${sessionId} not active`);
    s.session.lastActivity = Date.now();
    s.proc.stdin?.write(input);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId);
    if (!s || !s.session.active) return;
    s.proc.stdout?.setEncoding('utf8');
    if (process.stdout.isTTY) {
      process.stdout.columns = cols;
      process.stdout.rows = rows;
    }
  }

  destroySession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.session.active = false;
    s.rl.close();
    s.proc.kill('SIGTERM');
    setTimeout(() => {
      try { s.proc.kill('SIGKILL'); } catch { }
    }, 2000);
    this.sessions.delete(sessionId);
    this.emit('destroyed', { sessionId });
  }

  destroyAll(): void {
    for (const [id] of this.sessions) this.destroySession(id);
  }

  getSession(sessionId: string): ShellSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  listSessions(): ShellSession[] {
    return Array.from(this.sessions.values()).map(s => s.session);
  }

  getActiveCount(): number {
    return Array.from(this.sessions.values()).filter(s => s.session.active).length;
  }
}
