/**
 * The Store — catalogue of published skills, plugins, and shared content.
 * Fetches from backend APIs and displays: Store (skills/plugins), Wiki, Uploads, Community Chat.
 */

export function storePage(): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Store</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: linear-gradient(135deg, #110c0e 0%, #1b1216 100%);
    color: #f8ede9;
    font-family: ui-rounded, system-ui, sans-serif;
    font-size: 16px;
    line-height: 1.5;
  }
  main {
    max-width: 56rem;
    margin: 0 auto;
    padding: 24px;
  }
  h1 {
    font-size: 1.5rem;
    margin: 0 0 24px;
    color: #ffc4b4;
  }
  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    border-bottom: 1px solid rgba(255, 154, 132, 0.2);
    flex-wrap: wrap;
  }
  .tab-button {
    padding: 12px 16px;
    background: transparent;
    border: none;
    color: rgba(248, 237, 233, 0.62);
    font-family: inherit;
    font-size: 1rem;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .tab-button.active {
    color: #ffc4b4;
    border-bottom-color: #ff9a84;
  }
  .tab-content {
    display: none;
  }
  .tab-content.active {
    display: block;
  }
  .card {
    background: rgba(255, 154, 132, 0.08);
    border: 1px solid rgba(255, 154, 132, 0.2);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .card h3 {
    margin: 0 0 8px;
    color: #ffc4b4;
  }
  .card p {
    margin: 0 0 12px;
    color: rgba(248, 237, 233, 0.75);
    font-size: 0.9rem;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  @media (min-width: 640px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  button {
    background: rgba(255, 154, 132, 0.16);
    border: 1px solid rgba(255, 154, 132, 0.5);
    color: #ffc4b4;
    padding: 8px 16px;
    border-radius: 999px;
    font-family: inherit;
    cursor: pointer;
    font-size: 0.9rem;
  }
  button:hover {
    background: rgba(255, 154, 132, 0.24);
  }
  .loading, .error {
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .loading {
    background: rgba(255, 154, 132, 0.1);
    color: rgba(248, 237, 233, 0.75);
  }
  .error {
    background: rgba(255, 100, 100, 0.1);
    color: #ff9a84;
  }
</style>

<main>
  <h1>Store</h1>

  <div class="tabs">
    <button class="tab-button active" data-tab="store">Store</button>
    <button class="tab-button" data-tab="wiki">Wiki</button>
    <button class="tab-button" data-tab="uploads">Uploads</button>
    <button class="tab-button" data-tab="chat">Chat</button>
  </div>

  <div id="store" class="tab-content active">
    <div id="store-content"></div>
  </div>

  <div id="wiki" class="tab-content">
    <div id="wiki-content"></div>
  </div>

  <div id="uploads" class="tab-content">
    <div id="uploads-content"></div>
  </div>

  <div id="chat" class="tab-content">
    <div id="chat-content"></div>
  </div>
</main>

<script>
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      const tabName = e.target.dataset.tab;
      document.getElementById(tabName).classList.add('active');
      loadTabContent(tabName);
    });
  });

  loadTabContent('store');

  async function loadTabContent(tab) {
    try {
      if (tab === 'store') {
        const res = await fetch('/api/store');
        if (!res.ok) throw new Error('Failed to load store');
        const data = await res.json();
        displayStore(data);
      } else if (tab === 'wiki') {
        const res = await fetch('/api/wiki');
        if (!res.ok) throw new Error('Failed to load wiki pages');
        const pages = await res.json();
        displayWiki(pages);
      } else if (tab === 'uploads') {
        const res = await fetch('/api/store/installed');
        if (!res.ok) throw new Error('Failed to load uploads');
        const items = await res.json();
        displayUploads(items);
      } else if (tab === 'chat') {
        const res = await fetch('/api/shared-chat');
        if (!res.ok) throw new Error('Failed to load chat');
        const messages = await res.json();
        displayChat(messages);
      }
    } catch (e) {
      document.getElementById(tab + '-content').innerHTML = \`<div class="error">\${e.message}</div>\`;
    }
  }

  function displayStore(data) {
    const html = data.items?.map(item => \`
      <div class="card">
        <h3>\${item.name}</h3>
        <p>\${item.description || 'No description'}</p>
        <button onclick="installItem('\${item.name}')">Install</button>
      </div>
    \`).join('') || '<div class="error">No items found</div>';
    document.getElementById('store-content').innerHTML = html;
  }

  function displayWiki(pages) {
    const html = pages?.map(page => \`
      <div class="card">
        <h3>\${page.title}</h3>
        <p>\${(page.content || '').substring(0, 100)}...</p>
        <button onclick="openWikiPage('\${page.name}')">Read</button>
      </div>
    \`).join('') || '<div class="error">No wiki pages found</div>';
    document.getElementById('wiki-content').innerHTML = html;
  }

  function displayUploads(items) {
    const html = items?.map(item => \`
      <div class="card">
        <h3>\${item.name}</h3>
        <p>Type: \${item.kind}</p>
        <button onclick="manageUpload('\${item.name}')">Manage</button>
      </div>
    \`).join('') || '<div>No uploads yet</div>';
    document.getElementById('uploads-content').innerHTML = html;
  }

  function displayChat(messages) {
    const html = '<div style="color: rgba(248, 237, 233, 0.75);"><p>Shared community discussion room. Coming soon.</p></div>';
    document.getElementById('chat-content').innerHTML = html;
  }

  function installItem(name) {
    console.log('Install:', name);
  }

  function openWikiPage(name) {
    window.location.href = '/wiki/' + encodeURIComponent(name);
  }

  function manageUpload(name) {
    console.log('Manage:', name);
  }
</script>`;
}
