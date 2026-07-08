import { MultiDesktopManager } from './multi-desktop.js';
export interface SystemAccessConfig {
    multiDesktop: boolean;
    multiMouse: boolean;
    multiKeyboard: boolean;
    terminalAccess: boolean;
    fileAccess: boolean;
}
export declare class SystemAccess {
    private config;
    private multiDesktopManager;
    private osType;
    constructor(config?: Partial<SystemAccessConfig>);
    /**
     * Execute a terminal command with optional timeout
     */
    executeCommand(command: string, options?: {
        timeout?: number;
        cwd?: string;
    }): string;
    /**
     * Get the MultiDesktopManager instance
     */
    getMultiDesktop(): MultiDesktopManager;
    /**
     * Check if multi-desktop support is available
     */
    hasMultiDesktopSupport(): boolean;
    /**
     * Check if virtual input devices are supported
     */
    hasVirtualInputSupport(): boolean;
    /**
     * Get OS type
     */
    getOSType(): string;
    /**
     * Check if running on Linux with GNOME
     */
    isLinuxGNOME(): boolean;
    /**
     * Validate system capabilities for AI operation
     */
    validateCapabilities(): {
        valid: boolean;
        warnings: string[];
        errors: string[];
    };
    /**
     * Get system information
     */
    getSystemInfo(): Record<string, any>;
}
