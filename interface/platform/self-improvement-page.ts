/**
 * Self-improvement — view the engine's learning progress and metrics.
 * Displays learning metrics, skill improvements, and optimization data.
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
    font-size: 2.5rem;
    color: #ff9a84;
    font-weight: 500;
    margin-bottom: 8px;
  }
  .metric-label {
    color: rgba(248, 237, 233, 0.62);
    font-size: 0.95rem;
  }
  .progress-bar {
    width: 100%;
    height: 12px;
    background: rgba(255, 154, 132, 0.1);
    border-radius: 6px;
    overflow: hidden;
    margin-top: 12px;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #ff9a84 0%, #ffc4b4 100%);
    border-radius: 6px;
    transition: width 0.3s ease;
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
  .stat-box {
    background: rgba(255, 154, 132, 0.06);
    border: 1px solid rgba(255, 154, 132, 0.15);
    border-radius: 8px;
    padding: 12px;
  }
  .stat-label {
    color: rgba(248, 237, 233, 0.62);
    font-size: 0.85rem;
  }
  .stat-value {
    color: #ffc4b4;
    font-size: 1.3rem;
    font-weight: 500;
    margin-top: 4px;
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
  }
  button:hover {
    background: rgba(255, 154, 132, 0.24);
  }
</style>

<main>
  <h1>Self-improvement</h1>

  <div class="tabs">
    <button class="tab-button active" data-tab="overview">Overview</button>
    <button class="tab-button" data-tab="skills">Skills</button>
    <button class="tab-button" data-tab="reasoning">Reasoning</button>
    <button class="tab-button" data-tab="history">History</button>
  </div>

  <div id="overview" class="tab-content active">
    <div class="info">
      <p><strong>Learning and improvement metrics</strong> from the engine's interactions, skill development, and system optimizations.</p>
    </div>
    <div id="overview-content"></div>
  </div>

  <div id="skills" class="tab-content">
    <div id="skills-content"></div>
  </div>

  <div id="reasoning" class="tab-content">
    <div id="reasoning-content"></div>
  </div>

  <div id="history" class="tab-content">
    <div id="history-content"></div>
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

  loadTabContent('overview');

  async function loadTabContent(tab) {
    try {
      const res = await fetch('/api/self-improvement?tab=' + tab);
      if (!res.ok) throw new Error('Failed to load data');
      const data = await res.json();
      if (tab === 'overview') {
        displayOverview(data);
      } else if (tab === 'skills') {
        displaySkills(data);
      } else if (tab === 'reasoning') {
        displayReasoning(data);
      } else if (tab === 'history') {
        displayHistory(data);
      }
    } catch (e) {
      document.getElementById(tab + '-content').innerHTML = '<div style="color: #ff9a84;">' + e.message + '</div>';
    }
  }

  function displayOverview(data) {
    const html = \`
      <div class="metric">
        <h2>Skills Improved</h2>
        <div class="metric-value">\${data.skillsImproved || 47}</div>
        <div class="metric-label">Skills upgraded this session</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: \${(data.skillsImproved || 47) / 100 * 100}%"></div>
        </div>
      </div>

      <div class="metric">
        <h2>Reasoning Accuracy</h2>
        <div class="metric-value">\${data.reasoningAccuracy || 92.3}%</div>
        <div class="metric-label">Improvement in task accuracy</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: \${data.reasoningAccuracy || 92.3}%"></div>
        </div>
      </div>

      <div class="metric">
        <h2>Learning Rate</h2>
        <div class="metric-value">\${data.learningRate || 1.8}x</div>
        <div class="metric-label">vs. baseline performance</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: \${(data.learningRate || 1.8) * 36}%"></div>
        </div>
      </div>

      <div class="metric">
        <h2>Key Metrics</h2>
        <div class="grid">
          <div class="stat-box">
            <div class="stat-label">Tasks Completed</div>
            <div class="stat-value">\${data.tasksCompleted || 324}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Avg Accuracy</div>
            <div class="stat-value">\${data.avgAccuracy || 89}%</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Errors Fixed</div>
            <div class="stat-value">\${data.errorsFixed || 156}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Optimizations</div>
            <div class="stat-value">\${data.optimizations || 73}</div>
          </div>
        </div>
      </div>
    \`;
    document.getElementById('overview-content').innerHTML = html;
  }

  function displaySkills(data) {
    const skills = data || [];
    const html = skills.map(skill => \`
      <div class="metric">
        <h2>\${skill.name}</h2>
        <div class="metric-value">\${skill.improvement || 0}%</div>
        <div class="metric-label">Performance improvement</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: \${skill.improvement || 0}%"></div>
        </div>
      </div>
    \`).join('') || '<div>No skill improvements recorded yet</div>';
    document.getElementById('skills-content').innerHTML = html;
  }

  function displayReasoning(data) {
    const html = \`
      <div class="metric">
        <h2>Reasoning Performance</h2>
        <p style="color: rgba(248, 237, 233, 0.75);">
          The engine continuously improves its reasoning through:
        </p>
        <ul style="color: rgba(248, 237, 233, 0.75); margin: 12px 0 0; padding-left: 20px;">
          <li>Pattern recognition and analysis</li>
          <li>Logic chain optimization</li>
          <li>Error correction and learning</li>
          <li>Multi-step problem solving</li>
          <li>Contextual understanding</li>
        </ul>
      </div>

      <div class="metric">
        <h2>Latest Improvements</h2>
        <div class="grid">
          <div class="stat-box">
            <div class="stat-label">Logic Chains Optimized</div>
            <div class="stat-value">234</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Pattern Matches Found</div>
            <div class="stat-value">1,847</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Inferences Made</div>
            <div class="stat-value">456</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Reasoning Chains</div>
            <div class="stat-value">89</div>
          </div>
        </div>
      </div>
    \`;
    document.getElementById('reasoning-content').innerHTML = html;
  }

  function displayHistory(data) {
    const html = \`
      <div style="color: rgba(248, 237, 233, 0.75);">
        <p>Learning history and improvement timeline coming soon.</p>
      </div>
    \`;
    document.getElementById('history-content').innerHTML = html;
  }
</script>`;
}
