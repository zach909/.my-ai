import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface Coordinates {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
}
export interface LocationData {
    coords: Coordinates;
    timestamp: number;
    address?: string;
}
interface GeocodeResult {
    address: string;
    coords: Coordinates;
}
export declare class LocationPlugin extends BasePlugin {
    private watchId;
    private watchCallbacks;
    private lastPosition;
    constructor(definition: PluginDefinition);
    callEndpoint(endpoint: string): Promise<unknown>;
    getCurrentPosition(): Promise<LocationData>;
    watchPosition(callback: (data: LocationData) => void): Promise<number>;
    stopWatch(watchId: number): void;
    geocode(address: string): Promise<GeocodeResult>;
}
export {};
