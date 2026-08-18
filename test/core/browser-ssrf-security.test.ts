import { describe, it, expect } from 'vitest';
import { BrowserPlugin } from '../../plugins/browser';

describe('BrowserPlugin SSRF Security Validation', () => {
  const browser = new BrowserPlugin({
    id: 'browser',
    name: 'Browser',
    type: 'api-connection',
    capabilities: ['browser'],
  } as any);

  it('rejects standard private and loopback IPv4/IPv6 addresses', async () => {
    await expect(browser.fetchUrl('http://127.0.0.1')).rejects.toThrow(/Security Error: Access to private\/local host/);
    await expect(browser.fetchUrl('http://localhost')).rejects.toThrow(/Security Error: Access to private\/local host/);
    await expect(browser.fetchUrl('http://[::1]')).rejects.toThrow(/Security Error: Access to private\/local host/);
    await expect(browser.fetchUrl('http://10.0.0.1')).rejects.toThrow(/Security Error: Access to private\/local host/);
    await expect(browser.fetchUrl('http://192.168.1.1')).rejects.toThrow(/Security Error: Access to private\/local host/);
  });

  it('rejects IPv4-mapped IPv6 dotted-decimal addresses', async () => {
    await expect(browser.fetchUrl('http://[::ffff:127.0.0.1]')).rejects.toThrow(/Security Error: Access to private\/local host/);
    await expect(browser.fetchUrl('http://[::ffff:10.0.0.1]')).rejects.toThrow(/Security Error: Access to private\/local host/);
    await expect(browser.fetchUrl('http://[::ffff:192.168.0.1]')).rejects.toThrow(/Security Error: Access to private\/local host/);
  });

  it('rejects IPv4-mapped IPv6 hexadecimal addresses', async () => {
    // 7f00:1 is 127.0.0.1
    await expect(browser.fetchUrl('http://[::ffff:7f00:1]')).rejects.toThrow(/Security Error: Access to private\/local host/);
    // 0a00:0001 is 10.0.0.1
    await expect(browser.fetchUrl('http://[::ffff:0a00:1]')).rejects.toThrow(/Security Error: Access to private\/local host/);
    // c0a8:0101 is 192.168.1.1
    await expect(browser.fetchUrl('http://[::ffff:c0a8:101]')).rejects.toThrow(/Security Error: Access to private\/local host/);
  });
});
