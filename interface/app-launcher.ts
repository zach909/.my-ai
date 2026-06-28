import { spawn, execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface LaunchedApp {
  id: string;
  name: string;
  command: string;
  pid: number | null;
  workspace: number;
  windowId: string | null;
  active: boolean;
  started: number;
}

export class AppLauncher extends EventEmitter {
  private apps: Map<string, LaunchedApp> = new Map();
  private nextId = 1;

  constructor() {
    super();
  }

  launch(
    command: string,
    options: {
      name?: string;
      workspace?: number;
      args?: string[];
      waitForWindow?: boolean;
      env?: Record<string, string>;
    } = {},
  ): LaunchedApp {
    const id = `app_${this.nextId++}`;
    const name = options.name ?? command.split(/\s+/)[0] ?? 'unknown';
    const workspace = options.workspace ?? -1;

    const app: LaunchedApp = {
      id, name, command,
      pid: null, workspace, windowId: null,
      active: false, started: Date.now(),
    };

    const display = process.env.DISPLAY || ':0';
    const env = {
      ...process.env as Record<string, string>,
      DISPLAY: display,
      DESKTOP: String(workspace >= 0 ? workspace : ''),
      ...options.env,
    };

    try {
      const proc = spawn(command, options.args ?? [], {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env,
      });

      app.pid = proc.pid;
      app.active = true;

      if (options.waitForWindow !== false) {
        this.waitForWindow(app);
      }

      const stdoutBuf: Buffer[] = [];
      const stderrBuf: Buffer[] = [];

      proc.stdout?.on('data', (d: Buffer) => stdoutBuf.push(d));
      proc.stderr?.on('data', (d: Buffer) => stderrBuf.push(d));

      proc.on('exit', (code) => {
        app.active = false;
        this.emit('exited', { appId: id, name, code, stdout: Buffer.concat(stdoutBuf).toString(), stderr: Buffer.concat(stderrBuf).toString() });
      });

      proc.on('error', (err) => {
        app.active = false;
        this.emit('error', { appId: id, name, error: err.message });
      });

      proc.unref();
    } catch (err) {
      this.emit('error', { appId: id, name, error: String(err) });
    }

    this.apps.set(id, app);
    this.emit('launched', { appId: id, name, pid: app.pid, workspace });
    return app;
  }

  launchOnAiDesktop(
    command: string,
    workspace: number,
    options: { name?: string; args?: string[] } = {},
  ): LaunchedApp {
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

  private waitForWindow(app: LaunchedApp): void {
    const check = () => {
      if (!app.active) return;
      try {
        const r = execSync(
          `wmctrl -lp 2>/dev/null | awk -v pid=${app.pid} '$3 == pid { print $1; exit }'`,
          { encoding: 'utf8', timeout: 2000 },
        );
        const winId = r.trim();
        if (winId) {
          app.windowId = winId;
          this.emit('window-ready', { appId: app.id, windowId: winId, name: app.name });
          return;
        }
      } catch { }
      setTimeout(check, 200);
    };
    setTimeout(check, 300);
  }

  moveToWorkspace(app: LaunchedApp, workspace: number): void {
    if (!app.windowId) {
      // Wait for window then move
      const onReady = (info: { appId: string; windowId: string }) => {
        if (info.appId !== app.id) return;
        this.moveWindowById(info.windowId, workspace);
        this.removeListener('window-ready', onReady);
      };
      this.on('window-ready', onReady);
      return;
    }
    this.moveWindowById(app.windowId, workspace);
  }

  moveWindowById(windowId: string, workspace: number): void {
    try {
      execSync(`wmctrl -i -r ${windowId} -t ${workspace}`, { timeout: 2000 });
    } catch (e) {
      this.emit('error', { message: `Failed to move window ${windowId} to workspace ${workspace}: ${e}` });
    }
  }

  bringToCurrentWorkspace(appIdOrWindowId: string): void {
    try {
      execSync(`wmctrl -i -R ${appIdOrWindowId}`, { timeout: 2000 });
    } catch { }
  }

  close(appId: string): boolean {
    const app = this.apps.get(appId);
    if (!app || !app.pid) return false;
    try {
      process.kill(app.pid, 'SIGTERM');
      app.active = false;
      setTimeout(() => {
        try { process.kill(app.pid!, 'SIGKILL'); } catch { }
      }, 2000);
      this.emit('closed', { appId, name: app.name });
      return true;
    } catch { return false; }
  }

  closeAll(): void {
    for (const [id] of this.apps) this.close(id);
  }

  getApp(appId: string): LaunchedApp | undefined {
    return this.apps.get(appId);
  }

  listApps(): LaunchedApp[] {
    return Array.from(this.apps.values());
  }

  listActive(): LaunchedApp[] {
    return Array.from(this.apps.values()).filter(a => a.active);
  }

  listOnWorkspace(workspace: number): LaunchedApp[] {
    return Array.from(this.apps.values()).filter(a => a.workspace === workspace);
  }

  launchBrowser(url?: string, workspace?: number): LaunchedApp {
    const targetWs = workspace ?? -1;
    const cmd = url ? `xdg-open "${url}"` : 'xdg-open https://google.com';
    return this.launch(cmd, { name: 'browser', workspace: targetWs, waitForWindow: true });
  }

  launchTerminal(workspace?: number): LaunchedApp {
    const targetWs = workspace ?? -1;
    const terms = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm', 'uxterm', 'foot'];
    for (const term of terms) {
      try {
        execSync(`which ${term} 2>/dev/null`, { timeout: 1000 });
        return this.launch(term, { name: term, workspace: targetWs, waitForWindow: true });
      } catch { }
    }
    return this.launch('xterm', { name: 'xterm', workspace: targetWs, waitForWindow: true });
  }

  launchFileManager(workspace?: number): LaunchedApp {
    const targetWs = workspace ?? -1;
    const fms = ['nautilus', 'nemo', 'thunar', 'pcmanfm', 'dolphin'];
    for (const fm of fms) {
      try {
        execSync(`which ${fm} 2>/dev/null`, { timeout: 1000 });
        return this.launch(fm, { name: fm, workspace: targetWs, waitForWindow: true });
      } catch { }
    }
    throw new Error('No file manager found');
  }
}
