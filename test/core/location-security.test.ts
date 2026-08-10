import { describe, it, expect } from 'vitest';
import { LocationPlugin } from '../../plugins/location';

describe('LocationPlugin Security Validation', () => {
  const plugin = new LocationPlugin({
    id: 'location',
    name: 'Location',
    type: 'api-connection',
    capabilities: [],
  } as any);

  it('allows safe, valid city names', async () => {
    const result = await plugin.geocode('tokyo');
    expect(result.address).toBe('Tokyo');
  });

  it('rejects non-string inputs with a Security Error', async () => {
    await expect(plugin.geocode(123 as any)).rejects.toThrowError('Security Error: Input must be a string.');
    await expect(plugin.geocode(null as any)).rejects.toThrowError('Security Error: Input must be a string.');
    await expect(plugin.geocode({} as any)).rejects.toThrowError('Security Error: Input must be a string.');
  });

  it('rejects empty strings with a Security Error', async () => {
    await expect(plugin.geocode('')).rejects.toThrowError('Security Error: Address cannot be empty.');
  });

  it('rejects excessively long strings with a Security Error', async () => {
    const longStr = 'a'.repeat(101);
    await expect(plugin.geocode(longStr)).rejects.toThrowError('Security Error: Address exceeds maximum length limit.');
  });

  it('rejects strings containing path traversal or directory separators', async () => {
    await expect(plugin.geocode('to/kyo')).rejects.toThrowError('Security Error: Invalid address format.');
    await expect(plugin.geocode('..')).rejects.toThrowError('Security Error: Invalid address format.');
    await expect(plugin.geocode('london\\suburb')).rejects.toThrowError('Security Error: Invalid address format.');
    await expect(plugin.geocode('../../etc/passwd')).rejects.toThrowError('Security Error: Invalid address format.');
  });
});
