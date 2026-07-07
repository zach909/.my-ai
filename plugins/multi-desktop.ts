import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

interface DesktopInfo {
  id: number;
  name: string;
  active: boolean;
  isAiDesktop: boolean;
}

interface VirtualInputDevice {
  id: number;
  name: string;
  type: 'pointer' | 'keyboard';
  masterId: number;
  workspace: number;
  active: boolean;
}

interface InputBinding {
  physicalDeviceId: string;
  physicalDeviceName: string;
  boundWorkspace: number;
}

export type { DesktopInfo, VirtualInputDevice, InputBinding };

const EXT_DBUS_DEST = 'org.gnome.Shell.Extensions.MultiInput';
const EXT_DBUS_PATH = '/org/gnome/Shell/Extensions/MultiInput';
const EXT_DBUS_IFACE = 'org.gnome.Shell.Extensions.MultiInput';

export class MultiDesktopManager {
  private gnomeAvailable: boolean;
  private extensionAvailable: boolean;
  private simulatedDesktops: Map<number, DesktopInfo>;
  private virtualDevices: Map<number, VirtualInputDevice>;
  private inputBindings: Map<string, InputBinding>;
  private nextVirtualId: number;
  private aiWorkspace: number = -1;
  private userWorkspace: number = 0;
  private xinputAvailable: boolean;
  private uinputAvailable: boolean;

  constructor() {
    this.simulatedDesktops = new Map();
    this.virtualDevices = new Map();
    this.inputBindings = new Map();
    this.nextVirtualId = 1;
    this.gnomeAvailable = this.checkGnome();
    this.extensionAvailable = this.checkExtension();
    this.xinputAvailable = this.checkXinput();
    this.uinputAvailable = existsSync('/dev/uinput');
    if (!this.gnomeAvailable) {
      this.simulatedDesktops.set(0, { id: 0, name: 'Desktop 1', active: true, isAiDesktop: false });
    }
  }

