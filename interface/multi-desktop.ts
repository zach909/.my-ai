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

export class MultiDesktopManager {
  private sessions: Map<string, DesktopSession>;
  private inputDevices: Map<string, InputDevice>;
  private currentDesktop: string = 'user';

  constructor() {
    this.sessions = new Map();
    this.inputDevices = new Map();
    this.initializeDefaultSessions();
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
