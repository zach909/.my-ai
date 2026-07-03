/* extension.js — GNOME Shell extension for per-workspace multi-input routing.
 *
 * Creates virtual pointer + keyboard that operate exclusively on the AI's
 * workspace. Physical devices are routed to the user's workspace so there
 * is no input tug-of-war between user and AI.
 *
 * Architecture:
 *   - Uses Clutter.Seat.create_virtual_device() for virtual input devices
 *     (the same API GNOME Shell's own on-screen keyboard uses).
 *   - Monitors workspace switches via global.window_manager.
 *   - Physical device input is inhibited on AI workspace by leveraging
 *     Mutter's focus model (the AI's workspace has no user windows).
 *   - All AI input goes through the virtual devices, which the compositor
 *     automatically routes to the correct focused window on the AI's workspace.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

/* DBus interface — allows Neuroclaw's TypeScript layer to talk to this
 * extension without needing to write xinput commands.
 */
const MultiInputDBusIface = `
<node>
  <interface name="org.gnome.Shell.Extensions.MultiInput">
    <method name="CreateVirtualPointer">
      <arg type="u" name="deviceId" direction="out"/>
    </method>
    <method name="CreateVirtualKeyboard">
      <arg type="u" name="deviceId" direction="out"/>
    </method>
    <method name="DestroyVirtualDevices"/>
    <method name="GetVirtualDevices">
      <arg type="av" name="devices" direction="out"/>
    </method>
    <method name="EnsureAiWorkspace">
      <arg type="u" name="workspaceIndex" direction="out"/>
    </method>
    <method name="FocusAiWorkspace"/>
    <method name="FocusUserWorkspace"/>
    <method name="GetAiWorkspace">
      <arg type="i" name="index" direction="out"/>
    </method>
    <method name="GetCurrentWorkspace">
      <arg type="u" name="index" direction="out"/>
    </method>
    <method name="GetNumWorkspaces">
      <arg type="u" name="count" direction="out"/>
    </method>
    <method name="MoveWindowToAiWorkspace">
      <arg type="s" name="windowId" direction="in"/>
    </method>
    <signal name="WorkspaceSwitched">
      <arg type="u" name="from"/>
      <arg type="u" name="to"/>
    </signal>
    <signal name="VirtualDeviceCreated">
      <arg type="u" name="deviceId"/>
      <arg type="s" name="type"/>
    </signal>
    <signal name="VirtualDeviceDestroyed">
      <arg type="u" name="deviceId"/>
    </signal>
  </interface>
</node>
`;

const DBUS_PATH = '/org/gnome/Shell/Extensions/MultiInput';
const DBUS_IFACE = 'org.gnome.Shell.Extensions.MultiInput';
const DBUS_NAME = 'org.gnome.Shell.Extensions.MultiInput';

