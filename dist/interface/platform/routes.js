import { ADAPTERS, CAPABILITY_IDS, detectPlatform, describeCapabilities, PLATFORM_IDS } from './adapters.js';
import { getBuildInfo } from './version.js';
import { SETTINGS_FIELDS, SettingsError, sharedSettings } from './settings-store.js';
import { checkAppUpdate } from './update.js';
import { renderIconPng } from './icon.js';
import { serviceWorkerSource, webManifest } from './pwa.js';
import { FEATURES, featureSupport } from './feature-contract.js';
const ROUTES = new Set(['/api/app-info', '/api/app-settings', '/api/app-update', '/manifest.webmanifest', '/sw.js', '/app-icon-192.png', '/app-icon-512.png']);
export const isPlatformRoute = (pathname) => ROUTES.has(pathname);
let updateCache = null;
const UPDATE_CACHE_MS = 30000;
function appInfo(req) {
    const build = getBuildInfo();
    const serverId = detectPlatform({});
    const clientId = detectPlatform({ userAgent: String(req.headers['user-agent'] ?? ''), nodePlatform: process.platform });
    const describe = (id) => {
        const a = ADAPTERS[id];
        return { id, label: a.label, uiHost: a.uiHost, engineHost: a.engineHost, runtime: a.runtime, updateMechanism: a.updateMechanism, capabilities: describeCapabilities(id) };
    };
    return {
        version: build.version,
        build,
        arch: process.arch,
        server: describe(serverId),
        client: describe(clientId),
        capabilityIds: CAPABILITY_IDS,
        platforms: PLATFORM_IDS,
        features: FEATURES.map((f) => ({ id: f.id, title: f.title, needsNetwork: !!f.needsNetwork, support: featureSupport(f, clientId) })),
    };
}
/** Returns true when the request was handled. */
export async function handlePlatformRoutes(ctx) {
    const { pathname, method, req, res } = ctx;
    if (!isPlatformRoute(pathname))
        return false;
    const head = method === 'HEAD';
    if (method !== 'GET' && !head && !(pathname === '/api/app-settings' && method === 'POST')) {
        ctx.sendJson(res, { error: 'Method not allowed.' }, 405);
        return true;
    }
    try {
        switch (pathname) {
            case '/manifest.webmanifest': {
                res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
                res.end(head ? undefined : webManifest());
                return true;
            }
            case '/sw.js': {
                res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
                res.end(head ? undefined : serviceWorkerSource());
                return true;
            }
            case '/app-icon-192.png':
            case '/app-icon-512.png': {
                const png = renderIconPng(pathname.includes('192') ? 192 : 512);
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'public, max-age=86400' });
                res.end(head ? undefined : png);
                return true;
            }
            case '/api/app-info': {
                ctx.sendJson(res, appInfo(req));
                return true;
            }
            case '/api/app-settings': {
                const store = sharedSettings();
                if (method === 'POST') {
                    if (!ctx.isAdmin()) {
                        ctx.sendJson(res, { error: 'Only the admin can change settings.' }, 403);
                        return true;
                    }
                    const body = await ctx.parseBody(req, 8192);
                    const settings = store.update(body);
                    updateCache = null;
                    ctx.sendJson(res, { settings, persistence: store.lastSave });
                    return true;
                }
                ctx.sendJson(res, { settings: store.load(), fields: SETTINGS_FIELDS, persistence: { ...store.lastSave, file: store.file } });
                return true;
            }
            case '/api/app-update': {
                const s = sharedSettings().load();
                const build = getBuildInfo();
                const platform = detectPlatform({});
                const arch = process.arch;
                const key = `${s.updates.manifestUrl}|${s.updates.channel}|${build.version}`;
                if (updateCache && updateCache.key === key && Date.now() - updateCache.at < UPDATE_CACHE_MS) {
                    ctx.sendJson(res, updateCache.status);
                    return true;
                }
                const status = await checkAppUpdate({ current: build.version, channel: s.updates.channel, platform, arch, manifestUrl: s.updates.manifestUrl });
                updateCache = { key, at: Date.now(), status };
                ctx.sendJson(res, status);
                return true;
            }
        }
    }
    catch (err) {
        if (err instanceof SettingsError) {
            ctx.sendJson(res, { error: err.message, field: err.field ?? null }, err.status);
        }
        else {
            const status = typeof err?.status === 'number' ? err.status : 500;
            ctx.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
        }
        return true;
    }
    return false;
}
