/**
 * The access manager: what the agent is ALLOWED to do to this computer.
 *
 * The GNOME access layer can reach very deep -- terminals, files, windows,
 * input synthesis, system services. The spec is explicit that this must not be
 * "an unrestricted remote-control interface", and the thing that makes it not
 * one is this file. Every capability the layer offers is checked here first,
 * and nothing is granted by being reachable.
 *
 * Two boundaries matter more than the individual permissions.
 *
 * The first is the user/agent split. The agent gets its own windows, its own
 * terminals, its own mouse and keyboard context, on the same machine. The
 * user's workspace is a different thing: observable when permitted, never
 * controllable. An agent that could type into the window you are using is not
 * assisting you, it is fighting you for the keyboard. That boundary is not a
 * permission level someone can turn up -- `controlUserWorkspace` does not
 * exist as a capability at all.
 *
 * The second is that levels are ordered and a capability is granted at a
 * level, not as a boolean. "Can see the screen" and "can click on it" are
 * different answers to different questions, and collapsing them into one
 * "desktop access" switch is how an agent ends up with far more than anyone
 * meant to give it.
 *
 * Default is deny. A capability nobody has explicitly granted is refused, and
 * the refusal says which capability and which level would have been needed --
 * a permission error that does not tell you what to grant is a dead end.
 */
/** Ordered from least to most dangerous. A grant at one level implies every level below it. */
export const ACCESS_LEVELS = ["observe", "interact", "modify", "execute", "system", "privileged"];
export const ACCESS_LEVEL_MEANING = {
    observe: "See information, change nothing.",
    interact: "Interact with the agent's own windows and applications.",
    modify: "Change files or application state.",
    execute: "Run commands and programs.",
    system: "Reach operating-system services and processes.",
    privileged: "Administrative operations that can damage the machine.",
};
/**
 * Every capability the access layer can offer. Named individually rather than
 * grouped, because "an AI that can control a window does not automatically
 * need permission to control system services or hardware" -- and a group would
 * grant exactly that.
 */
export const CAPABILITIES = [
    "screen.observe",
    "user.observe",
    "mouse.control",
    "keyboard.control",
    "window.manage",
    "app.launch",
    "terminal.open",
    "terminal.execute",
    "files.read",
    "files.write",
    "files.delete",
    "process.manage",
    "system.info",
    "system.services",
    "device.access",
    "network.configure",
];
/** The lowest level at which each capability makes sense at all. */
export const CAPABILITY_MINIMUM = {
    "screen.observe": "observe",
    "user.observe": "observe",
    "mouse.control": "interact",
    "keyboard.control": "interact",
    "window.manage": "interact",
    "app.launch": "execute",
    "terminal.open": "execute",
    "terminal.execute": "execute",
    "files.read": "observe",
    "files.write": "modify",
    "files.delete": "modify",
    "process.manage": "system",
    "system.info": "observe",
    "system.services": "system",
    "device.access": "system",
    "network.configure": "privileged",
};
/**
 * The off switches.
 *
 * Grants say what the agent *may* do. These say whether the whole thing is on
 * at all, and they exist because "revoke sixteen capabilities one at a time"
 * is not something anyone will do in the moment they want the agent to stop
 * touching their computer. Turning a switch off refuses every capability
 * underneath it without discarding the grants, so turning it back on restores
 * exactly what was there before rather than a guess at it.
 *
 * "all" is the master switch and covers both halves. The other two match the
 * two plug-ins: the GNOME graphical layer, and the non-graphical terminal and
 * files layer. Being able to turn off the desktop half while keeping the
 * terminal half is the common case -- an agent that may run builds but may not
 * touch the screen.
 */
export const ACCESS_SWITCHES = ["all", "desktop", "workspace"];
export const SWITCH_LABEL = {
    all: "All computer access",
    desktop: "GNOME desktop access",
    workspace: "Terminal and files access",
};
export const SWITCH_DESCRIPTION = {
    all: "The master switch. Off means the agent cannot touch this computer at all, whatever else is granted.",
    desktop: "Windows, screen, mouse, keyboard and application launching.",
    workspace: "Terminals, commands, files, processes and system services.",
};
/** Which switch governs each capability. Every capability belongs to exactly one. */
export const CAPABILITY_SWITCH = {
    "screen.observe": "desktop",
    "user.observe": "desktop",
    "mouse.control": "desktop",
    "keyboard.control": "desktop",
    "window.manage": "desktop",
    "app.launch": "desktop",
    "terminal.open": "workspace",
    "terminal.execute": "workspace",
    "files.read": "workspace",
    "files.write": "workspace",
    "files.delete": "workspace",
    "process.manage": "workspace",
    "system.info": "workspace",
    "system.services": "workspace",
    "device.access": "workspace",
    "network.configure": "workspace",
};
export class AccessDenied extends Error {
    constructor(capability, needed, granted, 
    /** Set when the refusal came from a switch being off rather than from a missing grant. */
    switchedOff) {
        super(switchedOff === "all"
            ? `Computer access is switched off, so "${capability}" is refused. Turn access back on to use it.`
            : switchedOff
                ? `The "${SWITCH_LABEL[switchedOff]}" switch is off, so "${capability}" is refused. Turn it back on to use it.`
                : granted === null
                    ? `"${capability}" is not granted. It needs at least "${needed}" access.`
                    : `"${capability}" is granted at "${granted}", but this needs "${needed}".`);
        this.capability = capability;
        this.needed = needed;
        this.granted = granted;
        this.switchedOff = switchedOff;
    }
}
function rank(level) {
    return ACCESS_LEVELS.indexOf(level);
}
/**
 * Holds the grants and answers the only question the access layer ever asks:
 * may I do this, at this level, to this path.
 */
