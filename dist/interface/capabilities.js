import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

// Resolved against the working directory (the app is always launched from
// the project root — see interface/web-server.ts's extension dir handling)
// rather than this module's own location, since this file is copied
// verbatim into dist/interface/ by scripts/build-backend.mjs and a
// module-relative path would then point at a dist/config that never exists.
const SYSTEM_PROFILE_PATH = join(process.cwd(), 'config', 'system-profile.md');
export class CapabilitiesRegistry {
    capabilities = new Map();
    constructor() {
        this.detectAll();
    }
    detectAll() {
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
            // Real, working implementation (interface/app-launcher.js, wired to
            // POST /api/apps/launch in web-server.ts) -- pure Node spawn(), no
            // external binary dependency, so this was never actually
            // conditional on anything. Hardcoded `false` here just meant the
            // AI's own system prompt (getSystemPrompt() below) told it this
            // capability didn't exist, even though it fully does.
            description: 'Launch graphical applications on the AI workspace. Apps open on AI desktop, not user\'s.',
            available: true,
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
            // plugins/browser.ts is a real, working implementation (fetch-based,
            // with SSRF/DNS-rebinding protection) -- no external tool needed.
            description: 'Automate browser for web searches, page navigation, and content extraction.',
            available: true,
            details: { mode: 'headless or visible on AI workspace' },
        });
        this.register({
            id: 'microphone',
            name: 'Microphone',
            // plugins/microphone.ts is real and working; it already degrades
            // gracefully (returns empty audio data) when arecord/ffmpeg are
            // both missing, so the capability itself doesn't depend on them.
            description: 'Record audio from microphone. Voice activation and command parsing.',
            available: true,
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
            // plugins/contacts.ts is a real, working local-JSON-file plugin.
            description: 'Store and manage contact information locally.',
            available: true,
            details: { storage: 'JSON file', local: true },
        });
        this.register({
            id: 'calendar',
            name: 'Calendar',
            // plugins/calendar.ts is a real, working local-JSON-file plugin.
            description: 'Store and manage events locally.',
            available: true,
            details: { storage: 'JSON file', local: true },
        });
        this.register({
            id: 'email',
            name: 'Email',
            // plugins/email.ts is a real, working implementation (local storage
            // plus best-effort sendmail/ssmtp/msmtp delivery when available).
            description: 'Send and receive emails through local storage.',
            available: true,
            details: { storage: 'JSON file', local: true },
        });
        this.register({
            id: 'tasks',
            name: 'Tasks',
            // plugins/tasks.ts is a real, working local-JSON-file plugin.
            description: 'Create and manage task lists with priorities.',
            available: true,
            details: { storage: 'JSON file', local: true },
        });
        this.register({
            id: 'encryption',
            name: 'Encryption',
            // interface/encryption.js (EncryptionManager) is real and working --
            // pure Node crypto, no external dependency.
            description: 'AES-256-GCM and ChaCha20-Poly1305 encryption for secure data storage.',
            available: true,
            details: { algorithms: ['aes-256-gcm', 'chacha20-poly1305'] },
        });
        this.register({
            id: 'diagnostics',
            name: 'System Diagnostics',
            // plugins/app-diagnostics.ts is a real, working implementation.
            description: 'Monitor CPU, memory, disk, and process information.',
            available: true,
            details: { data: ['cpu', 'memory', 'disk', 'processes'] },
        });
    }
    register(cap) {
        this.capabilities.set(cap.id, cap);
    }
    get(id) {
        return this.capabilities.get(id);
    }
    getAll() {
        return Array.from(this.capabilities.values());
    }
    getAvailable() {
        return Array.from(this.capabilities.values()).filter(c => c.available);
    }
    getUnavailable() {
        return Array.from(this.capabilities.values()).filter(c => !c.available);
    }
    isAvailable(id) {
        return this.capabilities.get(id)?.available ?? false;
    }
    getSystemPrompt() {
        const available = this.getAvailable();
        const lines = [
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
        const profile = this.getPersonalizationPrompt();
        if (profile) {
            lines.push(profile);
        }
        return lines.join('\n');
    }
    /**
     * The machine-specific profile (hard drive/storage, OS, BIOS/firmware,
     * drivers) captured by scripts/install.sh at install time. Returns '' if
     * install.sh hasn't run yet (e.g. running from source without installing).
     */
    getPersonalizationPrompt() {
        if (!existsSync(SYSTEM_PROFILE_PATH))
            return '';
        try {
            return readFileSync(SYSTEM_PROFILE_PATH, 'utf8');
        }
        catch {
            return '';
        }
    }
    formatForPrompt() {
        const available = this.getAvailable();
        const parts = available.map(c => `  [${c.id}] ${c.name}: ${c.description.slice(0, 80)}`);
        return [
            'AVAILABLE CAPABILITIES:',
            ...parts,
            `  Total: ${available.length} capabilities available`,
        ].join('\n');
    }
    checkGnome() {
        try {
            const r = execSync('gsettings --version 2>/dev/null || echo NOT_FOUND', { encoding: 'utf8', timeout: 2000 });
            return r.trim() !== 'NOT_FOUND';
        }
        catch {
            return false;
        }
    }
    checkXinput() {
        try {
            execSync('xinput --version 2>/dev/null', { encoding: 'utf8', timeout: 1000 });
            return true;
        }
        catch {
            return false;
        }
    }
    checkCommand(cmd) {
        try {
            const r = execSync(`which ${cmd} 2>/dev/null || command -v ${cmd} 2>/dev/null || echo NOT_FOUND`, { encoding: 'utf8', timeout: 2000 });
            return r.trim() !== 'NOT_FOUND';
        }
        catch {
            return false;
        }
    }
    findScreenshotTools() {
        const tools = [];
        for (const t of ['import', 'gnome-screenshot', 'scrot', 'ffmpeg']) {
            if (this.checkCommand(t))
                tools.push(t);
        }
        return tools;
    }
}
