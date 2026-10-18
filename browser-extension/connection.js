// Talking to a NeuroClaw server from the extension: which address to use, and what its answer means.
// Plain ES module with no browser-only calls except the fetch passed in, so test/platform/extension.test.mjs
// runs it under Node.

export const DEFAULT_SERVER = 'http://localhost:7861'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Turn what someone typed into an origin like http://192.168.1.20:7861, or throw an Error that says what is wrong.
 * Only http and https, no embedded password, no path (the app lives at the root of its server).
 */
export function normalizeServerUrl(input) {
  let text = String(input ?? '').trim()
  if (!text) throw new Error('Type the address of your NeuroClaw server, for example http://localhost:7861')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`
  let url
  try { url = new URL(text) } catch { throw new Error('That does not look like an address. Try http://localhost:7861') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The address must start with http:// or https://')
  if (url.username || url.password) throw new Error('Leave the username and password out of the address; NeuroClaw asks for its password on its own page.')
  if (!url.hostname) throw new Error('The address has no computer name in it.')
  return url.origin
}

/** True for this computer (and the Chromebook's Linux container, which Chrome forwards to localhost). */
export function isLocalServer(origin) {
  try { return LOCAL_HOSTS.has(new URL(origin).hostname) } catch { return false }
}

/** The pattern chrome.permissions needs for an origin that is not already covered. */
export function permissionPattern(origin) {
  return `${new URL(origin).origin}/*`
}

/**
 * Ask the server what it is. Resolves to { state, ... } and never throws:
 *   connected   a NeuroClaw server answered /api/status
 *   needs-login it answered 401 (a remote server with a password); open it to sign in
 *   not-neuroclaw something answered, but it is not NeuroClaw
 *   unreachable nothing answered in time
 */
export async function probeServer(origin, fetchImpl = fetch, timeoutMs = 3500) {
  try {
    const res = await fetchImpl(`${origin}/api/status`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', credentials: 'omit' })
    if (res.status === 401 || res.status === 403) return { state: 'needs-login', origin }
    if (!res.ok) return { state: 'not-neuroclaw', origin, detail: `answered ${res.status}` }
    const body = await res.json().catch(() => null)
    if (body && body.running === true && body.subsystems) return { state: 'connected', origin, status: body }
    return { state: 'not-neuroclaw', origin, detail: 'it answered, but not like NeuroClaw does' }
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return { state: 'unreachable', origin, detail: timedOut ? 'no answer in time' : 'connection refused or blocked' }
  }
}

/** What to tell the person, in plain words, for each outcome. */
export function describeProbe(p) {
  switch (p.state) {
    case 'connected': return { ok: true, title: 'Connected', body: `NeuroClaw is running at ${p.origin}.` }
    case 'needs-login': return { ok: true, title: 'Connected: sign-in needed', body: `${p.origin} is a NeuroClaw server that asks for its password. Open it and sign in.` }
    case 'not-neuroclaw': return { ok: false, title: 'That is not a NeuroClaw server', body: `Something is at ${p.origin} (${p.detail}), but it is not NeuroClaw. Check the address and port (NeuroClaw uses 7861).` }
    default: return {
      ok: false,
      title: 'NeuroClaw is not reachable',
      body: `Nothing answered at ${p.origin} (${p.detail ?? 'no answer'}). This extension opens a NeuroClaw server; it does not contain one.`,
    }
  }
}
