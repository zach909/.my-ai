/**
 * Multi-desktop management for GNOME-based systems.
 * Provides isolated desktop environments for AI and user to prevent interference.
 *
 * Backed by real system integration (gsettings/xinput/uinput/wmctrl/gdbus) when
 * available, falling back to a simulated session model otherwise. This is the
 * single canonical MultiDesktopManager — do not duplicate it elsewhere.
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
// Same destructive-command denylist as desktop-app/src/main/main.js's
// isBlockedCommand() (itself ported from plugin_terminal.py's _is_blocked)
// -- launchOnDesktop() below runs `command` through a real shell (it needs
// shell:true to support pipes/redirects in an arbitrary command line, the
// same reason plugin_gnome.py's _launch_on_desktop keeps shell=True rather
// than switching to execFile), so an unguarded caller can run anything,
// including fork bombs and `rm -rf /`.
const FORK_BOMB = /:\(\)\{\s*[:\s|&]+\};:/;
const DANGEROUS_SIMPLE = /\bmkfs|\bshutdown|\breboot|\bhalt|\bpoweroff/i;
const DD_RAW_DISK = /\bdd\b.*\bof=\/dev\/(sd[a-z]|nvme|mmcblk)/i;
const RM_CMD = /\brm\b/i;
const RM_RECURSIVE = /(?<![\w-])-[a-zA-Z]*r[a-zA-Z]*(?![\w-])|--recursive\b/i;
const RM_FORCE = /(?<![\w-])-[a-zA-Z]*f[a-zA-Z]*(?![\w-])|--force\b/i;
const ROOT_LIKE_PATH = /(?<!\S)\/+[*.]{0,3}(?=\s|$|;|&|\|)/;
function isBlockedCommand(cmd) {
    if (FORK_BOMB.test(cmd) || DANGEROUS_SIMPLE.test(cmd) || DD_RAW_DISK.test(cmd))
        return true;
    if (RM_CMD.test(cmd) && RM_RECURSIVE.test(cmd) && RM_FORCE.test(cmd) && ROOT_LIKE_PATH.test(cmd))
        return true;
    return false;
}
const EXT_DBUS_DEST = 'org.gnome.Shell.Extensions.MultiInput';
const EXT_DBUS_PATH = '/org/gnome/Shell/Extensions/MultiInput';
const EXT_DBUS_IFACE = 'org.gnome.Shell.Extensions.MultiInput';
export class MultiDesktopManager {
    constructor() {
        this.currentDesktop = 'user';
        this.gnomeAvailable = false;
        this.xinputAvailable = false;
        this.uinputAvailable = false;
        /** Real GNOME workspace index backing the 'ai' session, once initialized */
        this.aiGnomeWorkspaceIndex = -1;
        /** True when the vendored gnome-multi-input-extension is reachable over D-Bus */
        this.extensionAvailable = false;
        this.sessions = new Map();
        this.inputDevices = new Map();
        this.virtualDevices = new Map();
        this.bindings = new Map();
        this.initializeDefaultSessions();
        this.checkSystemCapabilities();
    }
    checkSystemCapabilities() {
        this.gnomeAvailable = this.checkGnome();
        this.xinputAvailable = this.checkXinput();
        this.uinputAvailable = existsSync('/dev/uinput');
        this.extensionAvailable = this.checkExtension();
    }
    checkExtension() {
        try {
            execSync(`gdbus call --session --dest ${EXT_DBUS_DEST} ` +
                `--object-path ${EXT_DBUS_PATH} ` +
                `--method ${EXT_DBUS_IFACE}.GetNumWorkspaces 2>/dev/null`, { encoding: 'utf8', timeout: 3000 });
            return true;
        }
        catch {
            return false;
        }
    }
    /** Calls a method on the vendored gnome-multi-input-extension over D-Bus. */
    callExtension(method, args = '') {
        const cmd = `gdbus call --session --dest ${EXT_DBUS_DEST} ` +
            `--object-path ${EXT_DBUS_PATH} ` +
            `--method ${EXT_DBUS_IFACE}.${method}${args ? ' ' + args : ''} 2>/dev/null`;
        return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    }
    parseExtUint(output) {
        const m = output.match(/\d+/);
        return m ? parseInt(m[0], 10) : -1;
    }
    isExtensionAvailable() {
        return this.extensionAvailable;
    }
    checkGnome() {
        try {
            execSync('gsettings get org.gnome.desktop.wm.preferences num-workspaces 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
            return true;
        }
        catch {
            return false;
        }
    }
    checkXinput() {
        try {
            execSync('xinput --version 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
            return true;
        }
        catch {
            return false;
        }
    }
    initializeDefaultSessions() {
        this.sessions.set('user', {
            id: 'user',
            name: 'User Desktop',
            ownerId: 'user',
            isActive: true,
            workspaceCount: 4
        });
        this.sessions.set('ai', {
            id: 'ai',
            name: 'AI Desktop',
            ownerId: 'ai',
            isActive: false,
            workspaceCount: 8
        });
    }
    /**
     * Initialize AI workspace - activates AI desktop session, creating a real
     * GNOME workspace for it when GNOME is available.
     */
    async initAiWorkspace() {
        if (this.aiGnomeWorkspaceIndex < 0) {
            if (this.extensionAvailable) {
                try {
                    const idx = this.parseExtUint(this.callExtension('EnsureAiWorkspace'));
                    if (idx >= 0)
                        this.aiGnomeWorkspaceIndex = idx;
                }
                catch { /* fall through */ }
            }
            if (this.aiGnomeWorkspaceIndex < 0 && this.gnomeAvailable) {
                try {
                    const count = this.getRealGnomeWorkspaceCount();
                    execSync(`gsettings set org.gnome.desktop.wm.preferences num-workspaces ${count + 1}`, { timeout: 5000 });
                    this.aiGnomeWorkspaceIndex = count;
                }
                catch { /* fall through to simulated session only */ }
            }
        }
        this.activateSession('ai');
        return 'ai_workspace_initialized';
    }
    /**
     * Create virtual pointer device for AI
     */
    createAiVirtualPointer() {
        return this.createVirtualDevice('mouse', 'AI Virtual Pointer');
    }
    /**
     * Create virtual keyboard device for AI
     */
    createAiVirtualKeyboard() {
        return this.createVirtualDevice('keyboard', 'AI Virtual Keyboard');
    }
    createVirtualDevice(type, name) {
        const id = `virt_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        let masterId;
        // Prefer the GNOME Shell extension's Clutter.Seat virtual device (proper API)
        // over xinput master-device creation, when the extension is reachable.
        if (this.extensionAvailable) {
            try {
                const method = type === 'mouse' ? 'CreateVirtualPointer' : 'CreateVirtualKeyboard';
                const extId = this.parseExtUint(this.callExtension(method));
                if (extId > 0) {
                    const device = { id, type, name: `${name} (Extension)`, created: Date.now(), masterId: extId };
                    this.virtualDevices.set(id, device);
                    this.assignDeviceToDevice(id, 'ai');
                    return device;
                }
            }
            catch { /* fall through to xinput */ }
        }
        if (this.xinputAvailable) {
            try {
                execSync(`xinput create-master "${name}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
                const listing = execSync('xinput list --id-only 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
                const ids = listing.trim().split('\n').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
                if (ids.length > 0)
                    masterId = Math.max(...ids);
            }
            catch { /* fall back to simulated */ }
        }
        const device = { id, type, name, created: Date.now(), ...(masterId !== undefined ? { masterId } : {}) };
        this.virtualDevices.set(id, device);
        this.assignDeviceToDevice(id, 'ai');
        return device;
    }
    /**
     * Get AI workspace status
     */
    getAiWorkspace() {
        const aiSession = this.sessions.get('ai');
        return aiSession?.isActive ? 'active' : 'inactive';
    }
    isGnomeAvailable() {
        return this.gnomeAvailable;
    }
    hasXinput() {
        return this.xinputAvailable;
    }
    hasUinput() {
        return this.uinputAvailable;
    }
    getCurrentDesktop() {
        return this.currentDesktop;
    }
    listDesktops() {
        return Array.from(this.sessions.keys());
    }
    getRealGnomeWorkspaceCount() {
        try {
            const r = execSync('gsettings get org.gnome.desktop.wm.preferences num-workspaces', { encoding: 'utf8', timeout: 3000 });
            return parseInt(r.trim(), 10);
        }
        catch {
            return 1;
        }
    }
    getDesktopCount() {
        if (this.gnomeAvailable)
            return this.getRealGnomeWorkspaceCount();
        return this.sessions.size;
    }
    getVirtualDevices() {
        return Array.from(this.virtualDevices.values());
    }
    getAllBindings() {
        return Array.from(this.bindings.values());
    }
    /**
     * Focus AI desktop — switches the real GNOME workspace when available.
     */
    focusAiDesktop() {
        if (this.extensionAvailable) {
            try {
                this.callExtension('FocusAiWorkspace');
                return this.switchToDesktop('ai');
            }
            catch { /* fall through */ }
        }
        if (this.gnomeAvailable && this.aiGnomeWorkspaceIndex >= 0) {
            this.switchRealGnomeWorkspace(this.aiGnomeWorkspaceIndex);
        }
        return this.switchToDesktop('ai');
    }
    focusUserDesktop() {
        if (this.extensionAvailable) {
            try {
                this.callExtension('FocusUserWorkspace');
                return this.switchToDesktop('user');
            }
            catch { /* fall through */ }
        }
        if (this.gnomeAvailable) {
            this.switchRealGnomeWorkspace(0);
        }
        return this.switchToDesktop('user');
    }
    /**
     * Move an already-open window (by wmctrl window id) to the GNOME workspace
     * backing the given desktop session.
     */
    moveWindowToDesktop(windowId, desktopId) {
        if (typeof windowId !== 'string' || windowId.trim().startsWith('-') || !/^[a-zA-Z0-9xX]+$/.test(windowId.trim())) {
            throw new Error('Security Error: Invalid or malicious windowId detected.');
        }
        if (typeof desktopId !== 'string' || !/^[a-zA-Z0-9_]+$/.test(desktopId)) {
            throw new Error('Security Error: Invalid desktopId.');
        }
        // Validate windowId to prevent shell/command injection or argument injection
        if (!/^[a-zA-Z0-9_xX-]+$/.test(windowId)) {
            return;
        }
        if (!/^[a-fA-F0-9xX]+$/.test(windowId)) {
            throw new Error('Security Error: Invalid windowId format');
        }
        if (desktopId !== 'user' && desktopId !== 'ai') {
            throw new Error('Security Error: Invalid desktopId');
        }
        if (!/^[a-zA-Z0-9_xX][a-zA-Z0-9_xX-]*$/.test(windowId))
            return;
        const index = desktopId === 'ai' ? this.aiGnomeWorkspaceIndex : 0;
        if (!this.gnomeAvailable || index < 0)
            return;
        try {
            execSync(`wmctrl -i -r ${windowId} -t ${index} 2>/dev/null`, { timeout: 3000 });
        }
        catch { /* best effort */ }
    }
    /**
     * Launch a command on the given desktop session (defaults to 'ai') without
     * disturbing whichever desktop is currently focused.
     */
    launchOnDesktop(command, desktopId = 'ai') {
        if (isBlockedCommand(command))
            return;
        if (typeof desktopId !== 'string' || !/^[a-zA-Z0-9_]+$/.test(desktopId)) {
            throw new Error('Security Error: Invalid desktopId.');
        }
        const cur = this.currentDesktop;
        this.switchToDesktop(desktopId);
        try {
            const proc = spawn(command, [], {
                shell: true, stdio: 'ignore', detached: true,
                env: { ...process.env, DESKTOP: desktopId },
            });
            proc.unref();
        }
        catch { /* best effort */ }
        if (cur !== desktopId)
            this.switchToDesktop(cur);
    }
    switchRealGnomeWorkspace(index) {
        if (!Number.isInteger(index) || index < 0 || index > 1000)
            return;
        try {
            execSync(`gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "global.workspace_manager.get_workspace_by_index(${index}).activate(global.get_current_time())" 2>/dev/null`, { timeout: 5000, encoding: 'utf8' });
        }
        catch {
            try {
                execSync(`wmctrl -s ${index} 2>/dev/null`, { timeout: 3000 });
            }
            catch { /* best effort */ }
        }
    }
    /**
     * List physical input devices — queried live via xinput when available.
     */
    listPhysicalInputDevices() {
        if (this.xinputAvailable) {
            try {
                const out = execSync('xinput list --name-only 2>/dev/null || xinput list 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
                const lines = out.trim().split('\n').filter(l => l.length > 0);
                return lines.map((l, i) => {
                    const name = l.trim();
                    const lower = name.toLowerCase();
                    const type = lower.includes('touchpad') ? 'touchpad'
                        : lower.includes('tablet') ? 'tablet'
                            : (lower.includes('mouse') || lower.includes('pointer')) ? 'mouse'
                                : 'keyboard';
                    return { id: `phys_${i}`, type, name, assignedDesktop: null };
                });
            }
            catch { /* fall through to registered devices */ }
        }
        return Array.from(this.inputDevices.values()).filter(d => !d.id.startsWith('virt_'));
    }
    removeVirtualDevice(deviceId) {
        const dev = this.virtualDevices.get(deviceId);
        if (!dev)
            return false;
        if (dev.masterId !== undefined && this.xinputAvailable) {
            try {
                execSync(`xinput remove-master ${dev.masterId} 2>/dev/null`, { timeout: 3000 });
            }
            catch { /* best effort */ }
        }
        return this.virtualDevices.delete(deviceId);
    }
    /**
     * Isolate AI input — floats real physical devices off the core pointer/keyboard
     * (via xinput) in addition to the simulated assignment bookkeeping.
     */
    isolateAiInput() {
        if (this.xinputAvailable) {
            try {
                const r = execSync('xinput list', { encoding: 'utf8', timeout: 3000 });
                for (const line of r.split('\n')) {
                    const idMatch = line.match(/id=(\d+)/);
                    if (!idMatch)
                        continue;
                    if (line.includes('XTEST') || line.includes('Virtual core'))
                        continue;
                    const isSlave = line.includes('slave  keyboard') || line.includes('slave  pointer');
                    if (isSlave) {
                        try {
                            execSync(`xinput float ${idMatch[1]} 2>/dev/null`, { timeout: 2000 });
                        }
                        catch { /* best effort */ }
                    }
                }
            }
            catch { /* fall through to simulated bookkeeping */ }
        }
        for (const [id] of this.virtualDevices) {
            this.assignDeviceToDevice(id, 'ai');
        }
        return true;
    }
    /**
     * Restore user input — reattaches physical devices to the core pointer/keyboard
     * (via xinput) in addition to clearing simulated assignments.
     */
    restoreUserInput() {
        if (this.xinputAvailable) {
            try {
                execSync('xinput reattach $(xinput list | grep "AT Translated" | grep -oP "id=\\d+" | grep -oP "\\d+") "Virtual core pointer" 2>/dev/null', { timeout: 3000 });
            }
            catch { /* best effort */ }
        }
        for (const device of this.inputDevices.values()) {
            device.assignedDesktop = null;
        }
        return true;
    }
    bindDeviceToWorkspace(deviceId, workspaceId, mode = 'exclusive') {
        const binding = {
            deviceId,
            desktopId: workspaceId,
            mode
        };
        this.bindings.set(`${deviceId}_${workspaceId}`, binding);
        return this.assignDeviceToDevice(deviceId, workspaceId);
    }
    unbindDevice(deviceId) {
        for (const [key, binding] of this.bindings) {
            if (binding.deviceId === deviceId) {
                this.bindings.delete(key);
            }
        }
        const device = this.inputDevices.get(deviceId);
        if (device) {
            device.assignedDesktop = null;
        }
        return true;
    }
    createSession(name, ownerId) {
        const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const session = {
            id,
            name,
            ownerId,
            isActive: false,
            workspaceCount: 4
        };
        this.sessions.set(id, session);
        return session;
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    activateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        for (const [, s] of this.sessions) {
            s.isActive = false;
        }
        session.isActive = true;
        this.currentDesktop = sessionId;
        return true;
    }
    getCurrentSession() {
        return this.sessions.get(this.currentDesktop);
    }
    registerInputDevice(device) {
        this.inputDevices.set(device.id, device);
    }
    assignDeviceToDevice(deviceId, desktopId) {
        const device = this.inputDevices.get(deviceId);
        if (!device)
            return false;
        device.assignedDesktop = desktopId;
        return true;
    }
    getInputForDesktop(desktopId) {
        return Array.from(this.inputDevices.values()).filter(d => d.assignedDesktop === desktopId || d.assignedDesktop === null);
    }
    switchToDesktop(desktopId) {
        return this.activateSession(desktopId);
    }
    getWorkspaceCount(desktopId) {
        const session = this.sessions.get(desktopId);
        return session?.workspaceCount ?? 4;
    }
    listSessions() {
        return Array.from(this.sessions.values());
    }
}
export default MultiDesktopManager;
