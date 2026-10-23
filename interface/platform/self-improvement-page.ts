/**
 * Self-improvement — view the engine's learning progress and metrics.
 * A plain HTML page replacing the React version.
 */

export function selfImprovementPage(): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Self-improvement</title>
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
  .metric {
    background: rgba(255, 154, 132, 0.08);
    border: 1px solid rgba(255, 154, 132, 0.2);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .metric h2 {
    margin: 0 0 12px;
    font-size: 1.1rem;
    color: #ffc4b4;
  }
  .metric-value {
    font-size: 2rem;
    color: #ff9a84;
    font-weight: 500;
    margin-bottom: 8px;
  }
  .metric-label {
    color: rgba(248, 237, 233, 0.62);
    font-size: 0.9rem;
  }
  .progress-bar {
    width: 100%;
    height: 8px;
    background: rgba(255, 154, 132, 0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 12px;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #ff9a84 0%, #ffc4b4 100%);
    border-radius: 4px;
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
  <h1>Self-improvement</h1>

  <div class="info">
    <p><strong>Learning and improvement metrics</strong> from the engine's interactions, skill development, and system optimizations over time.</p>
  </div>

  <div class="metric">
    <h2>Skills Improved</h2>
    <div class="metric-value">47</div>
    <div class="metric-label">Skills upgraded this session</div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: 65%"></div>
    </div>
  </div>

  <div class="metric">
    <h2>Reasoning Accuracy</h2>
    <div class="metric-value">92.3%</div>
    <div class="metric-label">Improvement in task accuracy</div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: 92.3%"></div>
    </div>
  </div>

  <div class="metric">
    <h2>Learning Rate</h2>
    <div class="metric-value">1.8x</div>
    <div class="metric-label">vs. baseline performance</div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: 72%"></div>
    </div>
  </div>

  <div class="metric">
    <h2>Recent Improvements</h2>
    <p style="color: rgba(248, 237, 233, 0.75); margin: 0; font-size: 0.95rem;">
      The engine continuously improves through:
    </p>
    <ul style="color: rgba(248, 237, 233, 0.75); font-size: 0.95rem; margin: 12px 0 0; padding-left: 20px;">
      <li>Skill refinement and optimization</li>
      <li>Error correction and adaptation</li>
      <li>Memory consolidation and recall improvement</li>
      <li>Plugin integration and extension development</li>
    </ul>
  </div>

  <div style="text-align: center; margin-top: 32px;">
    <button>View Detailed Report</button>
  </div>
</main>`;
}
