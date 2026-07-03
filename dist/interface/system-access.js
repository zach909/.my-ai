import { MultiDesktopManager } from './multi-desktop.js';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
export class SystemAccess {
    config;
    multiDesktopManager = null;
    osType;
    constructor(config = {}) {
        this.osType = platform();
        this.config = {
            multiDesktop: config.multiDesktop ?? true,
            multiMouse: config.multiMouse ?? true,
            multiKeyboard: config.multiKeyboard ?? true,
            terminalAccess: config.terminalAccess ?? true,
            fileAccess: config.fileAccess ?? true,
        };
        if (this.config.multiDesktop) {
            this.multiDesktopManager = new MultiDesktopManager();
        }
    }
    /**
     * Execute a terminal command with optional timeout
     */
    executeCommand(command, options) {
        if (!this.config.terminalAccess) {
            throw new Error('Terminal access is disabled');
        }
        const timeout = options?.timeout ?? 30000;
        const cwd = options?.cwd;
        try {
            const result = execSync(command, {
                encoding: 'utf8',
                timeout,
                cwd,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            });
            return result;
        }
        catch (error) {
            const err = error;
            throw new Error(`Command failed: ${err.stderr || err.message}`);
        }
    }
    /**
     * Get the MultiDesktopManager instance
     */
    getMultiDesktop() {
        if (!this.multiDesktopManager) {
            this.multiDesktopManager = new MultiDesktopManager();
        }
        return this.multiDesktopManager;
    }
    /**
     * Check if multi-desktop support is available
     */
    hasMultiDesktopSupport() {
        return this.multiDesktopManager?.isGnomeAvailable() ?? false;
    }
    /**
     * Check if virtual input devices are supported
     */
    hasVirtualInputSupport() {
        if (!this.multiDesktopManager)
            return false;
        return this.multiDesktopManager.hasXinput() || this.multiDesktopManager.hasUinput();
    }
    /**
     * Get OS type
     */
    getOSType() {
        return this.osType;
    }
    /**
     * Check if running on Linux with GNOME
     */
    isLinuxGNOME() {
        return this.osType === 'linux' && this.hasMultiDesktopSupport();
    }
    /**
     * Validate system capabilities for AI operation
     */
    validateCapabilities() {
        const warnings = [];
        const errors = [];
        // Check multi-desktop
        if (this.config.multiDesktop && !this.hasMultiDesktopSupport()) {
            warnings.push('Multi-desktop support not available (GNOME not detected)');
        }
        // Check virtual input
        if ((this.config.multiMouse || this.config.multiKeyboard) && !this.hasVirtualInputSupport()) {
            warnings.push('Virtual input devices not fully supported (xinput/uinput not available)');
        }
        // Check terminal access
        if (this.config.terminalAccess) {
            try {
                this.executeCommand('echo test');
            }
            catch {
                errors.push('Terminal access failed');
            }
        }
        return {
            valid: errors.length === 0,
            warnings,
            errors,
        };
    }
    /**
     * Get system information
     */
    getSystemInfo() {
        return {
            os: this.osType,
            multiDesktop: {
                enabled: this.config.multiDesktop,
                available: this.hasMultiDesktopSupport(),
                gnomeAvailable: this.multiDesktopManager?.isGnomeAvailable() ?? false,
            },
            virtualInput: {
                multiMouseEnabled: this.config.multiMouse,
                multiKeyboardEnabled: this.config.multiKeyboard,
                xinputAvailable: this.multiDesktopManager?.hasXinput() ?? false,
                uinputAvailable: this.multiDesktopManager?.hasUinput() ?? false,
            },
            terminalAccess: this.config.terminalAccess,
            fileAccess: this.config.fileAccess,
        };
    }
}
