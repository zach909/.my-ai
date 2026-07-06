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
export declare class MultiDesktopManager {
    private gnomeAvailable;
    private simulatedDesktops;
    private virtualDevices;
    private inputBindings;
    private nextVirtualId;
    private aiWorkspace;
    private userWorkspace;
    private xinputAvailable;
    private uinputAvailable;
    constructor();
    private checkGnome;
    private checkXinput;
    isGnomeAvailable(): boolean;
    hasXinput(): boolean;
    hasUinput(): boolean;
    initAiWorkspace(): Promise<number>;
    getAiWorkspace(): number;
    createAiVirtualPointer(): VirtualInputDevice | null;
    createAiVirtualKeyboard(): VirtualInputDevice | null;
    private createXinputPointer;
    private createXinputKeyboard;
    private createUinputDevice;
    private createSimulatedDevice;
    removeVirtualDevice(deviceId: number): boolean;
    getVirtualDevices(): VirtualInputDevice[];
    listPhysicalInputDevices(): {
        id: string;
        name: string;
        type: string;
    }[];
    bindDeviceToWorkspace(deviceId: string, workspace: number): boolean;
    unbindDevice(deviceId: string): boolean;
    getDeviceBinding(deviceId: string): InputBinding | undefined;
    getAllBindings(): InputBinding[];
    createDesktop(name?: string, isAi?: boolean): DesktopInfo;
    switchToDesktop(id: number): void;
    listDesktops(): DesktopInfo[];
    getCurrentDesktop(): number;
    removeDesktop(id: number): void;
    moveWindowToDesktop(windowId: string, desktopId: number): void;
    launchOnDesktop(command: string, desktopId?: number): void;
    getDesktopCount(): number;
    focusAiDesktop(): void;
    focusUserDesktop(): void;
    isolateAiInput(): boolean;
    restoreUserInput(): boolean;
    private removeVirtualDevicesForWorkspace;
    private getWorkspaceName;
    private getWorkspaceNames;
}
