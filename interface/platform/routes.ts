/**
 * HTTP routes of the platform layer: app info, shared settings, update status,
 * and the installable-app files.
 *
 *   GET  /api/app-info        version, build, this server's platform and the viewer's, with capabilities
 *   GET  /api/app-settings    the shared settings, the field list, and whether the last save worked
 *   POST /api/app-settings    {group: {field: value}}  change settings (admin or owner)
 *   GET  /api/app-update      is this build current, behind, or could the check not complete
 *   GET  /api/ai-os           is AI OS mode (start with the computer) on, and can this viewer change it
 *   POST /api/ai-os           {enabled: boolean}  turn it on or off (admin, from the computer itself)
 *   GET  /manifest.webmanifest, /sw.js, /app-icon-192.png, /app-icon-512.png   the installable app
 *
 * Everything but the install files sits behind the server's normal gate.
 * Writing settings additionally needs the owner or an admin; a regular user may
 * read them (the look applies to their pages too) but not change them.
 */
import type http from 'node:http';
import { ADAPTERS, CAPABILITY_IDS, detectPlatform, describeCapabilities, PLATFORM_IDS, type PlatformId } from './adapters.js';
import { getBuildInfo } from './version.js';
import { SETTINGS_FIELDS, SettingsError, sharedSettings } from './settings-store.js';
import { checkAppUpdate, type UpdateStatus } from './update.js';
import { renderIconPng } from './icon.js';
import { serviceWorkerSource, webManifest } from './pwa.js';
import { FEATURES, featureSupport } from './feature-contract.js';
import { aiOsStatus, currentEnv, disableAiOs, enableAiOs } from './ai-os.js';

export interface PlatformRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  pathname: string;
  method: string;
  parseBody(req: http.IncomingMessage, maxBytes?: number): Promise<unknown>;
  sendJson(res: http.ServerResponse, data: unknown, status?: number): void;
  /** True for the machine's owner or an admin account. */
  isAdmin(): boolean;
  /** True when this request came from the computer the server runs on (not over the network). */
  fromThisMachine(): boolean;
}

const ROUTES = new Set(['/api/app-info', '/api/app-settings', '/api/app-update', '/api/ai-os', '/manifest.webmanifest', '/sw.js', '/app-icon-192.png', '/app-icon-512.png']);
export const isPlatformRoute = (pathname: string): boolean => ROUTES.has(pathname);

let updateCache: { key: string; at: number; status: UpdateStatus } | null = null;
const UPDATE_CACHE_MS = 30_000;

function appInfo(req: http.IncomingMessage) {
  const build = getBuildInfo();
  const serverId = detectPlatform({});
  const clientId = detectPlatform({ userAgent: String(req.headers['user-agent'] ?? ''), nodePlatform: process.platform });
  const describe = (id: PlatformId) => {
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
export async function handlePlatformRoutes(ctx: PlatformRouteContext): Promise<boolean> {
  const { pathname, method, req, res } = ctx;
  if (!isPlatformRoute(pathname)) return false;
  const head = method === 'HEAD';
  if (method !== 'GET' && !head && !(pathname === '/api/app-settings' && method === 'POST') && !(pathname === '/api/ai-os' && method === 'POST')) {
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
      case '/api/ai-os': {
        // Turning this on changes the computer outside the app's own folders (it adds a login item), so
        // only the admin sitting at the machine may do it; anyone past the gate may read the state.
        const canChange = ctx.isAdmin() && ctx.fromThisMachine();
        if (method === 'POST') {
          if (!ctx.isAdmin()) {
            ctx.sendJson(res, { error: 'Only the admin can change AI OS mode.' }, 403);
            return true;
          }
          if (!ctx.fromThisMachine()) {
            ctx.sendJson(res, { error: 'AI OS mode changes how this computer starts, so it can only be turned on or off from the computer itself (or with "node scripts/ai-os.mjs" in a terminal there).' }, 403);
            return true;
          }
          const body = await ctx.parseBody(req, 1024);
          const want = (body as { enabled?: unknown } | null)?.enabled;
          if (typeof want !== 'boolean') {
            ctx.sendJson(res, { error: 'Send {"enabled": true} or {"enabled": false}.' }, 400);
            return true;
          }
          const env = currentEnv();
          const result = want ? enableAiOs(env) : disableAiOs(env);
          const status = { ...aiOsStatus(env), canChange };
          // A failure carries its plain-words cause in `error`, which is what the Settings page shows.
          ctx.sendJson(res, result.ok ? { result, status } : { error: result.message, result, status }, result.ok ? 200 : 500);
          return true;
        }
        ctx.sendJson(res, { ...aiOsStatus(), canChange });
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
  } catch (err) {
    if (err instanceof SettingsError) {
      ctx.sendJson(res, { error: err.message, field: err.field ?? null }, err.status);
    } else {
      const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
      ctx.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
    }
    return true;
  }
  return false;
}
