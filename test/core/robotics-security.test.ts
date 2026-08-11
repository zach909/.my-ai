import { describe, it, expect, beforeEach } from 'vitest';
import { RoboticsPlugin } from '../../plugins/robotics';

describe('RoboticsPlugin security restrictions', () => {
  let plugin: RoboticsPlugin;

  beforeEach(() => {
    plugin = new RoboticsPlugin({
      id: 'robotics',
      name: 'Robotics',
      type: 'api-connection',
      capabilities: ['robotics'],
    } as any);
  });

  it('allows simulation mode connection without endpoint', async () => {
    const res = await plugin.connect('simulation');
    expect(res.success).toBe(true);
    expect(res.message).toContain('Connected to simulated robot');
  });

  it('blocks connection endpoint starting with hyphen to prevent argument injection', async () => {
    await expect(plugin.connect('serial', '--config-file=/etc/shadow')).rejects.toThrow(
      /Security Error: Potential argument injection detected in endpoint/
    );
  });

  it('blocks path traversal serial connections that escape /dev', async () => {
    // If we're not on Windows, or if the path is treated as absolute
    await expect(plugin.connect('serial', '/etc/ttyUSB0')).rejects.toThrow(
      /Security Error: Path traversal or unauthorized serial path detected/
    );

    await expect(plugin.connect('serial', '/dev/../etc/shadow')).rejects.toThrow(
      /Security Error: Path traversal or unauthorized serial path detected/
    );

    await expect(plugin.connect('serial', '/dev')).rejects.toThrow(
      /Security Error: Path traversal or unauthorized serial path detected/
    );
  });

  it('blocks non-numeric joint values in moveJoint', async () => {
    await plugin.connect('simulation');

    await expect(plugin.moveJoint('joint_0', 'invalid-number' as any)).rejects.toThrow(
      /Security Error: position must be a valid, finite number/
    );

    await expect(plugin.moveJoint('joint_0', NaN)).rejects.toThrow(
      /Security Error: position must be a valid, finite number/
    );

    await expect(plugin.moveJoint('joint_0', Infinity)).rejects.toThrow(
      /Security Error: position must be a valid, finite number/
    );
  });

  it('blocks out of bounds positions in moveJoint', async () => {
    await plugin.connect('simulation');

    await expect(plugin.moveJoint('joint_0', 10.0)).rejects.toThrow(
      /Security Error: position is out of bounds/
    );
  });

  it('blocks jointId parameters matching prototype/built-in properties', async () => {
    await plugin.connect('simulation');

    // Attempting to move prototype-inherited property names should fail with "Unknown joint"
    const resProto = await plugin.moveJoint('__proto__', 0);
    expect(resProto.success).toBe(false);
    expect(resProto.error).toContain('Unknown joint');

    const resToString = await plugin.moveJoint('toString', 0);
    expect(resToString.success).toBe(false);
    expect(resToString.error).toContain('Unknown joint');
  });

  it('blocks sensorId parameters matching prototype/built-in properties', async () => {
    await plugin.connect('simulation');

    // Attempting to read prototype-inherited sensor property names should fail with "Unknown sensor"
    const resProto = await plugin.readSensor('__proto__');
    expect(resProto.success).toBe(false);
    expect(resProto.error).toContain('Unknown sensor');

    const resToString = await plugin.readSensor('toString');
    expect(resToString.success).toBe(false);
    expect(resToString.error).toContain('Unknown sensor');
  });
});
