export class BasePlugin {
    definition;
    active = false;
    context = null;
    constructor(definition) {
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
export class APIPlugin extends BasePlugin {
    serviceUrl;
    apiKey;
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
    skillDefinition;
    constructor(definition, skillDefinition) {
        super(definition);
        this.skillDefinition = skillDefinition;
    }
    getSkillDefinition() {
        return this.skillDefinition;
    }
}
