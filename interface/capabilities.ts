import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

export interface Capability {
  id: string;
  name: string;
  description: string;
  available: boolean;
  details: Record<string, unknown>;
}

export class CapabilitiesRegistry {
  private capabilities: Map<string, Capability> = new Map();

  constructor() {
    this.detectAll();
  }

  private detectAll(): void {
    this.register({
      id: 'terminal',
      name: 'Terminal Access',
      description: 'Execute shell commands with output capture. Dangerous commands are blocked.',
      available: true,
      details: { shell: os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash', sandbox: true },
    });

    this.register({
      id: 'file-system',
      name: 'File System Access',
      description: 'Read, write, delete files and directories. Full local file system access.',
      available: true,
      details: { cwd: process.cwd(), platform: os.platform() },
    });

    this.register({
      id: 'multi-desktop',
      name: 'Multi-Desktop Workspaces',
      description: 'AI has its own GNOME workspace. Commands and apps launch on AI workspace, not the user\'s.',
      available: this.checkGnome(),
      details: { method: this.checkGnome() ? 'GNOME Shell' : 'simulated', isolation: 'workspace-level' },
    });

    this.register({
      id: 'multi-mouse',
      name: 'Virtual Mouse (Multi-Input)',
      description: 'AI has its own virtual mouse pointer. Never steals user\'s cursor. Clicks only on AI workspace.',
      available: this.checkXinput() || this.checkGnome(),
      details: { method: this.checkXinput() ? 'xinput' : this.checkGnome() ? 'gnome-extension' : 'none' },
    });

    this.register({
      id: 'multi-keyboard',
      name: 'Virtual Keyboard (Multi-Input)',
      description: 'AI has its own virtual keyboard. Never types in user\'s windows. Keys only sent to AI workspace.',
      available: this.checkXinput() || this.checkGnome(),
      details: { method: this.checkXinput() ? 'xinput' : this.checkGnome() ? 'gnome-extension' : 'none' },
    });

    this.register({
      id: 'input-isolation',
      name: 'Input Isolation',
      description: 'Physical mouse/keyboard are detached from AI workspace. User input never affects AI workspace.',
      available: this.checkXinput(),
      details: { method: 'xinput float/reattach', status: 'available when active' },
    });

    this.register({
      id: 'screenshots',
      name: 'Screenshot Capture',
      description: 'Take screenshots of the desktop. Can capture specific windows or full screen.',
      available: this.checkCommand('import') || this.checkCommand('gnome-screenshot') || this.checkCommand('scrot') || this.checkCommand('ffmpeg'),
      details: { tools: this.findScreenshotTools() },
    });

    this.register({
      id: 'app-launcher',
      name: 'GUI App Launcher',
      description: 'Launch graphical applications on the AI workspace. Apps open on AI desktop, not user\'s.',
      available: false,
      details: { display: process.env.DISPLAY || ':0', method: 'spawn + wmctrl' },
    });

    this.register({
      id: 'notifications',
      name: 'Desktop Notifications',
      description: 'Send desktop notifications to the user via notify-send.',
      available: this.checkCommand('notify-send'),
      details: { tool: 'notify-send' },
    });

    this.register({
      id: 'browser',
      name: 'Web Browser',
      description: 'Automate browser for web searches, page navigation, and content extraction.',
      available: false,
      details: { mode: 'headless or visible on AI workspace' },
    });

    this.register({
      id: 'microphone',
      name: 'Microphone',
      description: 'Record audio from microphone. Voice activation and command parsing.',
      available: false,
      details: { tools: ['arecord', 'ffmpeg'], format: 'wav' },
    });

    this.register({
      id: 'camera',
      name: 'Camera',
      description: 'Capture images from webcam.',
      available: this.checkCommand('fswebcam') || this.checkCommand('ffmpeg'),
      details: { tools: ['fswebcam', 'ffmpeg'], format: 'jpeg' },
    });

    this.register({
      id: 'clipboard',
      name: 'System Clipboard',
      description: 'Read and write system clipboard. Can copy/paste between AI and user.',
      available: this.checkCommand('xclip') || this.checkCommand('xsel') || this.checkCommand('wl-clipboard'),
      details: { tools: ['xclip', 'xsel', 'wl-copy'] },
    });

    this.register({
      id: 'contacts',
      name: 'Contacts',
      description: 'Store and manage contact information locally.',
      available: false,
      details: { storage: 'JSON file', local: true },
    });

    this.register({
      id: 'calendar',
      name: 'Calendar',
      description: 'Store and manage events locally.',
      available: false,
      details: { storage: 'JSON file', local: true },
    });

    this.register({
      id: 'email',
      name: 'Email',
      description: 'Send and receive emails through local storage.',
      available: false,
      details: { storage: 'JSON file', local: true },
    });

    this.register({
      id: 'tasks',
      name: 'Tasks',
      description: 'Create and manage task lists with priorities.',
      available: false,
      details: { storage: 'JSON file', local: true },
    });

    this.register({
      id: 'encryption',
      name: 'Encryption',
      description: 'AES-256-GCM and ChaCha20-Poly1305 encryption for secure data storage.',
      available: false,
      details: { algorithms: ['aes-256-gcm', 'chacha20-poly1305'] },
    });

    this.register({
      id: 'diagnostics',
      name: 'System Diagnostics',
      description: 'Monitor CPU, memory, disk, and process information.',
      available: false,
      details: { data: ['cpu', 'memory', 'disk', 'processes'] },
    });
  }

  private register(cap: Capability): void {
    this.capabilities.set(cap.id, cap);
  }

  get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  getAll(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  getAvailable(): Capability[] {
    return Array.from(this.capabilities.values()).filter(c => c.available);
  }

  getUnavailable(): Capability[] {
    return Array.from(this.capabilities.values()).filter(c => !c.available);
  }

  isAvailable(id: string): boolean {
    return this.capabilities.get(id)?.available ?? false;
  }

  getSystemPrompt(): string {
    const available = this.getAvailable();
    const lines: string[] = [
      '## System Capabilities',
      '',
      'You have the following capabilities available:',
      '',
    ];
    for (const cap of available) {
      lines.push(`- **${cap.name}**: ${cap.description}`);
    }
    lines.push('');
    lines.push('### Multi-Desktop Rules');
    lines.push('- You have your **own workspace** (desktop) separate from the user.');
    lines.push('- All terminal commands, app launches, and interactions go to **your workspace**.');
    lines.push('- You have your **own virtual mouse** — never take over the user\'s cursor.');
    lines.push('- You have your **own virtual keyboard** — never type in the user\'s windows.');
    lines.push('- User input is **isolated** from your workspace — they can\'t accidentally interact with your apps.');
    lines.push('- When launching GUI apps, they open on your desktop, not the user\'s.');
    lines.push('- The user\'s workspace is desktop 0. Your workspace is a higher index.');
    lines.push('');
    lines.push('### Safety Rules');
    lines.push('- Never run destructive commands (rm -rf /, mkfs, dd, shutdown, etc.).');
    lines.push('- Never access files outside the project without permission.');
    lines.push('- Never steal the user\'s input focus or cursor.');
    lines.push('');
    return lines.join('\n');
  }

  formatForPrompt(): string {
    const available = this.getAvailable();
    const parts = available.map(c => `  [${c.id}] ${c.name}: ${c.description.slice(0, 80)}`);
    return [
      'AVAILABLE CAPABILITIES:',
      ...parts,
      `  Total: ${available.length} capabilities available`,
    ].join('\n');
  }

  private checkGnome(): boolean {
    try {
      const r = execSync('gsettings --version 2>/dev/null || echo NOT_FOUND', { encoding: 'utf8', timeout: 2000 });
      return r.trim() !== 'NOT_FOUND';
    } catch { return false; }
  }

  private checkXinput(): boolean {
    try {
      execSync('xinput --version 2>/dev/null', { encoding: 'utf8', timeout: 1000 });
      return true;
    } catch { return false; }
  }

  private checkCommand(cmd: string): boolean {
    try {
      const r = execSync(`which ${cmd} 2>/dev/null || command -v ${cmd} 2>/dev/null || echo NOT_FOUND`, { encoding: 'utf8', timeout: 2000 });
      return r.trim() !== 'NOT_FOUND';
    } catch { return false; }
  }

  private findScreenshotTools(): string[] {
    const tools: string[] = [];
    for (const t of ['import', 'gnome-screenshot', 'scrot', 'ffmpeg']) {
      if (this.checkCommand(t)) tools.push(t);
    }
    return tools;
  }
}
