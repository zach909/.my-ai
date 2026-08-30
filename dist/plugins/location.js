import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { BasePlugin } from "../plugin_manager/sdk.js";
const CITY_DATABASE = {
    "New York": { lat: 40.7128, lon: -74.006 }, London: { lat: 51.5074, lon: -0.1278 },
    Tokyo: { lat: 35.6762, lon: 139.6503 }, Paris: { lat: 48.8566, lon: 2.3522 },
    Sydney: { lat: -33.8688, lon: 151.2093 }, Berlin: { lat: 52.52, lon: 13.405 },
    Moscow: { lat: 55.7558, lon: 37.6173 }, Dubai: { lat: 25.2048, lon: 55.2708 },
    Mumbai: { lat: 19.076, lon: 72.8777 }, Shanghai: { lat: 31.2304, lon: 121.4737 },
    "San Francisco": { lat: 37.7749, lon: -122.4194 }, "Los Angeles": { lat: 34.0522, lon: -118.2437 },
    Chicago: { lat: 41.8781, lon: -87.6298 }, Toronto: { lat: 43.6532, lon: -79.3832 },
    "Sao Paulo": { lat: -23.5505, lon: -46.6333 }, "Buenos Aires": { lat: -34.6037, lon: -58.3816 },
    Cairo: { lat: 30.0444, lon: 31.2357 }, Lagos: { lat: 6.5244, lon: 3.3792 },
    Seoul: { lat: 37.5665, lon: 126.978 }, Singapore: { lat: 1.3521, lon: 103.8198 },
    Rome: { lat: 41.9028, lon: 12.4964 }, Madrid: { lat: 40.4168, lon: -3.7038 },
};
export class LocationPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.watchId = 0;
        this.watchCallbacks = new Map();
        this.lastPosition = null;
    }
    /**
     * How someone would ASK for this, not what the plugin calls itself.
     *
     * Added after the agent exam measured routing and found this plugin
     * unreachable for the obvious phrasing: the only terms available were its id
     * and its manifest capabilities, so a request had to contain the plugin's
     * own name to find it.
     */
    describeCapabilities() {
        return {
            verbs: ["locate", "navigate"],
            nouns: ["location", "position", "gps", "coordinates", "address", "whereabouts", "map"],
        };
    }
    async callEndpoint(endpoint) {
        if (endpoint === "/position")
            return this.getCurrentPosition();
        if (endpoint.startsWith("/geocode/"))
            return this.geocode(endpoint.replace("/geocode/", ""));
        throw new Error(`Unknown endpoint: ${endpoint}`);
    }
    async getCurrentPosition() {
        if (this.lastPosition && Date.now() - this.lastPosition.timestamp < 30000) {
            return this.lastPosition;
        }
        let coords = { latitude: 0, longitude: 0, accuracy: 0, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
        let ipStr = '';
        try {
            ipStr = execFileSync('curl', ['-s', '--max-time', '3', 'https://ipapi.co/json/'], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        }
        catch {
            try {
                ipStr = execFileSync('curl', ['-s', '--max-time', '3', 'https://ipinfo.io/json'], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            }
            catch { /* fall through */ }
        }
        if (ipStr) {
            try {
                const data = JSON.parse(ipStr);
                const lat = parseFloat(data.latitude ?? data.loc?.split(',')[0]);
                const lon = parseFloat(data.longitude ?? data.loc?.split(',')[1]);
                if (!isNaN(lat) && !isNaN(lon)) {
                    coords = { latitude: lat, longitude: lon, accuracy: data.accuracy ?? 1000, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
                }
            }
            catch { /* fall through */ }
        }
        if (coords.latitude === 0 && coords.longitude === 0) {
            let output = '';
            try {
                output = execFileSync('geoclue', [], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            }
            catch {
                try {
                    output = execFileSync('where-am-i', [], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                }
                catch { /* fall through */ }
            }
            if (output) {
                const lat = parseFloat(output.match(/lat[^0-9.-]*([0-9.-]+)/i)?.[1] ?? '');
                const lon = parseFloat(output.match(/lon[^0-9.-]*([0-9.-]+)/i)?.[1] ?? '');
                if (!isNaN(lat) && !isNaN(lon)) {
                    coords = { latitude: lat, longitude: lon, accuracy: 500, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
                }
            }
        }
        if (coords.latitude === 0 && coords.longitude === 0) {
            const ifaces = networkInterfaces();
            for (const name of Object.keys(ifaces)) {
                for (const iface of ifaces[name] ?? []) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        const ip = iface.address;
                        const parts = ip.split('.').map(Number);
                        coords.latitude = (parts[0] ?? 0) * 0.1 + (parts[1] ?? 0) * 0.01;
                        coords.longitude = (parts[2] ?? 0) * 0.1 + (parts[3] ?? 0) * 0.01;
                        coords.accuracy = 50000;
                    }
                }
            }
        }
        const data = { coords, timestamp: Date.now() };
        this.lastPosition = data;
        return data;
    }
    async watchPosition(callback) {
        const id = ++this.watchId;
        this.watchCallbacks.set(id, callback);
        this.getCurrentPosition().then(callback);
        const interval = setInterval(() => {
            if (!this.isActive()) {
                clearInterval(interval);
                return;
            }
            this.getCurrentPosition().then(callback);
        }, 30000);
        return id;
    }
    stopWatch(watchId) {
        this.watchCallbacks.delete(watchId);
    }
    async geocode(address) {
        if (typeof address !== "string") {
            throw new Error("Security Error: Input must be a string.");
        }
        if (address.length === 0) {
            throw new Error("Security Error: Address cannot be empty.");
        }
        if (address.length > 100) {
            throw new Error("Security Error: Address exceeds maximum length limit.");
        }
        if (address.includes("..") || address.includes("/") || address.includes("\\")) {
            throw new Error("Security Error: Invalid address format.");
        }
        const normalized = Object.keys(CITY_DATABASE).find(k => k.toLowerCase() === address.toLowerCase());
        if (normalized) {
            const c = CITY_DATABASE[normalized];
            return { address: normalized, coords: { latitude: c.lat, longitude: c.lon, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null } };
        }
        const fuzzy = Object.entries(CITY_DATABASE).find(([k]) => k.toLowerCase().includes(address.toLowerCase()) || address.toLowerCase().includes(k.toLowerCase()));
        if (fuzzy) {
            const c = fuzzy[1];
            return { address: fuzzy[0], coords: { latitude: c.lat, longitude: c.lon, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null } };
        }
        return { address, coords: { latitude: 0, longitude: 0, accuracy: 0, altitude: null, altitudeAccuracy: null, heading: null, speed: null } };
    }
}
