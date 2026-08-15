import { describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', () => {
  return {
    execFileSync: vi.fn(),
  };
});

import { AppDiagnosticsPlugin } from '../../plugins/app-diagnostics';
import { execFileSync } from 'node:child_process';

describe('AppDiagnosticsPlugin security and execution tests', () => {
  it('runs checkDisk using direct binary execFileSync without shell execution', async () => {
    vi.mocked(execFileSync).mockReturnValue(
      `Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 1000000 400000 600000 40% /\n` as any
    );

    const plugin = new AppDiagnosticsPlugin({
      id: 'app-diagnostics',
      name: 'App Diagnostics',
      type: 'system',
      capabilities: [],
    } as any);

    const diskInfo = await plugin.checkDisk();

    expect(execFileSync).toHaveBeenCalledWith('df', ['-B1', '/', '/home'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(diskInfo['/']).toEqual({
      total: 1000000,
      used: 400000,
      free: 600000,
      percent: 40,
    });
  });

  it('runs getProcessCount via runDiagnostics using direct binary execFileSync without shell execution', async () => {
    vi.mocked(execFileSync).mockReturnValue(
      `  101 ?        00:00:00 systemd\n  102 ?        00:00:00 node\n  103 ?        00:00:00 ps\n` as any
    );

    const plugin = new AppDiagnosticsPlugin({
      id: 'app-diagnostics',
      name: 'App Diagnostics',
      type: 'system',
      capabilities: [],
    } as any);

    const report = await plugin.runDiagnostics();

    expect(execFileSync).toHaveBeenCalledWith('ps', ['-e', '--no-headers'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    expect(report.system.processes).toBe(3);
    expect(report.cpu.cores).toBeGreaterThan(0);
    expect(report.memory.total).toBeGreaterThan(0);
  });

  it('handles checkDisk command failures gracefully without throwing', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('Command failed');
    });

    const plugin = new AppDiagnosticsPlugin({
      id: 'app-diagnostics',
      name: 'App Diagnostics',
      type: 'system',
      capabilities: [],
    } as any);

    const result = await plugin.checkDisk();
    expect(result).toEqual({});
  });

  it('handles getProcessCount failure gracefully without crashing runDiagnostics', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('ps failed');
    });

    const plugin = new AppDiagnosticsPlugin({
      id: 'app-diagnostics',
      name: 'App Diagnostics',
      type: 'system',
      capabilities: [],
    } as any);

    const report = await plugin.runDiagnostics();
    expect(report.system.processes).toBe(0);
  });
});
