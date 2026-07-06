/**
 * Multi-desktop management for GNOME-based systems.
 * Provides isolated desktop environments for AI and user to prevent interference.
 *
 * Backed by real system integration (gsettings/xinput/uinput/wmctrl/gdbus) when
 * available, falling back to a simulated session model otherwise. This is the
 * single canonical MultiDesktopManager — do not duplicate it elsewhere.
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
    /** xinput master device id, present only when backed by a real xinput device */
    masterId?: number;
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
    /** Real GNOME workspace index backing the 'ai' session, once initialized */
    private aiGnomeWorkspaceIndex;
    constructor();
    private checkSystemCapabilities;
    private checkGnome;
    private checkXinput;
    private initializeDefaultSessions;
    /**
     * Initialize AI workspace - activates AI desktop session, creating a real
     * GNOME workspace for it when GNOME is available.
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
    private createVirtualDevice;
    /**
     * Get AI workspace status
     */
    getAiWorkspace(): string;
    isGnomeAvailable(): boolean;
    hasXinput(): boolean;
    hasUinput(): boolean;
    getCurrentDesktop(): string;
    listDesktops(): string[];
    private getRealGnomeWorkspaceCount;
    getDesktopCount(): number;
    getVirtualDevices(): VirtualDevice[];
    getAllBindings(): DeviceBinding[];
    /**
     * Focus AI desktop — switches the real GNOME workspace when available.
     */
    focusAiDesktop(): boolean;
    focusUserDesktop(): boolean;
    private switchRealGnomeWorkspace;
    /**
     * List physical input devices — queried live via xinput when available.
     */
    listPhysicalInputDevices(): InputDevice[];
    removeVirtualDevice(deviceId: string): boolean;
    /**
     * Isolate AI input — floats real physical devices off the core pointer/keyboard
     * (via xinput) in addition to the simulated assignment bookkeeping.
     */
    isolateAiInput(): boolean;
    /**
     * Restore user input — reattaches physical devices to the core pointer/keyboard
     * (via xinput) in addition to clearing simulated assignments.
     */
    restoreUserInput(): boolean;
    bindDeviceToWorkspace(deviceId: string, workspaceId: string, mode?: 'exclusive' | 'shared'): boolean;
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
