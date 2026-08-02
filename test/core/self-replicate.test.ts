/**
 * Regression test for plugins/self_replicate.ts's exported `tools` object:
 * every entry used to construct `new SelfReplicatePlugin()` inside its own
 * call, but clones live in `this.clones` (instance state), so clone() wrote
 * into a Map that every other tool's own fresh instance could never see --
 * list_clones() always reported zero clones, and get_clone()/send_prompt()/
 * terminate_clone()/clone_status()/set_clone_config() always reported
 * "not found", even immediately after clone() itself returned success.
 */

import { tools } from '../../plugins/self_replicate';

describe('self_replicate tools object shares plugin state across calls', () => {
  it('list_clones() sees a clone created by a separate clone() call', () => {
    const created = tools.clone('test prompt');
    expect(created.success).toBe(true);

    const listed = tools.list_clones();
    expect(listed.count).toBeGreaterThanOrEqual(1);
    expect(listed.clones.some((c) => c.id === created.clone_id)).toBe(true);
  });

  it('get_clone() finds a clone created by a separate clone() call', () => {
    const created = tools.clone('another prompt');
    const got = tools.get_clone(created.clone_id);
    expect('error' in got).toBe(false);
    if (!('error' in got)) {
      expect(got.id).toBe(created.clone_id);
    }
  });

  it('send_prompt() reaches a clone created by a separate clone() call', () => {
    const created = tools.clone('yet another prompt');
    const result = tools.send_prompt(created.clone_id, 'hello clone');
    expect('error' in result).toBe(false);
  });
});