  private checkGnome(): boolean {
    try {
      execSync('gsettings get org.gnome.desktop.wm.preferences num-workspaces 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      return true;
    } catch { return false; }
  }

  private checkXinput(): boolean {
    try {
      execSync('xinput --version 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
      return true;
    } catch { return false; }
  }

  private checkExtension(): boolean {
    try {
      execSync(
        `gdbus call --session --dest ${EXT_DBUS_DEST} ` +
        `--object-path ${EXT_DBUS_PATH} ` +
        `--method ${EXT_DBUS_IFACE}.GetNumWorkspaces 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 },
      );
      return true;
    } catch { return false; }
  }

  private callExtension(method: string, args: string = ''): string {
    const cmd = `gdbus call --session --dest ${EXT_DBUS_DEST} ` +
      `--object-path ${EXT_DBUS_PATH} ` +
      `--method ${EXT_DBUS_IFACE}.${method}${args ? ' ' + args : ''} 2>/dev/null`;
    return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
  }

  private parseExtUint(output: string): number {
    const m = output.match(/\d+/);
    return m ? parseInt(m[0], 10) : -1;
  }

  isGnomeAvailable(): boolean { return this.gnomeAvailable; }
  isExtensionAvailable(): boolean { return this.extensionAvailable; }
  hasXinput(): boolean { return this.xinputAvailable; }
  hasUinput(): boolean { return this.uinputAvailable; }

  // ─── AI Workspace Management ─────────────────────────────────────────────

  async initAiWorkspace(): Promise<number> {
    if (this.aiWorkspace >= 0) return this.aiWorkspace;

    if (this.extensionAvailable) {
      // Best path: use the GNOME Shell extension via DBus
      try {
        const out = this.callExtension('EnsureAiWorkspace');
        this.aiWorkspace = this.parseExtUint(out);
        if (this.aiWorkspace >= 0) return this.aiWorkspace;
      } catch { /* fall through */ }
    }

    if (this.gnomeAvailable) {
      const count = this.getDesktopCount();
      const newId = count;
      execSync(`gsettings set org.gnome.desktop.wm.preferences num-workspaces ${count + 1}`, { timeout: 5000 });
      try {
        const names = this.getWorkspaceNames();
        names.push('AI Desktop');
        execSync(`gsettings set org.gnome.desktop.wm.preferences workspace-names "${JSON.stringify(names)}"`, { timeout: 5000 });
      } catch { }
      this.aiWorkspace = newId;
    } else {
      this.aiWorkspace = this.simulatedDesktops.size;
      this.simulatedDesktops.set(this.aiWorkspace, {
        id: this.aiWorkspace, name: 'AI Desktop', active: false, isAiDesktop: true
      });
    }
    return this.aiWorkspace;
  }

  getAiWorkspace(): number { return this.aiWorkspace; }

  // ─── Virtual Input Devices (Multi-Mouse/Multi-Keyboard) ─────────────────

  createAiVirtualPointer(): VirtualInputDevice | null {
    // Prefer the GNOME Shell extension's Clutter.Seat virtual device (proper API)
    if (this.extensionAvailable) {
      try {
        const out = this.callExtension('CreateVirtualPointer');
        const id = this.parseExtUint(out);
        if (id > 0) {
          const dev: VirtualInputDevice = {
            id, name: 'AI Virtual Pointer (Extension)', type: 'pointer',
            masterId: id, workspace: this.aiWorkspace >= 0 ? this.aiWorkspace : 0, active: true,
          };
          this.virtualDevices.set(id, dev);
          return dev;
        }
      } catch { /* fall through */ }
    }
    if (this.xinputAvailable) return this.createXinputPointer('AI Virtual Pointer');
    if (this.uinputAvailable) return this.createUinputDevice('pointer');
    return this.createSimulatedDevice('pointer');
  }

  createAiVirtualKeyboard(): VirtualInputDevice | null {
    // Prefer the GNOME Shell extension's Clutter.Seat virtual device (proper API)
    if (this.extensionAvailable) {
      try {
        const out = this.callExtension('CreateVirtualKeyboard');
        const id = this.parseExtUint(out);
        if (id > 0) {
          const dev: VirtualInputDevice = {
            id, name: 'AI Virtual Keyboard (Extension)', type: 'keyboard',
            masterId: id, workspace: this.aiWorkspace >= 0 ? this.aiWorkspace : 0, active: true,
          };
          this.virtualDevices.set(id, dev);
          return dev;
        }
      } catch { /* fall through */ }
    }
    if (this.xinputAvailable) return this.createXinputKeyboard('AI Virtual Keyboard');
    if (this.uinputAvailable) return this.createUinputDevice('keyboard');
    return this.createSimulatedDevice('keyboard');
  }

  private createXinputPointer(name: string): VirtualInputDevice {
    try {
      const out = execSync(`xinput create-master "${name}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
      const id = this.nextVirtualId++;
      const dev: VirtualInputDevice = {
        id, name, type: 'pointer', masterId: id,
        workspace: this.aiWorkspace >= 0 ? this.aiWorkspace : 0,
        active: true,
      };
      this.virtualDevices.set(id, dev);
      return dev;
    } catch {
      return this.createSimulatedDevice('pointer');
    }
  }

  private createXinputKeyboard(name: string): VirtualInputDevice {
    try {
      const out = execSync(`xinput create-master "${name}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
      const id = this.nextVirtualId++;
      const dev: VirtualInputDevice = {
        id, name, type: 'keyboard', masterId: id,
        workspace: this.aiWorkspace >= 0 ? this.aiWorkspace : 0,
        active: true,
      };
      this.virtualDevices.set(id, dev);
      return dev;
    } catch {
      return this.createSimulatedDevice('keyboard');
    }
  }

  private createUinputDevice(type: 'pointer' | 'keyboard'): VirtualInputDevice | null {
    try {
      const devPath = type === 'pointer' ? '/dev/input/uinput_ptr' : '/dev/input/uinput_kbd';
      if (existsSync(devPath)) {
        const id = this.nextVirtualId++;
        const dev: VirtualInputDevice = {
          id, name: `AI ${type === 'pointer' ? 'Mouse' : 'Keyboard'}`,
          type, masterId: id,
          workspace: this.aiWorkspace >= 0 ? this.aiWorkspace : 0,
          active: true,
        };
        this.virtualDevices.set(id, dev);
        return dev;
      }
    } catch { }
    return null;
  }

  private createSimulatedDevice(type: 'pointer' | 'keyboard'): VirtualInputDevice {
    const id = this.nextVirtualId++;
    const dev: VirtualInputDevice = {
      id, name: `Simulated AI ${type === 'pointer' ? 'Mouse' : 'Keyboard'}`,
      type, masterId: id,
      workspace: this.aiWorkspace >= 0 ? this.aiWorkspace : 0,
      active: true,
    };
    this.virtualDevices.set(id, dev);
    return dev;
  }

  removeVirtualDevice(deviceId: number): boolean {
    const dev = this.virtualDevices.get(deviceId);
    if (!dev) return false;
    if (this.xinputAvailable) {
      try {
        execSync(`xinput remove-master ${dev.masterId} 2>/dev/null`, { timeout: 3000 });
      } catch { }
    }
    this.virtualDevices.delete(deviceId);
    return true;
  }

  getVirtualDevices(): VirtualInputDevice[] {
    return Array.from(this.virtualDevices.values());
  }

  // ─── Physical Input Device Binding ───────────────────────────────────────

  listPhysicalInputDevices(): { id: string; name: string; type: string }[] {
    if (!this.xinputAvailable) return [];
    try {
      const out = execSync('xinput list --name-only 2>/dev/null || xinput list 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      const lines = out.trim().split('\n');
      return lines.filter(l => l.length > 0).map((l, i) => {
        const isPtr = l.toLowerCase().includes('mouse') || l.toLowerCase().includes('pointer') || l.toLowerCase().includes('touch');
        return { id: String(i), name: l.trim(), type: isPtr ? 'pointer' : 'keyboard' };
      });
    } catch { return []; }
  }

  bindDeviceToWorkspace(deviceId: string, workspace: number): boolean {
    this.inputBindings.set(deviceId, {
      physicalDeviceId: deviceId,
      physicalDeviceName: deviceId,
      boundWorkspace: workspace,
    });
    return true;
  }

  unbindDevice(deviceId: string): boolean {
    return this.inputBindings.delete(deviceId);
  }

  getDeviceBinding(deviceId: string): InputBinding | undefined {
    return this.inputBindings.get(deviceId);
  }

  getAllBindings(): InputBinding[] {
    return Array.from(this.inputBindings.values());
  }

  // ─── Workspace Operations ────────────────────────────────────────────────

  createDesktop(name?: string, isAi: boolean = false): DesktopInfo {
    if (this.gnomeAvailable) {
      const count = this.getDesktopCount();
      const newId = count;
      execSync(`gsettings set org.gnome.desktop.wm.preferences num-workspaces ${count + 1}`, { timeout: 5000 });
      const info: DesktopInfo = { id: newId, name: name ?? `Desktop ${newId + 1}`, active: false, isAiDesktop: isAi };
      if (isAi) this.aiWorkspace = newId;
      return info;
    }
    const id = this.simulatedDesktops.size;
    const info: DesktopInfo = { id, name: name ?? `Desktop ${id + 1}`, active: false, isAiDesktop: isAi };
    this.simulatedDesktops.set(id, info);
    if (isAi) this.aiWorkspace = id;
    return info;
  }

  switchToDesktop(id: number): void {
    if (this.gnomeAvailable) {
      try {
        execSync(
          `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "global.workspace_manager.get_workspace_by_index(${id}).activate(global.get_current_time())" 2>/dev/null`,
          { timeout: 5000, encoding: 'utf8' }
        );
      } catch {
        try { execSync(`wmctrl -s ${id} 2>/dev/null`, { timeout: 3000 }); } catch { }
      }
      return;
    }
    for (const [, d] of this.simulatedDesktops) d.active = d.id === id;
  }

  listDesktops(): DesktopInfo[] {
    if (this.gnomeAvailable) {
      const count = this.getDesktopCount();
      const current = this.getCurrentDesktop();
      return Array.from({ length: count }, (_, i) => ({
        id: i, name: this.getWorkspaceName(i), active: i === current,
        isAiDesktop: i === this.aiWorkspace,
      }));
    }
    return Array.from(this.simulatedDesktops.values());
  }

  getCurrentDesktop(): number {
    if (this.gnomeAvailable) {
      try {
        const r = execSync(
          'gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "global.workspace_manager.get_active_workspace().index()" 2>/dev/null',
          { encoding: 'utf8', timeout: 5000 }
        );
        const m = r.match(/\d+/);
        if (m) return parseInt(m[0], 10);
      } catch {
        try {
          const r = execSync("wmctrl -d 2>/dev/null | grep '*' | awk '{print $1}'", { encoding: 'utf8', timeout: 3000 });
          return r.trim() ? parseInt(r.trim(), 10) : 0;
        } catch { }
      }
    }
    for (const [, d] of this.simulatedDesktops) if (d.active) return d.id;
    return 0;
  }

  removeDesktop(id: number): void {
    if (id === this.aiWorkspace) {
      this.removeVirtualDevicesForWorkspace(id);
      this.aiWorkspace = -1;
    }
    if (this.gnomeAvailable) {
      const count = this.getDesktopCount();
      if (count > 1) {
        if (this.getCurrentDesktop() >= id) this.switchToDesktop(0);
        execSync(`gsettings set org.gnome.desktop.wm.preferences num-workspaces ${count - 1}`, { timeout: 5000 });
      }
      return;
    }
    this.simulatedDesktops.delete(id);
    if (this.simulatedDesktops.size === 0) {
      this.simulatedDesktops.set(0, { id: 0, name: 'Desktop 1', active: true, isAiDesktop: false });
    }
  }

  moveWindowToDesktop(windowId: string, desktopId: number): void {
    try {
      execSync(`wmctrl -i -r ${windowId} -t ${desktopId} 2>/dev/null`, { timeout: 3000 });
    } catch { }
  }

  launchOnDesktop(command: string, desktopId?: number): void {
    const target = desktopId ?? this.aiWorkspace;
    if (target < 0) return;
    const cur = this.getCurrentDesktop();
    this.switchToDesktop(target);
    try {
      const proc = require('node:child_process').spawn(command, [], {
        shell: true, stdio: 'ignore', detached: true,
        env: { ...process.env, DESKTOP: String(target) },
      });
      proc.unref();
    } catch { }
    if (cur !== target) this.switchToDesktop(cur);
  }

  getDesktopCount(): number {
    if (this.gnomeAvailable) {
      try {
        const r = execSync('gsettings get org.gnome.desktop.wm.preferences num-workspaces', { encoding: 'utf8', timeout: 3000 });
        return parseInt(r.trim(), 10);
      } catch { return 1; }
    }
    return this.simulatedDesktops.size;
  }

  focusAiDesktop(): void {
    if (this.extensionAvailable) {
      try { this.callExtension('FocusAiWorkspace'); return; } catch { /* fall through */ }
    }
    if (this.aiWorkspace < 0) this.initAiWorkspace();
    this.switchToDesktop(this.aiWorkspace);
  }

  focusUserDesktop(): void {
    if (this.extensionAvailable) {
      try { this.callExtension('FocusUserWorkspace'); return; } catch { /* fall through */ }
    }
    this.switchToDesktop(this.userWorkspace);
  }

  // ─── Input Isolation ─────────────────────────────────────────────────────

  isolateAiInput(): boolean {
    if (!this.xinputAvailable) return false;
    try {
      const r = execSync('xinput list', { encoding: 'utf8', timeout: 3000 });
      const lines = r.split('\n');
      let aiMasterId = -1;
      for (const dev of this.virtualDevices.values()) {
        if (dev.active && dev.type === 'pointer') { aiMasterId = dev.masterId; break; }
      }
      if (aiMasterId < 0) return false;

      for (const line of lines) {
        const idMatch = line.match(/id=(\d+)/);
        if (!idMatch) continue;
        const physId = parseInt(idMatch[1], 10);
        const name = line.replace(/\s*id=\d+.*/, '').trim();
        if (name.includes('XTEST') || name.includes('Virtual core')) continue;
        const isKeyboard = line.includes('keyboard') || line.includes('slave  keyboard');
        const isPointer = line.includes('mouse') || line.includes('pointer') || line.includes('slave  pointer');

        if (isPointer || isKeyboard) {
          try {
            execSync(`xinput float ${physId} 2>/dev/null`, { timeout: 2000 });
          } catch { }
        }
      }
      return true;
    } catch { return false; }
  }

  restoreUserInput(): boolean {
    if (!this.xinputAvailable) return false;
    try {
      execSync('xinput reattach $(xinput list | grep "AT Translated" | grep -oP "id=\\d+" | grep -oP "\\d+") "Virtual core pointer" 2>/dev/null', { timeout: 3000 });
      return true;
    } catch { return false; }
  }

  private removeVirtualDevicesForWorkspace(workspace: number): void {
    for (const [id, dev] of this.virtualDevices) {
      if (dev.workspace === workspace) {
        this.removeVirtualDevice(id);
      }
    }
  }

  private getWorkspaceName(index: number): string {
    try {
      const names = this.getWorkspaceNames();
      return names[index] ?? `Desktop ${index + 1}`;
    } catch { return `Desktop ${index + 1}`; }
  }

  private getWorkspaceNames(): string[] {
    try {
      const r = execSync('gsettings get org.gnome.desktop.wm.preferences workspace-names 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      return JSON.parse(r.trim().replace(/^@\w+\s+/, '') || '[]');
    } catch { return []; }
  }
}
