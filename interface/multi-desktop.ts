/**
 * Multi-desktop management for GNOME-based systems.
 * Provides isolated desktop environments for AI and user to prevent interference.
 */

export interface DesktopSession {
  id: string;
  name: string;
  ownerId: string;
  isActive: boolean;
  workspaceCount: number;
}

export interface InputDevice {
  id: string;
  type: 'keyboard' | 'mouse' | 'touchpad' | 'tablet';
  name: string;
  assignedDesktop: string | null;
}

export interface VirtualDevice {
  id: string;
  type: 'keyboard' | 'mouse';
  name: string;
  created: number;
}

export interface DeviceBinding {
  deviceId: string;
  desktopId: string;
  mode: 'exclusive' | 'shared';
}

export class MultiDesktopManager {
  private sessions: Map<string, DesktopSession>;
  private inputDevices: Map<string, InputDevice>;
  private virtualDevices: Map<string, VirtualDevice>;
  private bindings: Map<string, DeviceBinding>;
  private currentDesktop: string = 'user';
  private gnomeAvailable: boolean = false;
  private xinputAvailable: boolean = false;
  private uinputAvailable: boolean = false;

  constructor() {
    this.sessions = new Map();
    this.inputDevices = new Map();
    this.virtualDevices = new Map();
    this.bindings = new Map();
    this.initializeDefaultSessions();
    this.checkSystemCapabilities();
  }

  private checkSystemCapabilities(): void {
    // Check for GNOME, xinput, uinput availability
    this.gnomeAvailable = typeof process !== 'undefined' && process.platform === 'linux';
    this.xinputAvailable = this.gnomeAvailable;
    this.uinputAvailable = this.gnomeAvailable;
  }

  private initializeDefaultSessions(): void {
    // User desktop session
    this.sessions.set('user', {
      id: 'user',
      name: 'User Desktop',
      ownerId: 'user',
      isActive: true,
      workspaceCount: 4
    });

    // AI desktop session
    this.sessions.set('ai', {
      id: 'ai',
      name: 'AI Desktop',
      ownerId: 'ai',
      isActive: false,
      workspaceCount: 8
    });
  }

  /**
   * Initialize AI workspace - activates AI desktop session
   */
  async initAiWorkspace(): Promise<string> {
    this.activateSession('ai');
    return 'ai_workspace_initialized';
  }

  /**
   * Create virtual pointer device for AI
   */
  createAiVirtualPointer(): VirtualDevice {
    const id = `virt_ptr_${Date.now()}`;
    const device: VirtualDevice = {
      id,
      type: 'mouse',
      name: 'AI Virtual Pointer',
      created: Date.now()
    };
    this.virtualDevices.set(id, device);
    this.assignDeviceToDevice(id, 'ai');
    return device;
  }

  /**
   * Create virtual keyboard device for AI
   */
  createAiVirtualKeyboard(): VirtualDevice {
    const id = `virt_kbd_${Date.now()}`;
    const device: VirtualDevice = {
      id,
      type: 'keyboard',
      name: 'AI Virtual Keyboard',
      created: Date.now()
    };
    this.virtualDevices.set(id, device);
    this.assignDeviceToDevice(id, 'ai');
    return device;
  }

  /**
   * Get AI workspace status
   */
  getAiWorkspace(): string {
    const aiSession = this.sessions.get('ai');
    return aiSession?.isActive ? 'active' : 'inactive';
  }

  /**
   * Check if GNOME is available
   */
  isGnomeAvailable(): boolean {
    return this.gnomeAvailable;
  }

  /**
   * Check if xinput is available
   */
  hasXinput(): boolean {
    return this.xinputAvailable;
  }

  /**
   * Check if uinput is available
   */
  hasUinput(): boolean {
    return this.uinputAvailable;
  }

  /**
   * Get current desktop ID
   */
  getCurrentDesktop(): string {
    return this.currentDesktop;
  }

  /**
   * List all desktops
   */
  listDesktops(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get desktop count
   */
  getDesktopCount(): number {
    return this.sessions.size;
  }

  /**
   * Get virtual devices
   */
  getVirtualDevices(): VirtualDevice[] {
    return Array.from(this.virtualDevices.values());
  }

  /**
   * Get all device bindings
   */
  getAllBindings(): DeviceBinding[] {
    return Array.from(this.bindings.values());
  }

  /**
   * Focus AI desktop
   */
  focusAiDesktop(): boolean {
    return this.switchToDesktop('ai');
  }

  /**
   * Focus user desktop
   */
  focusUserDesktop(): boolean {
    return this.switchToDesktop('user');
  }

  /**
   * List physical input devices
   */
  listPhysicalInputDevices(): InputDevice[] {
    return Array.from(this.inputDevices.values()).filter(
      d => !d.id.startsWith('virt_')
    );
  }

  /**
   * Remove virtual device
   */
  removeVirtualDevice(deviceId: string): boolean {
    return this.virtualDevices.delete(deviceId);
  }

  /**
   * Isolate AI input
   */
  isolateAiInput(): boolean {
    // Assign all virtual devices to AI desktop
    for (const [id, device] of this.virtualDevices) {
      this.assignDeviceToDevice(id, 'ai');
    }
    return true;
  }

  /**
   * Restore user input
   */
  restoreUserInput(): boolean {
    // Clear device assignments
    for (const device of this.inputDevices.values()) {
      device.assignedDesktop = null;
    }
    return true;
  }

  /**
   * Bind device to workspace
   */
  bindDeviceToWorkspace(deviceId: string, workspaceId: string, mode: 'exclusive' | 'shared' = 'exclusive'): boolean {
    const binding: DeviceBinding = {
      deviceId,
      desktopId: workspaceId,
      mode
    };
    this.bindings.set(`${deviceId}_${workspaceId}`, binding);
    return this.assignDeviceToDevice(deviceId, workspaceId);
  }

  /**
   * Unbind device
   */
  unbindDevice(deviceId: string): boolean {
    // Remove all bindings for this device
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

  createSession(name: string, ownerId: string): DesktopSession {
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session: DesktopSession = {
      id,
      name,
      ownerId,
      isActive: false,
      workspaceCount: 4
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(sessionId: string): DesktopSession | undefined {
    return this.sessions.get(sessionId);
  }

  activateSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Deactivate current session
    for (const [, s] of this.sessions) {
      s.isActive = false;
    }

    session.isActive = true;
    this.currentDesktop = sessionId;
    return true;
  }

  getCurrentSession(): DesktopSession | undefined {
    return this.sessions.get(this.currentDesktop);
  }

  registerInputDevice(device: InputDevice): void {
    this.inputDevices.set(device.id, device);
  }

  assignDeviceToDevice(deviceId: string, desktopId: string): boolean {
    const device = this.inputDevices.get(deviceId);
    if (!device) return false;
    device.assignedDesktop = desktopId;
    return true;
  }

  getInputForDesktop(desktopId: string): InputDevice[] {
    return Array.from(this.inputDevices.values()).filter(
      d => d.assignedDesktop === desktopId || d.assignedDesktop === null
    );
  }

  switchToDesktop(desktopId: string): boolean {
    return this.activateSession(desktopId);
  }

  getWorkspaceCount(desktopId: string): number {
    const session = this.sessions.get(desktopId);
    return session?.workspaceCount ?? 4;
  }

  listSessions(): DesktopSession[] {
    return Array.from(this.sessions.values());
  }
}

export default MultiDesktopManager;
