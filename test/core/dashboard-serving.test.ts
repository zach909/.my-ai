import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveDashboardFile } from '../../interface/web-server.js';

const dist = path.resolve(__dirname, '../../dist');
const rel = (p: string | null) => (p ? path.relative(dist, p).split(path.sep).join('/') : null);

describe('dashboard file serving', () => {
  it('maps prerendered routes to their index.html', () => {
    expect(rel(resolveDashboardFile('/app/store', dist))).toBe('app/store/index.html');
    expect(rel(resolveDashboardFile('/app', dist))).toBe('app/index.html');
  });
  it('falls back to the section entry for client-side routes', () => {
    expect(rel(resolveDashboardFile('/app/chat/some-thread', dist))).toBe('app/index.html');
  });
  it('serves built assets', () => {
    expect(resolveDashboardFile('/assets/does-not-exist.js', dist)).toBeNull();
  });
  it('never reaches the compiled backend or leaves dist/', () => {
    for (const p of ['/interface/web-server.js', '/app/../interface/main.js', '/assets/..%2F..%2Fpackage.json', '/app/%2e%2e/interface/main.js', '/app/..%5Cinterface', '/dist/interface/main.js', '/app/\0']) {
      expect(resolveDashboardFile(p, dist)).toBeNull();
    }
  });
});