export class AccessManager {
    constructor(grants = [], switches) {
        this.grants = new Map();
        /** Every switch starts on; the grants themselves are what is restrictive by default. */
        this.switches = { all: true, desktop: true, workspace: true };
        this.listeners = new Set();
        for (const g of grants)
            this.grant(g);
        if (switches)
            for (const [name, on] of Object.entries(switches))
                this.switches[name] = on;
    }
    // -- the off switches -----------------------------------------------------
    /**
     * Turn a whole layer on or off.
     *
     * Deliberately does not touch the grants. Someone flipping this off in a
     * hurry wants the agent to stop, not to lose the configuration they spent
     * time on, and an off switch that quietly wipes state is one people learn
     * not to use.
     */
    setSwitch(name, on) {
        if (this.switches[name] === on)
            return;
        this.switches[name] = on;
        const snapshot = this.switchState();
        for (const listener of this.listeners)
            listener(snapshot);
    }
    switchState() {
        return { ...this.switches };
    }
    /** Notified whenever a switch flips, so a caller can persist it without polling. */
    onSwitchChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /** Which switch is standing in the way, or null when none is. */
    blockedBy(capability) {
        if (!this.switches.all)
            return "all";
        const group = CAPABILITY_SWITCH[capability];
        return this.switches[group] ? null : group;
    }
    grant(grant) {
        const minimum = CAPABILITY_MINIMUM[grant.capability];
        if (rank(grant.level) < rank(minimum)) {
            // Refused rather than quietly raised: someone granting "observe" on a
            // capability that cannot exist below "execute" has misunderstood what
            // they are granting, and silently upgrading them would be the worst
            // possible response to that.
            throw new Error(`"${grant.capability}" cannot be granted at "${grant.level}" — it requires at least "${minimum}".`);
        }
        this.grants.set(grant.capability, grant);
    }
    revoke(capability) {
        return this.grants.delete(capability);
    }
    granted(capability) {
        return this.grants.get(capability)?.level ?? null;
    }
    list() {
        return [...this.grants.values()].sort((a, b) => a.capability.localeCompare(b.capability));
    }
    /** True when the capability is granted at or above the level it needs. */
    allows(capability, needed = CAPABILITY_MINIMUM[capability]) {
        if (this.blockedBy(capability))
            return false;
        const have = this.granted(capability);
        return have !== null && rank(have) >= rank(needed);
    }
    /** Throws AccessDenied when not allowed. Used at the top of every operation. */
    require(capability, needed = CAPABILITY_MINIMUM[capability]) {
        if (!this.allows(capability, needed)) {
            // The reason matters: "you never granted this" and "you switched it off"
            // lead to completely different next steps for whoever reads the error.
            throw new AccessDenied(capability, needed, this.granted(capability), this.blockedBy(capability) ?? undefined);
        }
    }
    /**
     * Whether a file operation may touch this path.
     *
     * Confinement is checked with a resolved prefix comparison rather than a
     * substring: "/home/me/work" must not authorise "/home/me/workspace-secrets",
     * and string containment says it does.
     */
    allowsPath(capability, absolutePath) {
        const grant = this.grants.get(capability);
        if (!grant)
            return false;
        if (!grant.paths || grant.paths.length === 0)
            return true;
        return grant.paths.some(root => absolutePath === root || absolutePath.startsWith(root.replace(/\/+$/, "") + "/"));
    }
    requirePath(capability, absolutePath, needed) {
        this.require(capability, needed);
        if (!this.allowsPath(capability, absolutePath)) {
            throw new AccessDenied(capability, needed ?? CAPABILITY_MINIMUM[capability], this.granted(capability));
        }
    }
}
/**
 * A sensible starting point: the agent can look at things and work in its own
 * terminals, and cannot touch the user's workspace, the system, or the network.
 *
 * Note what is absent. There is no grant here for `mouse.control` or
 * `keyboard.control` — input synthesis is how an agent clicks the wrong thing,
 * and it should be a decision someone makes on purpose rather than something
 * they inherit from a default.
 */
export function defaultGrants() {
    return [
        { capability: "screen.observe", level: "observe" },
        { capability: "user.observe", level: "observe" },
        { capability: "system.info", level: "observe" },
        { capability: "files.read", level: "observe" },
        { capability: "terminal.open", level: "execute" },
        { capability: "terminal.execute", level: "execute" },
    ];
}
