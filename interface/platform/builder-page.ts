/**
 * Extension Builder — interface for creating and editing extensions.
 * A plain HTML page replacing the React version.
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
    max-width: 56rem;
    margin: 0 auto;
    padding: 24px;
  }
  h1 {
    font-size: 1.5rem;
    margin: 0 0 24px;
    color: #ffc4b4;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
  @media (min-width: 640px) {
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
  button {
    background: rgba(255, 154, 132, 0.16);
    border: 1px solid rgba(255, 154, 132, 0.5);
    color: #ffc4b4;
    padding: 10px 20px;
    border-radius: 999px;
    font-family: inherit;
    cursor: pointer;
    font-size: 0.9rem;
    display: inline-block;
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

  <div class="info">
    <p><strong>Create and manage custom extensions</strong> to add new capabilities to your NeuroClaw instance. Extensions run in a sandboxed environment and integrate with the core engine.</p>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Create New Extension</h2>
      <p>Start building a new extension from scratch. Choose a template or build from a blank canvas.</p>
      <button>New Extension</button>
    </div>

    <div class="card">
      <h2>Your Extensions</h2>
      <p>View, edit, and manage extensions you've created or installed.</p>
      <button>My Extensions</button>
    </div>

    <div class="card">
      <h2>Extension Templates</h2>
      <p>Browse pre-built templates for common extension patterns and use cases.</p>
      <button>Browse Templates</button>
    </div>

    <div class="card">
      <h2>Extension Gallery</h2>
      <p>Discover extensions created by other users and the community.</p>
      <button>Browse Gallery</button>
    </div>
  </div>
</main>`;
}
