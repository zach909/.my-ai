// The launcher tab: find the NeuroClaw server, say plainly what is going on, and open it.
import { DEFAULT_SERVER, describeProbe, isLocalServer, normalizeServerUrl, permissionPattern, probeServer } from './connection.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
// ?stay=1 keeps this page open even when connected (used by the tests and by anyone who wants to see the status).
const stay = params.has('stay')

async function loadServer() {
  const { server } = await chrome.storage.local.get('server')
  return typeof server === 'string' && server ? server : DEFAULT_SERVER
}

function show(p) {
  const d = describeProbe(p)
  $('dot').className = `dot ${d.ok ? 'ok' : 'bad'}`
  $('title').textContent = d.title
  $('body').textContent = d.body
  $('open').href = `${p.origin}/`
  $('open-settings').href = `${p.origin}/settings`
  $('actions').hidden = false
  $('open-settings').hidden = p.state === 'unreachable' || p.state === 'not-neuroclaw'
  $('open').hidden = p.state === 'unreachable' || p.state === 'not-neuroclaw'
  $('help').open = !d.ok
  return d
}

async function check() {
  const origin = await loadServer()
  $('server').value = origin
  $('dot').className = 'dot'
  $('title').textContent = 'Looking for your server...'
  $('body').textContent = ''
  const p = await probeServer(origin)
  const d = show(p)
  if (d.ok && !stay) {
    $('title').textContent = 'Opening NeuroClaw...'
    setTimeout(() => location.replace(`${p.origin}/`), 350)
  }
  return p
}

async function saveAndTest() {
  $('err').textContent = ''
  let origin
  try { origin = normalizeServerUrl($('server').value) } catch (e) { $('err').textContent = e.message; return }
  // Chrome only lets the extension talk to a computer other than this one after the person agrees, once, for that address.
  if (!isLocalServer(origin)) {
    const granted = await chrome.permissions.request({ origins: [permissionPattern(origin)] })
    if (!granted) { $('err').textContent = 'Chrome did not give permission to reach that address, so the extension cannot check it.'; return }
  }
  await chrome.storage.local.set({ server: origin })
  await check()
}

$('retry').addEventListener('click', check)
$('save').addEventListener('click', saveAndTest)
$('server').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveAndTest() })
$('ver').textContent = `Extension version ${chrome.runtime.getManifest().version}`
check()
