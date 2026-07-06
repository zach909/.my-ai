import { EventEmitter } from 'node:events';
export interface ShellSession {
    id: string;
    pid: number | null;
    active: boolean;
    cwd: string;
    created: number;
    lastActivity: number;
}
export declare class PersistentShell extends EventEmitter {
    private sessions;
    private shellPath;
    private nextId;
    constructor();
    createSession(cwd?: string): ShellSession;
    exec(sessionId: string, command: string, timeout?: number): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | null;
    }>;
    execSync(command: string, timeout?: number): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | null;
    }>;
    writeStdin(sessionId: string, input: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    destroySession(sessionId: string): void;
    destroyAll(): void;
    getSession(sessionId: string): ShellSession | undefined;
    listSessions(): ShellSession[];
    getActiveCount(): number;
}
