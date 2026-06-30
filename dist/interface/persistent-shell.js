import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import os from 'node:os';
export class PersistentShell extends EventEmitter {
    sessions = new Map();
    shellPath;
    nextId = 1;
    constructor() {
        super();
        this.shellPath = os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash';
    }
    createSession(cwd) {
        const id = `sh_${this.nextId++}`;
        const proc = spawn(this.shellPath, [], {
            cwd: cwd ?? process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, TERM: 'xterm-256color', PS1: '\nNEURO_SHELL_READY\n' },
        });
        const session = {
            id, pid: proc.pid, active: true,
            cwd: cwd ?? process.cwd(),
            created: Date.now(), lastActivity: Date.now(),
        };
        const rl = createInterface({ input: proc.stdout, terminal: false });
        let buffer = '';
        rl.on('line', (line) => {
            buffer += line + '\n';
            if (line.includes('NEURO_SHELL_READY')) {
                this.emit('ready', { sessionId: id, prompt: buffer });
                buffer = '';
            }
        });
        proc.stdout?.on('data', (data) => {
            session.lastActivity = Date.now();
            this.emit('output', { sessionId: id, data: data.toString() });
        });
        proc.stderr?.on('data', (data) => {
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
    async exec(sessionId, command, timeout = 30000) {
        const s = this.sessions.get(sessionId);
        if (!s)
            throw new Error(`Session ${sessionId} not found`);
        if (!s.session.active)
            throw new Error(`Session ${sessionId} is closed`);
        s.session.lastActivity = Date.now();
        return new Promise((resolve, reject) => {
            const stdout = [];
            const stderr = [];
            let resolved = false;
            let timer = null;
            const onData = (data) => { stdout.push(data); };
            const onErr = (data) => { stderr.push(data); };
            const onExit = (code) => {
                if (resolved)
                    return;
                resolved = true;
                cleanup();
                resolve({ stdout: stdout.join(''), stderr: stderr.join(''), exitCode: code });
            };
            const onOutput = (info) => {
                if (info.sessionId !== sessionId)
                    return;
                if (info.stream === 'stderr')
                    stderr.push(info.data);
                else
                    stdout.push(info.data);
            };
            const onReady = (info) => {
                if (info.sessionId !== sessionId || resolved)
                    return;
                resolved = true;
                cleanup();
                resolve({ stdout: stdout.join(''), stderr: stderr.join(''), exitCode: 0 });
            };
            const cleanup = () => {
                if (timer)
                    clearTimeout(timer);
                this.removeListener('output', onOutput);
                this.removeListener('ready', onReady);
                this.removeListener('exit', onExit);
            };
            if (timeout > 0) {
                timer = setTimeout(() => {
                    if (resolved)
                        return;
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
    async execSync(command, timeout = 30000) {
        const session = this.createSession();
        try {
            const result = await this.exec(session.id, command, timeout);
            return result;
        }
        finally {
            this.destroySession(session.id);
        }
    }
    writeStdin(sessionId, input) {
        const s = this.sessions.get(sessionId);
        if (!s || !s.session.active)
            throw new Error(`Session ${sessionId} not active`);
        s.session.lastActivity = Date.now();
        s.proc.stdin?.write(input);
    }
    resize(sessionId, cols, rows) {
        const s = this.sessions.get(sessionId);
        if (!s || !s.session.active)
            return;
        s.proc.stdout?.setEncoding('utf8');
        if (process.stdout.isTTY) {
            process.stdout.columns = cols;
            process.stdout.rows = rows;
        }
    }
    destroySession(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return;
        s.session.active = false;
        s.rl.close();
        s.proc.kill('SIGTERM');
        setTimeout(() => {
            try {
                s.proc.kill('SIGKILL');
            }
            catch { }
        }, 2000);
        this.sessions.delete(sessionId);
        this.emit('destroyed', { sessionId });
    }
    destroyAll() {
        for (const [id] of this.sessions)
            this.destroySession(id);
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId)?.session;
    }
    listSessions() {
        return Array.from(this.sessions.values()).map(s => s.session);
    }
    getActiveCount() {
        return Array.from(this.sessions.values()).filter(s => s.session.active).length;
    }
}
