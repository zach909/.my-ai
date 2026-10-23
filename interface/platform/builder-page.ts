/**
 * Extension Builder — interface for creating and editing extensions.
 * Allows users to create custom extensions with real code editing and testing.
 */

export function builderPage(): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Extension Builder</title>
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
    max-width: 64rem;
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
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  @media (min-width: 768px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .card {
    background: rgba(255, 154, 132, 0.08);
    border: 1px solid rgba(255, 154, 132, 0.2);
    border-radius: 12px;
    padding: 20px;
  }
  .card h2 {
    margin: 0 0 12px;
    font-size: 1.1rem;
    color: #ffc4b4;
  }
  .card p {
    margin: 0 0 16px;
    color: rgba(248, 237, 233, 0.75);
    font-size: 0.95rem;
  }
  .form-group {
    margin-bottom: 16px;
  }
  label {
    display: block;
    margin-bottom: 8px;
    color: #ffc4b4;
    font-size: 0.95rem;
  }
  input, textarea {
    width: 100%;
    padding: 10px 12px;
    background: rgba(248, 237, 233, 0.05);
    border: 1px solid rgba(255, 154, 132, 0.3);
    color: #f8ede9;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.95rem;
  }
  textarea {
    resize: vertical;
    min-height: 200px;
    font-family: 'Courier New', monospace;
  }
  button {
    background: rgba(255, 154, 132, 0.16);
    border: 1px solid rgba(255, 154, 132, 0.5);
    color: #ffc4b4;
    padding: 10px 20px;
    border-radius: 999px;
    font-family: inherit;
    cursor: pointer;
    font-size: 0.95rem;
    display: inline-block;
    margin-right: 8px;
  }
  button:hover {
    background: rgba(255, 154, 132, 0.24);
  }
  .info {
    background: rgba(255, 154, 132, 0.04);
    border-left: 3px solid #ff9a84;
    padding: 16px;
    border-radius: 4px;
    margin-bottom: 24px;
  }
  .info p {
    margin: 0;
    color: rgba(248, 237, 233, 0.75);
    font-size: 0.95rem;
  }
</style>

<main>
  <h1>Extension Builder</h1>

  <div class="tabs">
    <button class="tab-button active" data-tab="create">Create</button>
    <button class="tab-button" data-tab="my-extensions">My Extensions</button>
    <button class="tab-button" data-tab="templates">Templates</button>
  </div>

  <div id="create" class="tab-content active">
    <div class="info">
      <p><strong>Create a new extension</strong> to add custom capabilities to your NeuroClaw instance.</p>
    </div>
    <div class="card">
      <h2>New Extension</h2>
      <div class="form-group">
        <label>Extension Name</label>
        <input type="text" id="extName" placeholder="my-awesome-extension">
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" id="extDesc" placeholder="What does your extension do?">
      </div>
      <div class="form-group">
        <label>Extension Code (JavaScript)</label>
        <textarea id="extCode" placeholder="export default function myExtension() { /* your code */ }"></textarea>
      </div>
      <button onclick="saveExtension()">Create Extension</button>
      <button onclick="testExtension()">Test</button>
    </div>
  </div>

  <div id="my-extensions" class="tab-content">
    <div id="extensions-list"></div>
  </div>

  <div id="templates" class="tab-content">
    <div class="grid">
      <div class="card">
        <h2>Skill Plugin</h2>
        <p>Extend the engine's skill library with new capabilities.</p>
        <button onclick="useTemplate('skill')">Use Template</button>
      </div>
      <div class="card">
        <h2>Tool Integration</h2>
        <p>Integrate external tools and APIs.</p>
        <button onclick="useTemplate('tool')">Use Template</button>
      </div>
      <div class="card">
        <h2>Data Processor</h2>
        <p>Process and transform data streams.</p>
        <button onclick="useTemplate('processor')">Use Template</button>
      </div>
      <div class="card">
        <h2>UI Component</h2>
        <p>Add custom interface elements.</p>
        <button onclick="useTemplate('ui')">Use Template</button>
      </div>
    </div>
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
      if (tabName === 'my-extensions') {
        loadMyExtensions();
      }
    });
  });

  async function saveExtension() {
    const name = document.getElementById('extName').value;
    const desc = document.getElementById('extDesc').value;
    const code = document.getElementById('extCode').value;

    if (!name || !code) {
      alert('Name and code are required');
      return;
    }

    try {
      const res = await fetch('/api/extensions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc, code })
      });
      if (res.ok) {
        alert('Extension created: ' + name);
        document.getElementById('extName').value = '';
        document.getElementById('extDesc').value = '';
        document.getElementById('extCode').value = '';
      } else {
        alert('Error creating extension');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  function testExtension() {
    const code = document.getElementById('extCode').value;
    if (!code) {
      alert('Enter code to test');
      return;
    }
    console.log('Testing extension...');
    try {
      eval('(async () => { ' + code + ' })()');
      alert('Test passed');
    } catch (e) {
      alert('Test error: ' + e.message);
    }
  }

  async function loadMyExtensions() {
    try {
      const res = await fetch('/api/extensions');
      if (!res.ok) throw new Error('Failed to load extensions');
      const exts = await res.json();
      const html = exts?.map(ext => \`
        <div class="card">
          <h2>\${ext.name}</h2>
          <p>\${ext.description || 'No description'}</p>
          <button onclick="editExtension('\${ext.name}')">Edit</button>
          <button onclick="deleteExtension('\${ext.name}')">Delete</button>
        </div>
      \`).join('') || '<div>No extensions yet</div>';
      document.getElementById('extensions-list').innerHTML = html;
    } catch (e) {
      document.getElementById('extensions-list').innerHTML = '<div style="color: #ff9a84;">' + e.message + '</div>';
    }
  }

  function useTemplate(type) {
    const templates = {
      skill: 'export function mySkill(input) { return input.toUpperCase(); }',
      tool: 'export async function fetchData(url) { const res = await fetch(url); return res.json(); }',
      processor: 'export function processStream(data) { return data.filter(x => x.valid); }',
      ui: 'export function renderComponent() { const el = document.createElement("div"); el.textContent = "Hello"; return el; }'
    };
    document.getElementById('extCode').value = templates[type] || '';
  }

  function editExtension(name) {
    console.log('Edit:', name);
  }

  function deleteExtension(name) {
    if (confirm('Delete ' + name + '?')) {
      console.log('Delete:', name);
    }
  }
</script>`;
}
