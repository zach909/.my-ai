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
export declare class MultiDesktopManager {
    private sessions;
    private inputDevices;
    private currentDesktop;
    constructor();
    private initializeDefaultSessions;
    createSession(name: string, ownerId: string): DesktopSession;
    getSession(sessionId: string): DesktopSession | undefined;
    activateSession(sessionId: string): boolean;
    getCurrentSession(): DesktopSession | undefined;
    registerInputDevice(device: InputDevice): void;
    assignDeviceToDevice(deviceId: string, desktopId: string): boolean;
    getInputForDesktop(desktopId: string): InputDevice[];
    switchToDesktop(desktopId: string): boolean;
    getWorkspaceCount(desktopId: string): number;
    listSessions(): DesktopSession[];
}
export default MultiDesktopManager;
