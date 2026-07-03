import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
export declare class MultiInputPlugin extends BasePlugin {
    private desktopManager;
    private virtualPointerId;
    private virtualKeyboardId;
    constructor(definition: PluginDefinition);
    onMessage(message: unknown): Promise<unknown>;
    onHealthCheck(): Promise<boolean>;
    private _initAiDesktop;
    private _createVirtualDevices;
    private _destroyVirtualDevices;
    private _isolateInput;
    private _restoreInput;
    private _releaseVirtualInput;
    private _virtualClick;
    private _virtualType;
    private _virtualMoveTo;
    private _simulateButton;
    private _simulateMotion;
    private _simulateKey;
    private _bindDevice;
    private _unbindDevice;
    private _status;
}
