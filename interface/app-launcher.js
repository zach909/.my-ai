import { spawn, execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
export class AppLauncher extends EventEmitter {
    apps = new Map();
    nextId = 1;
    constructor() {
        super();
    }
    launch(command, options = {}) {
        const id = `app_${this.nextId++}`;
        const name = options.name ?? command.split(/\s+/)[0] ?? 'unknown';
        const workspace = options.workspace ?? -1;
        const app = {
            id, name, command,
            pid: null, workspace, windowId: null,
            active: false, started: Date.now(),
        };
        const display = process.env.DISPLAY || ':0';
        const env = {
            ...process.env,
            DISPLAY: display,
            DESKTOP: String(workspace >= 0 ? workspace : ''),
            ...options.env,
        };
        try {
            // shell: false -- command and args are passed straight to
            // execve(), never through /bin/sh -c. With shell: true, any
            // shell metacharacter (`;`, `&&`, backticks, `$()`, ...) inside
            // an attacker-controlled `command` or `args` entry runs as an
            // *additional* command, not just an argument -- and both real
            // callers (interface/web-server.ts's POST /api/apps/launch and
            // POST /api/apps/launch-package) pass fully unauthenticated,
            // network-supplied strings straight through to this call with
            // no sanitization. Both callers already pass command/args as
            // separate values (never a pre-joined shell command line), so
            // shell: false changes nothing for legitimate use.
            const proc = spawn(command, options.args ?? [], {
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: true,
                env,
            });
            app.pid = proc.pid;
            app.active = true;
            if (options.waitForWindow !== false) {
                this.waitForWindow(app);
            }
            const stdoutBuf = [];
            const stderrBuf = [];
            proc.stdout?.on('data', (d) => stdoutBuf.push(d));
            proc.stderr?.on('data', (d) => stderrBuf.push(d));
            proc.on('exit', (code) => {
                app.active = false;
                this.emit('exited', { appId: id, name, code, stdout: Buffer.concat(stdoutBuf).toString(), stderr: Buffer.concat(stderrBuf).toString() });
            });
            proc.on('error', (err) => {
                app.active = false;
                this.emit('error', { appId: id, name, error: err.message });
            });
            proc.unref();
        }
        catch (err) {
            this.emit('error', { appId: id, name, error: String(err) });
        }
        this.apps.set(id, app);
        this.emit('launched', { appId: id, name, pid: app.pid, workspace });
        return app;
    }
    launchOnAiDesktop(command, workspace, options = {}) {
        const name = options.name ?? command.split(/\s+/)[0] ?? 'ai-app';
        const app = this.launch(command, {
            ...options,
            name,
            workspace,
            waitForWindow: true,
        });
        // Move the window to AI workspace
        this.moveToWorkspace(app, workspace);
        return app;
    }
    waitForWindow(app) {
        const check = () => {
            if (!app.active)
                return;
            try {
                const r = execSync(`wmctrl -lp 2>/dev/null | awk -v pid=${app.pid} '$3 == pid { print $1; exit }'`, { encoding: 'utf8', timeout: 2000 });
                const winId = r.trim();
                if (winId) {
                    app.windowId = winId;
                    this.emit('window-ready', { appId: app.id, windowId: winId, name: app.name });
                    return;
                }
            }
            catch { }
            setTimeout(check, 200);
        };
        setTimeout(check, 300);
    }
    moveToWorkspace(app, workspace) {
        if (!app.windowId) {
            // Wait for window then move
            const onReady = (info) => {
                if (info.appId !== app.id)
                    return;
                this.moveWindowById(info.windowId, workspace);
                this.removeListener('window-ready', onReady);
            };
            this.on('window-ready', onReady);
            return;
        }
        this.moveWindowById(app.windowId, workspace);
    }
    moveWindowById(windowId, workspace) {
        if (typeof windowId !== 'string' || !/^[a-fA-F0-9xX]+$/.test(windowId)) {
            this.emit('error', { message: `Invalid windowId format` });
            return;
        }
        const wsInt = parseInt(workspace, 10);
        if (isNaN(wsInt) || wsInt < 0 || wsInt > 100000) {
            this.emit('error', { message: `Invalid workspace index` });
        if (!/^[a-zA-Z0-9_xX][a-zA-Z0-9_xX-]*$/.test(String(windowId)) || !/^\d+$/.test(String(workspace))) {
            this.emit('error', { message: `Invalid arguments for moving window: windowId=${windowId}, workspace=${workspace}` });
            return;
        }
        try {
            execSync(`wmctrl -i -r ${windowId} -t ${wsInt}`, { timeout: 2000 });
        }
        catch (e) {
            this.emit('error', { message: `Failed to move window ${windowId} to workspace ${wsInt}: ${e}` });
        }
    }
    bringToCurrentWorkspace(appIdOrWindowId) {
        if (typeof appIdOrWindowId !== 'string' || !/^[a-fA-F0-9xX_]+$/.test(appIdOrWindowId)) {
        if (!/^[a-zA-Z0-9_xX][a-zA-Z0-9_xX-]*$/.test(String(appIdOrWindowId))) {
            return;
        }
        try {
            execSync(`wmctrl -i -R ${appIdOrWindowId}`, { timeout: 2000 });
        }
        catch { }
    }
    close(appId) {
        const app = this.apps.get(appId);
        if (!app || !app.pid)
            return false;
        try {
            process.kill(app.pid, 'SIGTERM');
            app.active = false;
            setTimeout(() => {
                try {
                    process.kill(app.pid, 'SIGKILL');
                }
                catch { }
            }, 2000);
            this.emit('closed', { appId, name: app.name });
            return true;
        }
        catch {
            return false;
        }
    }
    closeAll() {
        for (const [id] of this.apps)
            this.close(id);
    }
    getApp(appId) {
        return this.apps.get(appId);
    }
    listApps() {
        return Array.from(this.apps.values());
    }
    listActive() {
        return Array.from(this.apps.values()).filter(a => a.active);
    }
    listOnWorkspace(workspace) {
        return Array.from(this.apps.values()).filter(a => a.workspace === workspace);
    }
    launchBrowser(url, workspace) {
        const targetWs = workspace ?? -1;
        // Pass the URL as a literal arg, not baked into a shell command
        // string -- launch() no longer runs commands through a shell (see
        // launch()'s comment), so a pre-joined "xdg-open \"...\"" string
        // would be looked up as one literal (nonexistent) executable name.
        const target = url || 'https://google.com';
        return this.launch('xdg-open', { name: 'browser', args: [target], workspace: targetWs, waitForWindow: true });
    }
    launchTerminal(workspace) {
        const targetWs = workspace ?? -1;
        const terms = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm', 'uxterm', 'foot'];
        for (const term of terms) {
            try {
                execSync(`which ${term} 2>/dev/null`, { timeout: 1000 });
                return this.launch(term, { name: term, workspace: targetWs, waitForWindow: true });
            }
            catch { }
        }
        return this.launch('xterm', { name: 'xterm', workspace: targetWs, waitForWindow: true });
    }
    launchFileManager(workspace) {
        const targetWs = workspace ?? -1;
        const fms = ['nautilus', 'nemo', 'thunar', 'pcmanfm', 'dolphin'];
        for (const fm of fms) {
            try {
                execSync(`which ${fm} 2>/dev/null`, { timeout: 1000 });
                return this.launch(fm, { name: fm, workspace: targetWs, waitForWindow: true });
            }
            catch { }
        }
        throw new Error('No file manager found');
    }
}
