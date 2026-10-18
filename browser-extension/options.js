import { DEFAULT_SERVER, describeProbe, isLocalServer, normalizeServerUrl, permissionPattern, probeServer } from './connection.js'

const $ = (id) => document.getElementById(id)
const say = (text, kind) => { $('msg').textContent = text; $('msg').className = kind || '' }

async function load() {
  const { server } = await chrome.storage.local.get('server')
  $('server').value = typeof server === 'string' && server ? server : DEFAULT_SERVER
}

$('save').addEventListener('click', async () => {
  let origin
  try { origin = normalizeServerUrl($('server').value) } catch (e) { return say(e.message, 'err') }
  if (!isLocalServer(origin)) {
    const granted = await chrome.permissions.request({ origins: [permissionPattern(origin)] })
    if (!granted) return say('Chrome did not give permission to reach that address.', 'err')
  }
  await chrome.storage.local.set({ server: origin })
  $('server').value = origin
  const d = describeProbe(await probeServer(origin))
  say(`Saved. ${d.title}. ${d.body}`, d.ok ? 'ok' : 'err')
})

$('reset').addEventListener('click', async () => {
  await chrome.storage.local.remove('server')
  $('server').value = DEFAULT_SERVER
  say('Back to the default (this computer).', 'ok')
})

load()
