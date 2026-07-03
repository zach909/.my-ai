import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
export interface Task {
    id: string;
    title: string;
    description?: string;
    completed: boolean;
    priority: "low" | "medium" | "high";
    dueDate?: number;
    createdAt: number;
    tags: string[];
}
export declare class TasksPlugin extends BasePlugin {
    private tasks;
    constructor(definition: PluginDefinition);
    onActivate(context: any): Promise<void>;
    create(title: string, opts?: Partial<Omit<Task, "id" | "createdAt">>): Promise<Task>;
    list(filter?: {
        completed?: boolean;
        priority?: string;
        tag?: string;
    }): Promise<Task[]>;
    complete(id: string): Promise<boolean>;
    remove(id: string): Promise<boolean>;
    private load;
    private save;
}
