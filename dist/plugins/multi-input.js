import { BasePlugin } from "../plugin_manager/sdk.js";
import { MultiDesktopManager } from "../interface/multi-desktop.js";
export class MultiInputPlugin extends BasePlugin {
    desktopManager;
    virtualPointerId = null;
    virtualKeyboardId = null;
    constructor(definition) {
        super(definition);
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
        const { x, y, button, key, type } = msg;
        const virtualPointer = this.desktopManager.getVirtualDevices().find(d => d.type === 'mouse');
        const virtualKeyboard = this.desktopManager.getVirtualDevices().find(d => d.type === 'keyboard');
        if (!virtualPointer || !virtualKeyboard) {
            return { error: "No virtual devices available. Call create-virtual-devices first." };
        }
        // Ensure we're on AI's workspace before injecting
        this.desktopManager.focusAiDesktop();
        switch (type) {
            case "button":
                return this._simulateButton(Number(button) || 1, "press");
            case "motion":
                return this._simulateMotion(Number(x) || 0, Number(y) || 0);
            case "key":
                return this._simulateKey(String(key || ""));
            default:
                return { error: `Unknown release type: ${type}` };
        }
    }
    async _virtualClick(msg) {
        const { button, x, y } = msg;
        this.desktopManager.focusAiDesktop();
        if (x !== undefined && y !== undefined) {
            await this._simulateMotion(Number(x), Number(y));
        }
        await this._simulateButton(Number(button) || 1, "click");
        return { clicked: true, button: Number(button) || 1 };
    }
    async _virtualType(msg) {
        const { text } = msg;
        if (!text)
            return { error: "No text provided" };
        this.desktopManager.focusAiDesktop();
        const chars = String(text).split("");
        for (const ch of chars) {
            await this._simulateKey(ch);
        }
        return { typed: String(text).length, text: String(text) };
    }
    async _virtualMoveTo(msg) {
        const { x, y } = msg;
        this.desktopManager.focusAiDesktop();
        await this._simulateMotion(Number(x), Number(y));
        return { moved: true, x: Number(x), y: Number(y) };
    }
    async _simulateButton(button, action) {
        const btnArg = button === 3 ? 3 : button === 2 ? 2 : 1;
        if (this.desktopManager.hasXinput()) {
            const dev = this.desktopManager.getVirtualDevices().find(d => d.type === 'mouse');
            if (dev && dev.masterId !== undefined) {
                try {
                    const cmd = `xinput click ${dev.masterId} ${btnArg}`;
                    require("child_process").execSync(cmd, { timeout: 2000 });
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
                    const cmd = `DISPLAY=:0 xdotool mousemove ${Math.round(x)} ${Math.round(y)}`;
                    require("child_process").execSync(cmd, { timeout: 2000 });
                }
                catch { }
            }
        }
    }
    async _simulateKey(key) {
        if (this.desktopManager.hasXinput()) {
            try {
                const safe = key.replace(/[^a-zA-Z0-9 ]/g, "").toLowerCase();
                const cmd = `DISPLAY=:0 xdotool key ${safe === " " ? "space" : safe}`;
                require("child_process").execSync(cmd, { timeout: 2000 });
            }
            catch { }
        }
    }
    async _bindDevice(msg) {
        const { deviceId, workspace } = msg;
        if (typeof deviceId !== "string" || (typeof workspace !== "string" && typeof workspace !== "number")) {
            return { error: "deviceId (string) and workspace (string) required" };
        }
        const workspaceId = String(workspace);
        const ok = this.desktopManager.bindDeviceToWorkspace(deviceId, workspaceId);
        return { bound: ok, deviceId, workspace: workspaceId };
    }
    async _unbindDevice(msg) {
        const { deviceId } = msg;
        if (typeof deviceId !== "string")
            return { error: "deviceId (string) required" };
        return { unbound: this.desktopManager.unbindDevice(deviceId), deviceId };
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
