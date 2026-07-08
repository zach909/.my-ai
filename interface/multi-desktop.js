/**
 * Multi-desktop management for GNOME-based systems.
 * Provides isolated desktop environments for AI and user to prevent interference.
 */
export class MultiDesktopManager {
    sessions;
    inputDevices;
    currentDesktop = 'user';
    constructor() {
        this.sessions = new Map();
        this.inputDevices = new Map();
        this.initializeDefaultSessions();
    }
    initializeDefaultSessions() {
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
        // Deactivate current session
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
