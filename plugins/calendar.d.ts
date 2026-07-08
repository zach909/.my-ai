import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface CalendarEvent {
    id: string;
    title: string;
    description?: string;
    startTime: number;
    endTime: number;
    allDay?: boolean;
    location?: string;
    category?: string;
}
export declare class CalendarPlugin extends BasePlugin {
    private events;
    constructor(definition: PluginDefinition);
    onActivate(context: any): Promise<void>;
    list(from?: number, to?: number): Promise<CalendarEvent[]>;
    add(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent>;
    update(id: string, updates: Partial<CalendarEvent>): Promise<boolean>;
    remove(id: string): Promise<boolean>;
    getUpcoming(count?: number): Promise<CalendarEvent[]>;
    private load;
    private save;
}
