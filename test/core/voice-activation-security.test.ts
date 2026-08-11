import { describe, it, expect } from 'vitest';
import { VoiceActivationPlugin } from '../../plugins/voice-activation';

describe('VoiceActivationPlugin Wake Word Security', () => {
  const plugin = new VoiceActivationPlugin({
    id: 'voice-activation',
    name: 'Voice Activation',
    type: 'api-connection',
    capabilities: [],
  } as any);

  it('allows safe wake words', () => {
    plugin.setWakeWord('neuroclaw');
    expect(plugin.getWakeWord()).toBe('neuroclaw');

    plugin.setWakeWord('hello-world_123');
    expect(plugin.getWakeWord()).toBe('hello-world_123');
  });

  it('rejects empty, non-string, or undefined wake words', () => {
    expect(() => plugin.setWakeWord('')).toThrow(/Security Error/);
    expect(() => plugin.setWakeWord(null as any)).toThrow(/Security Error/);
    expect(() => plugin.setWakeWord(123 as any)).toThrow(/Security Error/);
  });

  it('rejects overly long wake words (DoS mitigation)', () => {
    const longWord = 'a'.repeat(65);
    expect(() => plugin.setWakeWord(longWord)).toThrow(/Security Error: Wake word exceeds maximum length/);
  });

  it('rejects wake words starting with a hyphen (argument injection mitigation)', () => {
    expect(() => plugin.setWakeWord('-neuro')).toThrow(/Security Error: Wake word cannot start with a hyphen/);
    expect(() => plugin.setWakeWord('--wake')).toThrow(/Security Error: Wake word cannot start with a hyphen/);
  });

  it('rejects wake words with invalid characters', () => {
    expect(() => plugin.setWakeWord('neuro claw')).toThrow(/Security Error/); // spaces
    expect(() => plugin.setWakeWord('neuro;claw')).toThrow(/Security Error/); // shell/command char
    expect(() => plugin.setWakeWord('neuro&claw')).toThrow(/Security Error/);
    expect(() => plugin.setWakeWord('neuro$claw')).toThrow(/Security Error/);
    expect(() => plugin.setWakeWord('neuro`claw')).toThrow(/Security Error/);
  });
});
