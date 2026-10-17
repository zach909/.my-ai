/**
 * The Linux permission tools declare an input schema; it must be enforced, not
 * just documented. Before this, a missing required argument, an undeclared
 * argument and a value outside an enum all reached the adapter (after approval).
 * Also pins the registry entry against the tool list: every tool declared once,
 * and a declaration grants nothing by itself.
 */
import { describe, it, expect } from 'vitest';
import { LINUX_PERMISSION_TOOLS, getLinuxPermissionTool, validateToolArgs } from '../../plugins/linux-permission-tools.js';
import { DEFAULT_PLUGIN_DEFINITIONS } from '../../plugin_manager/registry-data.js';

const ctx = (over: Record<string, unknown> = {}) => {
  const calls: unknown[] = [];
  return {
    calls,
    context: {
      isGranted: () => true,
      requestApproval: async () => true,
      adapters: new Proxy({}, { get: () => async (a: unknown) => { calls.push(a); return 'RAN'; } }),
      platform: 'linux' as const,
      ...over,
    } as never,
  };
};

describe('arguments are validated before approval and before the adapter', () => {
  const svc = getLinuxPermissionTool('linux_service_control')!;
  it('accepts a well formed call', async () => {
    const { context, calls } = ctx();
    expect(await svc.execute({ target: 'ssh', action: 'status' }, context)).toBe('RAN');
    expect(calls).toHaveLength(1);
  });
  for (const [label, args] of [
    ['missing required', {}],
    ['undeclared argument', { target: 'x', action: 'stop', evil: '1' }],
    ['value outside the enum', { target: 'x', action: 'rm -rf /' }],
    ['wrong type', { target: 5, action: 'stop' }],
    ['not an object', 'stop ssh'],
    ['array', ['stop']],
    ['prototype key', JSON.parse('{"target":"x","action":"stop","__proto__x":1}')],
  ] as Array<[string, unknown]>) {
    it(`refuses ${label}: the adapter is never called and nobody is asked`, async () => {
      let asked = 0;
      const { context, calls } = ctx({ requestApproval: async () => { asked++; return true; } });
      await expect(svc.execute(args as never, context)).rejects.toThrow(/Invalid arguments/);
      expect(calls).toHaveLength(0);
      expect(asked).toBe(0);
    });
  }
  it('enforces numeric bounds', () => {
    const chmod = getLinuxPermissionTool('linux_chmod')!;
    return expect(chmod.execute({ path: '/tmp/x', mode: 99999 }, ctx().context)).rejects.toThrow(/at most/);
  });
  it('validateToolArgs rejects NaN and Infinity', () => {
    const p = { n: { type: 'number' } };
    expect(validateToolArgs(p, [], { n: NaN })).toMatch(/finite/);
    expect(validateToolArgs(p, [], { n: Infinity })).toMatch(/finite/);
    expect(validateToolArgs(p, [], { n: 1 })).toBeNull();
  });
});

describe('the gates that were already there still hold', () => {
  const t = getLinuxPermissionTool('linux_file_read')!;
  it('no grant, no operation', async () => {
    const { context, calls } = ctx({ isGranted: () => false });
    await expect(t.execute({ path: '/etc/hostname' }, context)).rejects.toThrow(/Permission denied/);
    expect(calls).toHaveLength(0);
  });
  it('no approval, no operation (every tool is high or critical)', async () => {
    expect(LINUX_PERMISSION_TOOLS.every((x) => x.risk === 'high' || x.risk === 'critical')).toBe(true);
    const { context, calls } = ctx({ requestApproval: async () => false });
    await expect(t.execute({ path: '/etc/hostname' }, context)).rejects.toThrow(/approval denied/);
    expect(calls).toHaveLength(0);
  });
  it('not on Linux, no operation', async () => {
    const { context, calls } = ctx({ platform: 'win32' });
    await expect(t.execute({ path: '/etc/hostname' }, context)).rejects.toThrow(/Linux-only/);
    expect(calls).toHaveLength(0);
  });
  it('with a grant and approval but no adapter, nothing happens', async () => {
    await expect(t.execute({ path: '/etc/hostname' }, { isGranted: () => true, requestApproval: async () => true, adapters: {}, platform: 'linux' } as never)).rejects.toThrow(/no native adapter/);
  });
});

describe('the registry entry', () => {
  const caps = DEFAULT_PLUGIN_DEFINITIONS['linux-permission-tools'].capabilities as string[];
  it('lists no capability twice, and no tool or permission is duplicated', () => {
    expect(new Set(caps).size).toBe(caps.length);
    expect(new Set(LINUX_PERMISSION_TOOLS.map((x) => x.name)).size).toBe(LINUX_PERMISSION_TOOLS.length);
    expect(new Set(LINUX_PERMISSION_TOOLS.map((x) => x.permission)).size).toBe(LINUX_PERMISSION_TOOLS.length);
  });
  it('declares every tool (158) plus the umbrella "linux-permissions", and nothing else', () => {
    expect(LINUX_PERMISSION_TOOLS).toHaveLength(158);
    const perms = new Set(LINUX_PERMISSION_TOOLS.map((x) => x.permission));
    expect(caps.filter((c) => !perms.has(c as never))).toEqual(['linux-permissions']);
    expect([...perms].filter((p) => !caps.includes(p))).toEqual([]);
  });
});
