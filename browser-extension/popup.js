// NeuroClaw Chance popup: random idea picker. Built-in ideas live in
// ideas.json (a copy of src/lib/chance-ideas.json); custom ones in
// chrome.storage.local. "Try it in chat" copies the idea and opens the
// local app's Chats page.
const APP_URL = 'http://localhost:3000/app/chat'
const api = globalThis.browser ?? globalThis.chrome

const ideaEl = document.getElementById('idea')
const rollBtn = document.getElementById('roll')
const tryBtn = document.getElementById('try')
const statusEl = document.getElementById('status')
let builtIn = []
let custom = []
let current = null

async function init() {
  builtIn = await fetch('ideas.json').then((r) => r.json()).catch(() => [])
  const stored = await api.storage.local.get('custom')
  custom = Array.isArray(stored.custom) ? stored.custom : []
  statusEl.textContent = `${builtIn.length + custom.length} ideas in the pool`
}

function roll() {
  const all = [...builtIn, ...custom]
  if (!all.length) return
  let next = all[Math.floor(Math.random() * all.length)]
  if (all.length > 1) while (next === current) next = all[Math.floor(Math.random() * all.length)]
  current = next
  ideaEl.textContent = next
  rollBtn.textContent = 'Roll again'
  tryBtn.disabled = false
}

rollBtn.addEventListener('click', roll)
tryBtn.addEventListener('click', async () => {
  if (!current) return
  try { await navigator.clipboard.writeText(current) } catch {}
  api.tabs.create({ url: APP_URL })
})
document.getElementById('add').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('draft')
  const text = input.value.trim()
  if (!text) return
  custom.push(text)
  await api.storage.local.set({ custom })
  input.value = ''
  statusEl.textContent = `Added! ${builtIn.length + custom.length} ideas in the pool`
})

init()
