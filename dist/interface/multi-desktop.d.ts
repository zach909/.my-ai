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
export declare class MultiDesktopManager {
    private sessions;
    private inputDevices;
    private virtualDevices;
    private bindings;
    private currentDesktop;
    private gnomeAvailable;
    private xinputAvailable;
    private uinputAvailable;
    constructor();
    private checkSystemCapabilities;
    private initializeDefaultSessions;
    /**
     * Initialize AI workspace - activates AI desktop session
     */
    initAiWorkspace(): Promise<string>;
    /**
     * Create virtual pointer device for AI
     */
    createAiVirtualPointer(): VirtualDevice;
    /**
     * Create virtual keyboard device for AI
     */
    createAiVirtualKeyboard(): VirtualDevice;
    /**
     * Get AI workspace status
     */
    getAiWorkspace(): string;
    /**
     * Check if GNOME is available
     */
    isGnomeAvailable(): boolean;
    /**
     * Check if xinput is available
     */
    hasXinput(): boolean;
    /**
     * Check if uinput is available
     */
    hasUinput(): boolean;
    /**
     * Get current desktop ID
     */
    getCurrentDesktop(): string;
    /**
     * List all desktops
     */
    listDesktops(): string[];
    /**
     * Get desktop count
     */
    getDesktopCount(): number;
    /**
     * Get virtual devices
     */
    getVirtualDevices(): VirtualDevice[];
    /**
     * Get all device bindings
     */
    getAllBindings(): DeviceBinding[];
    /**
     * Focus AI desktop
     */
    focusAiDesktop(): boolean;
    /**
     * Focus user desktop
     */
    focusUserDesktop(): boolean;
    /**
     * List physical input devices
     */
    listPhysicalInputDevices(): InputDevice[];
    /**
     * Remove virtual device
     */
    removeVirtualDevice(deviceId: string): boolean;
    /**
     * Isolate AI input
     */
    isolateAiInput(): boolean;
    /**
     * Restore user input
     */
    restoreUserInput(): boolean;
    /**
     * Bind device to workspace
     */
    bindDeviceToWorkspace(deviceId: string, workspaceId: string, mode?: 'exclusive' | 'shared'): boolean;
    /**
     * Unbind device
     */
    unbindDevice(deviceId: string): boolean;
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
