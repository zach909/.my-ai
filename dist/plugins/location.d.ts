import type { PluginDefinition } from "../plugin_manager/types.js";
import { APIPlugin } from "../plugin_manager/sdk.js";
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
export declare class LocationPlugin extends APIPlugin {
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
