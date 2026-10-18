// One click on the toolbar icon takes you to NeuroClaw: back to the tab that already has your server open,
// or to the launcher tab, which finds the server and opens it.
import { DEFAULT_SERVER } from './connection.js'

const launcher = chrome.runtime.getURL('app.html')

const urlOf = (tab) => tab.url || tab.pendingUrl || ''

async function focus(tab) {
  await chrome.tabs.update(tab.id, { active: true })
  await chrome.windows.update(tab.windowId, { focused: true })
  return tab.id
}

// A second click while the first is still working must not open a second tab.
let inFlight = null
function openLauncher() {
  inFlight ??= openOnce().finally(() => { inFlight = null })
  return inFlight
}

const sameOrigin = (url, origin) => { try { return new URL(url).origin === origin } catch { return false } }

async function openOnce() {
  const { server } = await chrome.storage.local.get('server')
  const origin = typeof server === 'string' && server ? server : DEFAULT_SERVER
  // The tab this extension opened last time, if it is still open and still ours (still the launcher or the server's page).
  // A tab that has not finished loading has no readable address yet, which is why this is remembered by id as well.
  const { launcherTab } = await chrome.storage.session.get('launcherTab')
  if (typeof launcherTab === 'number') {
    try {
      const t = await chrome.tabs.get(launcherTab)
      const u = urlOf(t)
      if (!u || u.startsWith(launcher) || sameOrigin(u, origin)) return focus(t)
    } catch { /* closed */ }
  }
  const tabs = await chrome.tabs.query({})
  // A tab already showing this server (its address is only visible to us for servers we may talk to).
  const open = tabs.find((t) => sameOrigin(urlOf(t), origin))
  if (open) return focus(open)
  // This extension's own pages are listed by getContexts without needing the broad "tabs" permission.
  const mine = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).find((c) => (c.documentUrl || '').startsWith(launcher))
  if (mine) return focus({ id: mine.tabId, windowId: mine.windowId })
  const created = await chrome.tabs.create({ url: launcher })
  await chrome.storage.session.set({ launcherTab: created.id })
  return created.id
}

chrome.action.onClicked.addListener(openLauncher)
// Reachable from the DevTools console of the service worker, and from the extension test, without a real toolbar click.
globalThis.openLauncher = openLauncher
