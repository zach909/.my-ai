import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { MultiDesktopManager } from "../interface/multi-desktop.js";

export class MultiInputPlugin extends BasePlugin {
  private desktopManager: MultiDesktopManager;
  private virtualPointerId: number | null = null;
  private virtualKeyboardId: number | null = null;

  constructor(definition: PluginDefinition) {
    super(definition);
    this.desktopManager = new MultiDesktopManager();
  }

  async onMessage(message: unknown): Promise<unknown> {
    const msg = message as Record<string, unknown>;
    if (!msg || !msg.type) return { error: "MultiInputPlugin requires a message with 'type'" };

    switch (msg.type) {
      case "init-ai-desktop":
        return this._initAiDesktop(msg as Record<string, unknown>);
      case "create-virtual-devices":
        return this._createVirtualDevices();
      case "destroy-virtual-devices":
        return this._destroyVirtualDevices();
      case "isolate-input":
        return this._isolateInput();
      case "restore-input":
        return this._restoreInput();
      case "release-input":
        return this._releaseVirtualInput(msg as Record<string, unknown>);
      case "click":
        return this._virtualClick(msg as Record<string, unknown>);
      case "type":
        return this._virtualType(msg as Record<string, unknown>);
      case "moveto":
        return this._virtualMoveTo(msg as Record<string, unknown>);
      case "status":
        return this._status();
      case "list-physical":
        return { devices: this.desktopManager.listPhysicalInputDevices() };
      case "bind-device":
        return this._bindDevice(msg as Record<string, unknown>);
      case "unbind-device":
        return this._unbindDevice(msg as Record<string, unknown>);
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

  async onHealthCheck(): Promise<boolean> {
    return true;
  }

  private async _initAiDesktop(msg: Record<string, unknown>): Promise<unknown> {
    const ws = await this.desktopManager.initAiWorkspace();
    return { workspace: ws, desktopCount: this.desktopManager.getDesktopCount() };
  }

  private async _createVirtualDevices(): Promise<unknown> {
    await this.desktopManager.initAiWorkspace();
    const ptr = this.desktopManager.createAiVirtualPointer();
    const kbd = this.desktopManager.createAiVirtualKeyboard();
    if (ptr) this.virtualPointerId = ptr.id;
    if (kbd) this.virtualKeyboardId = kbd.id;
    return {
      pointer: ptr ? { id: ptr.id, name: ptr.name, type: ptr.type } : null,
      keyboard: kbd ? { id: kbd.id, name: kbd.name, type: kbd.type } : null,
      method: this.desktopManager.hasXinput() ? "xinput" :
              this.desktopManager.hasUinput() ? "uinput" : "simulated",
    };
  }

  private async _destroyVirtualDevices(): Promise<unknown> {
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

  private async _isolateInput(): Promise<unknown> {
    const ok = this.desktopManager.isolateAiInput();
    return { isolated: ok, method: ok ? "xinput" : "none" };
  }

  private async _restoreInput(): Promise<unknown> {
    const ok = this.desktopManager.restoreUserInput();
    return { restored: ok, method: ok ? "xinput" : "none" };
  }

  private async _releaseVirtualInput(msg: Record<string, unknown>): Promise<unknown> {
    const { x, y, button, key, type } = msg as Record<string, unknown>;
    const virtualPointer = this.desktopManager.getVirtualDevices().find(d => d.type === 'pointer');
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

  private async _virtualClick(msg: Record<string, unknown>): Promise<unknown> {
    const { button, x, y } = msg as Record<string, unknown>;
    this.desktopManager.focusAiDesktop();
    if (x !== undefined && y !== undefined) {
      await this._simulateMotion(Number(x), Number(y));
    }
    await this._simulateButton(Number(button) || 1, "click");
    return { clicked: true, button: Number(button) || 1 };
  }

  private async _virtualType(msg: Record<string, unknown>): Promise<unknown> {
    const { text } = msg as Record<string, unknown>;
    if (!text) return { error: "No text provided" };
    this.desktopManager.focusAiDesktop();
    const chars = String(text).split("");
    for (const ch of chars) {
      await this._simulateKey(ch);
    }
    return { typed: String(text).length, text: String(text) };
  }

  private async _virtualMoveTo(msg: Record<string, unknown>): Promise<unknown> {
    const { x, y } = msg as Record<string, unknown>;
    this.desktopManager.focusAiDesktop();
    await this._simulateMotion(Number(x), Number(y));
    return { moved: true, x: Number(x), y: Number(y) };
  }

  private async _simulateButton(button: number, action: "press" | "release" | "click"): Promise<void> {
    const btnArg = button === 3 ? 3 : button === 2 ? 2 : 1;
    if (this.desktopManager.hasXinput()) {
      const dev = this.desktopManager.getVirtualDevices().find(d => d.type === 'pointer');
      if (dev) {
        try {
          const cmd = `xinput click ${dev.masterId} ${btnArg}`;
          require("child_process").execSync(cmd, { timeout: 2000 });
        } catch { }
      }
    }
  }

  private async _simulateMotion(x: number, y: number): Promise<void> {
    if (this.desktopManager.hasXinput()) {
      const dev = this.desktopManager.getVirtualDevices().find(d => d.type === 'pointer');
      if (dev) {
        try {
          const cmd = `DISPLAY=:0 xdotool mousemove ${Math.round(x)} ${Math.round(y)}`;
          require("child_process").execSync(cmd, { timeout: 2000 });
        } catch { }
      }
    }
  }

  private async _simulateKey(key: string): Promise<void> {
    if (this.desktopManager.hasXinput()) {
      try {
        const safe = key.replace(/[^a-zA-Z0-9 ]/g, "").toLowerCase();
        const cmd = `DISPLAY=:0 xdotool key ${safe === " " ? "space" : safe}`;
        require("child_process").execSync(cmd, { timeout: 2000 });
      } catch { }
    }
  }

  private async _bindDevice(msg: Record<string, unknown>): Promise<unknown> {
    const { deviceId, workspace } = msg as Record<string, unknown>;
    if (typeof deviceId !== "string" || typeof workspace !== "number") {
      return { error: "deviceId (string) and workspace (number) required" };
    }
    const ok = this.desktopManager.bindDeviceToWorkspace(deviceId, workspace);
    return { bound: ok, deviceId, workspace };
  }

  private async _unbindDevice(msg: Record<string, unknown>): Promise<unknown> {
    const { deviceId } = msg as Record<string, unknown>;
    if (typeof deviceId !== "string") return { error: "deviceId (string) required" };
    return { unbound: this.desktopManager.unbindDevice(deviceId), deviceId };
  }

  private _status(): Record<string, unknown> {
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
