export class BasePlugin {
    constructor(definition) {
        this.active = false;
        this.context = null;
        this.definition = definition;
    }
    getDefinition() {
        return this.definition;
    }
    isActive() {
        return this.active;
    }
    async onActivate(context) {
        this.context = context;
        this.active = true;
        context.logger.info(`Plugin ${this.definition.name} activated`);
    }
    async onDeactivate() {
        this.active = false;
        this.context = null;
    }
    async onMessage(message) {
        return message;
    }
    async onHealthCheck() {
        return this.active;
    }
}
/**
 * A plugin whose abilities are a fixed set of named tools.
 *
 * Every call goes through callTool(), whoever makes it, so anything watching
 * (the tool neuron layer) sees every call exactly once -- including ones that
 * arrived as a chat message rather than as a neuron firing. callTool() never
 * throws: a tool that fails produces an event whose error is the outcome,
 * because a failure the network is never told about is one it cannot learn
 * from.
 */
export class ToolPlugin extends BasePlugin {
    constructor() {
        super(...arguments);
        this.tools = new Map();
        this.toolObservers = new Set();
    }
    defineTool(tool) {
        this.tools.set(tool.name, tool);
    }
    /** The id tools are filed under. Falls back to the name for definitions built without an id. */
    getPluginId() {
        return this.definition.id ?? this.definition.name;
    }
    getTools() {
        return Array.from(this.tools.values());
    }
    getTool(name) {
        return this.tools.get(name);
    }
    /** Be told about every call. Returns the function that stops it. */
    onToolCall(observer) {
        this.toolObservers.add(observer);
        return () => this.toolObservers.delete(observer);
    }
    async callTool(name, args = {}, origin = "direct") {
        const startedAt = Date.now();
        const event = { plugin: this.getPluginId(), tool: name, args, origin, ok: false, startedAt, endedAt: startedAt };
        const tool = this.tools.get(name);
        if (!tool) {
            event.error = `${this.getPluginId()} has no tool called "${name}". It has: ${[...this.tools.keys()].join(", ")}.`;
        }
        else {
            const missing = tool.args.filter(arg => args[arg] === undefined || args[arg] === null);
            if (missing.length > 0) {
                event.error = `${name} needs ${missing.join(", ")}.`;
            }
            else {
                try {
                    event.result = await tool.run(args);
                    event.ok = true;
                }
                catch (err) {
                    event.error = err instanceof Error ? err.message : String(err);
                }
            }
        }
        event.endedAt = Date.now();
        for (const observer of this.toolObservers) {
            try {
                observer(event);
            }
            catch {
                // An observer that breaks must not turn a finished call into a failed one.
            }
        }
        return event;
    }
}
export class APIPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        if (!definition.serviceUrl) {
            throw new Error("serviceUrl is required for APIPlugin");
        }
        if (!definition.apiKey) {
            throw new Error("apiKey is required for APIPlugin");
        }
        this.serviceUrl = definition.serviceUrl;
        this.apiKey = definition.apiKey;
    }
    async fetchFromService(path, options) {
        const url = `${this.serviceUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(options?.headers || {}),
        };
        return fetch(url, { ...options, headers });
    }
}
export class SkillPlugin extends BasePlugin {
    constructor(definition, skillDefinition) {
        super(definition);
        this.skillDefinition = skillDefinition;
    }
    getSkillDefinition() {
        return this.skillDefinition;
    }
}