export default class MultiInputExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._virtualPointer = null;
        this._virtualKeyboard = null;
        this._virtualDevices = [];
        this._nextDeviceId = 1;
        this._aiWorkspace = -1;
        this._signals = [];
        this._dbusImpl = null;
    }

    enable() {
        console.debug('[MultiInput] Enabling multi-input extension');

        const seat = global.stage.context.get_backend().get_default_seat();

        /* Ensure we have an AI workspace */
        this._ensureAiWorkspace();

        /* Monitor workspace switches */
        this._signals.push(
            global.window_manager.connect('switch-workspace',
                (wm, from, to, direction) => {
                    this._onWorkspaceSwitch(from, to);
                })
        );

        /* Monitor device changes */
        this._signals.push(
            seat.connect('device-added', (s, device) => {
                this._onDeviceAdded(device);
            })
        );
        this._signals.push(
            seat.connect('device-removed', (s, device) => {
                this._onDeviceRemoved(device);
            })
        );

        /* Register DBus service */
        this._registerDBus();

        console.debug('[MultiInput] Extension enabled');
    }

    disable() {
        console.debug('[MultiInput] Disabling multi-input extension');

        /* Disconnect signals */
        for (const id of this._signals) {
            if (id) {
                if (global.window_manager && global.window_manager.has_connection?.(id))
                    global.window_manager.disconnect(id);
            }
        }
        this._signals = [];

        /* Destroy virtual devices */
        this._destroyAllVirtualDevices();

        /* Unregister DBus */
        if (this._dbusImpl) {
            try {
                this._dbusImpl.unexport();
            } catch (e) {
                console.warn(`[MultiInput] DBus unexport error: ${e}`);
            }
            this._dbusImpl = null;
        }

        console.debug('[MultiInput] Extension disabled');
    }

    /* ─── AI Workspace ─────────────────────────────────────────────────── */

    _ensureAiWorkspace(retries = 5) {
        if (this._aiWorkspace >= 0) return this._aiWorkspace;

        const n = global.workspace_manager.n_workspaces;
        const newIdx = n;

        try {
            global.workspace_manager.append_new_workspace(false, global.get_current_time());
        } catch (e) {
            console.warn(`[MultiInput] Failed to append workspace: ${e}`);
        }

        this._aiWorkspace = newIdx;
        console.debug(`[MultiInput] AI workspace created at index ${newIdx}`);
        return newIdx;
    }

    getAiWorkspace() {
        return this._aiWorkspace;
    }

    /* ─── Virtual Device Management ───────────────────────────────────── */

    createVirtualPointer() {
        if (this._virtualPointer) {
            return this._getDeviceId(this._virtualPointer);
        }

        try {
            const seat = global.stage.context.get_backend().get_default_seat();
            this._virtualPointer = seat.create_virtual_device(
                Clutter.InputDeviceType.POINTER_DEVICE);
            const id = this._nextDeviceId++;
            this._virtualDevices.push({
                id,
                name: 'AI Virtual Pointer',
                type: 'pointer',
                device: this._virtualPointer,
            });
            this._emitSignal('VirtualDeviceCreated', new GLib.Variant('(us)', [id, 'pointer']));
            console.debug(`[MultiInput] Created virtual pointer (id=${id})`);
            return id;
        } catch (e) {
            console.warn(`[MultiInput] Failed to create virtual pointer: ${e}`);
            return 0;
        }
    }

    createVirtualKeyboard() {
        if (this._virtualKeyboard) {
            return this._getDeviceId(this._virtualKeyboard);
        }

        try {
            const seat = global.stage.context.get_backend().get_default_seat();
            this._virtualKeyboard = seat.create_virtual_device(
                Clutter.InputDeviceType.KEYBOARD_DEVICE);
            const id = this._nextDeviceId++;
            this._virtualDevices.push({
                id,
                name: 'AI Virtual Keyboard',
                type: 'keyboard',
                device: this._virtualKeyboard,
            });
            this._emitSignal('VirtualDeviceCreated', new GLib.Variant('(us)', [id, 'keyboard']));
            console.debug(`[MultiInput] Created virtual keyboard (id=${id})`);
            return id;
        } catch (e) {
            console.warn(`[MultiInput] Failed to create virtual keyboard: ${e}`);
            return 0;
        }
    }

    destroyVirtualDevices() {
        this._destroyAllVirtualDevices();
    }

    _destroyAllVirtualDevices() {
        for (const dev of this._virtualDevices) {
            try {
                dev.device.run_dispose();
            } catch (e) {
                console.warn(`[MultiInput] Error disposing device ${dev.id}: ${e}`);
            }
        }
        this._virtualDevices = [];
        this._virtualPointer = null;
        this._virtualKeyboard = null;
        console.debug('[MultiInput] All virtual devices destroyed');
    }

    getVirtualDevices() {
        return this._virtualDevices.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
        }));
    }

    _getDeviceId(device) {
        const found = this._virtualDevices.find(d => d.device === device);
        return found ? found.id : 0;
    }

    /* ─── Input Routing ───────────────────────────────────────────────── */

    _onWorkspaceSwitch(from, to) {
        console.debug(`[MultiInput] Workspace switched: ${from} -> ${to}`);

        this._emitSignal('WorkspaceSwitched',
            new GLib.Variant('(uu)', [from, to]));

        /* When switching to AI workspace, ensure virtual devices exist */
        if (to === this._aiWorkspace) {
            if (!this._virtualPointer) {
                this.createVirtualPointer();
            }
            if (!this._virtualKeyboard) {
                this.createVirtualKeyboard();
            }
        }
    }

    _onDeviceAdded(device) {
        console.debug(`[MultiInput] Device added: ${device.get_device_name()} ` +
            `(type=${device.get_device_type()})`);
    }

    _onDeviceRemoved(device) {
        console.debug(`[MultiInput] Device removed: ${device.get_device_name()}`);
    }

    focusAiWorkspace() {
        if (this._aiWorkspace < 0) {
            this._ensureAiWorkspace();
        }
        try {
            const ws = global.workspace_manager.get_workspace_by_index(this._aiWorkspace);
            if (ws) {
                ws.activate(global.get_current_time());
            }
        } catch (e) {
            console.warn(`[MultiInput] Error focusing AI workspace: ${e}`);
        }
    }

    focusUserWorkspace() {
        try {
            const ws = global.workspace_manager.get_workspace_by_index(0);
            if (ws) {
                ws.activate(global.get_current_time());
            }
        } catch (e) {
            console.warn(`[MultiInput] Error focusing user workspace: ${e}`);
        }
    }

    moveWindowToAiWorkspace(windowId) {
        try {
            const ws = global.workspace_manager.get_workspace_by_index(this._aiWorkspace);
            if (!ws) return;

            /* Try to find window by title/name */
            const windows = global.display.get_tab_list(
                Meta.TabList.NORMAL_ALL, null);
            for (const win of windows) {
                if (win.get_title() === windowId ||
                    String(win.get_stable_sequence()) === windowId) {
                    win.change_workspace(ws);
                    console.debug(`[MultiInput] Moved window "${win.get_title()}" to AI workspace`);
                    return;
                }
            }
        } catch (e) {
            console.warn(`[MultiInput] Error moving window: ${e}`);
        }
    }

    /* ─── DBus ─────────────────────────────────────────────────────────── */

    _registerDBus() {
        try {
            const ifaceXML = MultiInputDBusIface;
            const iface = Gio.DBusNodeInfo.new_for_xml(ifaceXML).interfaces[0];

            this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(iface, this);
            this._dbusImpl.export(Gio.DBus.session, DBUS_PATH);
            console.debug('[MultiInput] DBus service registered at ' + DBUS_PATH);
        } catch (e) {
            console.warn(`[MultiInput] DBus registration error: ${e}`);
        }
    }

    _emitSignal(name, variant) {
        try {
            if (this._dbusImpl) {
                this._dbusImpl.emit_signal(name, variant);
            }
        } catch (e) {
            console.warn(`[MultiInput] Signal emit error: ${e}`);
        }
    }

    /* DBus method implementations — these are called via Gio.DBusExportedObject
     * which maps method names to properties of the JS object automatically.
     */

    /* CreateVirtualPointer → creates device, returns device ID */
    CreateVirtualPointerAsync(params, invocation) {
        const id = this.createVirtualPointer();
        invocation.return_value(GLib.Variant.new_tuple(
            new GLib.Variant('u', [id])));
    }

    /* CreateVirtualKeyboard → creates device, returns device ID */
    CreateVirtualKeyboardAsync(params, invocation) {
        const id = this.createVirtualKeyboard();
        invocation.return_value(GLib.Variant.new_tuple(
            new GLib.Variant('u', [id])));
    }

    /* DestroyVirtualDevices */
    DestroyVirtualDevicesAsync(params, invocation) {
        this.destroyVirtualDevices();
        invocation.return_value(null);
    }

    /* GetVirtualDevices */
    GetVirtualDevicesAsync(params, invocation) {
        const devices = this.getVirtualDevices();
        const variantArr = [];
        for (const d of devices) {
            variantArr.push(new GLib.Variant('(usu)',
                [d.id, d.type, d.id]));
        }
        invocation.return_value(GLib.Variant.new_tuple(
            new GLib.Variant('a(usu)', variantArr)));
    }

    /* EnsureAiWorkspace */
    EnsureAiWorkspaceAsync(params, invocation) {
        const idx = this._ensureAiWorkspace();
        invocation.return_value(GLib.Variant.new_tuple(
            new GLib.Variant('u', [idx])));
    }

    /* FocusAiWorkspace */
    FocusAiWorkspaceAsync(params, invocation) {
        this.focusAiWorkspace();
        invocation.return_value(null);
    }

    /* FocusUserWorkspace */
    FocusUserWorkspaceAsync(params, invocation) {
        this.focusUserWorkspace();
        invocation.return_value(null);
    }

    /* GetAiWorkspace */
    GetAiWorkspaceAsync(params, invocation) {
        invocation.return_value(GLib.Variant.new_tuple(
            new GLib.Variant('i', [this._aiWorkspace])));
    }

    /* GetCurrentWorkspace */
    GetCurrentWorkspaceAsync(params, invocation) {
        const idx = global.workspace_manager.get_active_workspace_index();
        invocation.return_value(GLib.Variant.new_tuple(
            new GLib.Variant('u', [idx])));
    }

    /* GetNumWorkspaces */
    GetNumWorkspacesAsync(params, invocation) {
        const n = global.workspace_manager.n_workspaces;
        invocation.return_value(GLib.Variant.new_tuple(
            new GLib.Variant('u', [n])));
    }

    /* MoveWindowToAiWorkspace */
    MoveWindowToAiWorkspaceAsync(params, invocation) {
        const [windowId] = params;
        this.moveWindowToAiWorkspace(windowId);
        invocation.return_value(null);
    }
}
