/**
 * The Store — catalogue of published skills, plugins, and shared content.
 * A plain HTML page replacing the React version.
 */

import { h } from './settings-page.js';

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
    max-width: 48rem;
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
    padding-bottom: 0;
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
    margin-bottom: -1px;
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
    <p style="color: rgba(248, 237, 233, 0.62); font-size: 0.95rem;">
      The shared catalogue of published skills, plugins, and tools. Coming soon.
    </p>
    <div class="card">
      <h3>Skills Library</h3>
      <p>Reusable skill modules and improvements from the community.</p>
      <button>Learn more</button>
    </div>
  </div>

  <div id="wiki" class="tab-content">
    <p style="color: rgba(248, 237, 233, 0.62); font-size: 0.95rem;">
      Research and reference pages published by you and the community.
    </p>
    <div class="card">
      <h3>Research Pages</h3>
      <p>Editable wiki pages backed by published files.</p>
      <button>Browse pages</button>
    </div>
  </div>

  <div id="uploads" class="tab-content">
    <p style="color: rgba(248, 237, 233, 0.62); font-size: 0.95rem;">
      Upload and manage plugin packages, skills, and tools.
    </p>
    <div class="card">
      <h3>Your Uploads</h3>
      <p>Manage files associated with published pages.</p>
      <button>Upload files</button>
    </div>
  </div>

  <div id="chat" class="tab-content">
    <p style="color: rgba(248, 237, 233, 0.62); font-size: 0.95rem;">
      Shared discussion room with the community and the engine.
    </p>
    <div class="card">
      <h3>Community Chat</h3>
      <p>Discuss published pages and share ideas.</p>
      <button>Open chat</button>
    </div>
  </div>
</main>

<script>
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = e.target.dataset.tab;
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById(tabName).classList.add('active');
    });
  });
</script>`;
}
