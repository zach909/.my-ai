import { execFileSync } from "node:child_process";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { MultiDesktopManager } from "../interface/multi-desktop.js";
export class MultiInputPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.virtualPointerId = null;
        this.virtualKeyboardId = null;
        this.desktopManager = new MultiDesktopManager();
    }
    async onMessage(message) {
        const msg = message;
        if (!msg || !msg.type)
            return { error: "MultiInputPlugin requires a message with 'type'" };
        switch (msg.type) {
            case "init-ai-desktop":
                return this._initAiDesktop(msg);
            case "create-virtual-devices":
                return this._createVirtualDevices();
            case "destroy-virtual-devices":
                return this._destroyVirtualDevices();
            case "isolate-input":
                return this._isolateInput();
            case "restore-input":
                return this._restoreInput();
            case "release-input":
                return this._releaseVirtualInput(msg);
            case "click":
                return this._virtualClick(msg);
            case "type":
                return this._virtualType(msg);
            case "moveto":
                return this._virtualMoveTo(msg);
            case "status":
                return this._status();
            case "list-physical":
                return { devices: this.desktopManager.listPhysicalInputDevices() };
            case "bind-device":
                return this._bindDevice(msg);
            case "unbind-device":
                return this._unbindDevice(msg);
            case "bindings":
                return { bindings: this.desktopManager.getAllBindings() };
            case "list-workspaces":
                return { workspaces: this.desktopManager.listDesktops() };
            case "switch-to-ai":
                this.desktopManager.focusAiDesktop();
                return { workspace: this.desktopManager.getAiWorkspace() };
            case "switch-to-user":
                this.desktopManager.focusUserDesktop();
                return { workspace: 0 };
            default:
                return { error: `Unknown multi-input command: ${msg.type}` };
        }
    }
    async onHealthCheck() {
        return true;
    }
    _validateCoordinate(val, name) {
        if (typeof val !== "number" || !Number.isFinite(val) || val < 0 || val > 10000) {
            throw new Error(`Security Error: ${name} must be a finite number between 0 and 10000.`);
        }
        return val;
    }
    _validateButton(btn) {
        if (btn === undefined || btn === null)
            return 1;
        if (typeof btn !== "number" || !Number.isInteger(btn) || ![1, 2, 3].includes(btn)) {
            throw new Error("Security Error: Button must be 1, 2, or 3.");
        }
        return btn;
    }
    _validateDeviceId(deviceId) {
        if (typeof deviceId !== "string") {
            throw new Error("Security Error: deviceId must be a string.");
        }
        const trimmed = deviceId.trim();
        if (!trimmed) {
            throw new Error("Security Error: deviceId cannot be empty.");
        }
        if (trimmed.length > 100) {
            throw new Error("Security Error: deviceId exceeds maximum length limit of 100 characters.");
        }
        const safeRegex = /^[a-zA-Z0-9_.-]+$/;
        if (!safeRegex.test(trimmed)) {
            throw new Error("Security Error: deviceId contains invalid characters.");
        }
        return trimmed;
    }
    _validateWorkspace(workspace) {
        if (typeof workspace !== "string" && typeof workspace !== "number") {
            throw new Error("Security Error: workspace must be a string or number.");
        }
        const str = String(workspace).trim();
        if (!str) {
            throw new Error("Security Error: workspace cannot be empty.");
        }
        if (str.length > 50) {
            throw new Error("Security Error: workspace exceeds maximum length limit of 50 characters.");
        }
        const safeRegex = /^[a-zA-Z0-9_.-]+$/;
        if (!safeRegex.test(str)) {
            throw new Error("Security Error: workspace contains invalid characters.");
        }
        return str;
    }
    async _initAiDesktop(msg) {
        const ws = await this.desktopManager.initAiWorkspace();
        return { workspace: ws, desktopCount: this.desktopManager.getDesktopCount() };
    }
    async _createVirtualDevices() {
        await this.desktopManager.initAiWorkspace();
        const ptr = this.desktopManager.createAiVirtualPointer();
        const kbd = this.desktopManager.createAiVirtualKeyboard();
        if (ptr)
            this.virtualPointerId = ptr.id;
        if (kbd)
            this.virtualKeyboardId = kbd.id;
        return {
            pointer: ptr ? { id: ptr.id, name: ptr.name, type: ptr.type } : null,
            keyboard: kbd ? { id: kbd.id, name: kbd.name, type: kbd.type } : null,
            method: this.desktopManager.hasXinput() ? "xinput" :
                this.desktopManager.hasUinput() ? "uinput" : "simulated",
        };
    }
    async _destroyVirtualDevices() {
        if (this.virtualPointerId !== null) {
            this.desktopManager.removeVirtualDevice(this.virtualPointerId);
            this.virtualPointerId = null;
        }
        if (this.virtualKeyboardId !== null) {
            this.desktopManager.removeVirtualDevice(this.virtualKeyboardId);
            this.virtualKeyboardId = null;
        }
        return { destroyed: true };
    }
    async _isolateInput() {
        const ok = this.desktopManager.isolateAiInput();
        return { isolated: ok, method: ok ? "xinput" : "none" };
    }
    async _restoreInput() {
        const ok = this.desktopManager.restoreUserInput();
        return { restored: ok, method: ok ? "xinput" : "none" };
    }
    async _releaseVirtualInput(msg) {
        const { x, y, button, key, releaseType, actionType } = msg;
        const kind = (releaseType || actionType);
        if (typeof kind !== "string" || !["button", "motion", "key"].includes(kind)) {
            throw new Error("Security Error: Invalid or missing release type.");
        }
        let validatedBtn;
        let validatedX;
        let validatedY;
        if (kind === "button") {
            validatedBtn = this._validateButton(button);
        }
        else if (kind === "motion") {
            validatedX = this._validateCoordinate(x, "x");
            validatedY = this._validateCoordinate(y, "y");
        }
        else if (kind === "key") {
            if (typeof key !== "string") {
                throw new Error("Security Error: Key must be a string.");
            }
            if (key.length > 32) {
                throw new Error("Security Error: Key exceeds maximum length limit of 32 characters.");
            }
        }
        const virtualPointer = this.desktopManager.getVirtualDevices().find(d => d.type === 'mouse');
        const virtualKeyboard = this.desktopManager.getVirtualDevices().find(d => d.type === 'keyboard');
        if (!virtualPointer || !virtualKeyboard) {
            return { error: "No virtual devices available. Call create-virtual-devices first." };
        }
        // Ensure we're on AI's workspace before injecting
        this.desktopManager.focusAiDesktop();
        switch (kind) {
            case "button":
                return this._simulateButton(validatedBtn, "press");
            case "motion":
                return this._simulateMotion(validatedX, validatedY);
            case "key":
                return this._simulateKey(key);
        }
    }
    async _virtualClick(msg) {
        const { button, x, y } = msg;
        const btn = this._validateButton(button);
        this.desktopManager.focusAiDesktop();
        if (x !== undefined || y !== undefined) {
            const validX = this._validateCoordinate(x, "x");
            const validY = this._validateCoordinate(y, "y");
            await this._simulateMotion(validX, validY);
        }
        await this._simulateButton(btn, "click");
        return { clicked: true, button: btn };
    }
    async _virtualType(msg) {
        const { text } = msg;
        if (typeof text !== "string") {
            throw new Error("Security Error: Text must be a string.");
        }
        if (!text || text.trim().length === 0) {
            throw new Error("Security Error: Text cannot be empty.");
        }
        if (text.length > 1000) {
            throw new Error("Security Error: Text exceeds maximum length limit of 1000 characters.");
        }
        this.desktopManager.focusAiDesktop();
        const chars = text.split("");
        for (const ch of chars) {
            await this._simulateKey(ch);
        }
        return { typed: text.length, text };
    }
    async _virtualMoveTo(msg) {
        const { x, y } = msg;
        const validX = this._validateCoordinate(x, "x");
        const validY = this._validateCoordinate(y, "y");
        this.desktopManager.focusAiDesktop();
        await this._simulateMotion(validX, validY);
        return { moved: true, x: validX, y: validY };
    }
    async _simulateButton(button, action) {
        const btnArg = button === 3 ? 3 : button === 2 ? 2 : 1;
        if (this.desktopManager.hasXinput()) {
            const dev = this.desktopManager.getVirtualDevices().find(d => d.type === 'mouse');
            if (dev && dev.masterId !== undefined) {
                try {
                    execFileSync("xinput", ["click", String(dev.masterId), String(btnArg)], { timeout: 2000, stdio: "ignore" });
                }
                catch { }
            }
        }
    }
    async _simulateMotion(x, y) {
        if (this.desktopManager.hasXinput()) {
            const dev = this.desktopManager.getVirtualDevices().find(d => d.type === 'mouse');
            if (dev) {
                try {
                    execFileSync("xdotool", ["mousemove", String(Math.round(x)), String(Math.round(y))], {
                        timeout: 2000,
                        env: { ...process.env, DISPLAY: ":0" },
                        stdio: "ignore"
                    });
                }
                catch { }
            }
        }
    }
    async _simulateKey(key) {
        if (this.desktopManager.hasXinput()) {
            try {
                const safe = key.replace(/[^a-zA-Z0-9 ]/g, "").toLowerCase();
                if (!safe)
                    return;
                if (safe.length > 32)
                    return;
                const keyArg = safe === " " ? "space" : safe;
                execFileSync("xdotool", ["key", keyArg], {
                    timeout: 2000,
                    env: { ...process.env, DISPLAY: ":0" },
                    stdio: "ignore"
                });
            }
            catch { }
        }
    }
    async _bindDevice(msg) {
        const { deviceId, workspace } = msg;
        const validDevId = this._validateDeviceId(deviceId);
        const validWs = this._validateWorkspace(workspace);
        const ok = this.desktopManager.bindDeviceToWorkspace(validDevId, validWs);
        return { bound: ok, deviceId: validDevId, workspace: validWs };
    }
    async _unbindDevice(msg) {
        const { deviceId } = msg;
        const validDevId = this._validateDeviceId(deviceId);
        return { unbound: this.desktopManager.unbindDevice(validDevId), deviceId: validDevId };
    }
    _status() {
        return {
            gnomeAvailable: this.desktopManager.isGnomeAvailable(),
            xinputAvailable: this.desktopManager.hasXinput(),
            uinputAvailable: this.desktopManager.hasUinput(),
            aiWorkspace: this.desktopManager.getAiWorkspace(),
            virtualDevices: this.desktopManager.getVirtualDevices(),
            desktops: this.desktopManager.listDesktops(),
            currentDesktop: this.desktopManager.getCurrentDesktop(),
            bindings: this.desktopManager.getAllBindings(),
        };
    }
}
