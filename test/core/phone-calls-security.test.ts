import { describe, it, expect } from 'vitest';
import { PhoneCallsPlugin } from '../../plugins/phone-calls';
import { CallHistoryPlugin } from '../../plugins/call-history';

describe('PhoneCallsPlugin Security Validation', () => {
  const phonePlugin = new PhoneCallsPlugin({
    id: 'phone-calls',
    name: 'Phone Calls',
    type: 'api-connection',
    capabilities: [],
  } as any);

  const historyPlugin = new CallHistoryPlugin({
    id: 'call-history',
    name: 'Call History',
    type: 'api-connection',
    capabilities: [],
  } as any);
  historyPlugin.setSource(phonePlugin);

  describe('log method', () => {
    it('allows safe, valid phone call logging', async () => {
      const call = await phonePlugin.log('+1 (555) 019-2834', 'incoming', 120, 'John Doe');
      expect(call.number).toBe('+1 (555) 019-2834');
      expect(call.direction).toBe('incoming');
      expect(call.duration).toBe(120);
      expect(call.contactName).toBe('John Doe');
    });

    it('rejects non-string numbers with a Security Error', async () => {
      await expect(phonePlugin.log(12345 as any, 'incoming')).rejects.toThrowError('Security Error: Phone number must be a string.');
      await expect(phonePlugin.log({} as any, 'incoming')).rejects.toThrowError('Security Error: Phone number must be a string.');
    });

    it('rejects empty numbers with a Security Error', async () => {
      await expect(phonePlugin.log('', 'incoming')).rejects.toThrowError('Security Error: Phone number cannot be empty.');
      await expect(phonePlugin.log('   ', 'incoming')).rejects.toThrowError('Security Error: Phone number cannot be empty.');
    });

    it('rejects overly long numbers with a Security Error', async () => {
      await expect(phonePlugin.log('1'.repeat(31), 'incoming')).rejects.toThrowError('Security Error: Phone number exceeds maximum length limit of 30 characters.');
    });

    it('rejects numbers containing invalid/unsafe characters with a Security Error', async () => {
      await expect(phonePlugin.log('123; rm -rf /', 'incoming')).rejects.toThrowError('Security Error: Phone number contains invalid characters.');
      await expect(phonePlugin.log('123&whoami', 'incoming')).rejects.toThrowError('Security Error: Phone number contains invalid characters.');
      await expect(phonePlugin.log('123$foo', 'incoming')).rejects.toThrowError('Security Error: Phone number contains invalid characters.');
      await expect(phonePlugin.log('123<bar', 'incoming')).rejects.toThrowError('Security Error: Phone number contains invalid characters.');
    });

    it('rejects invalid/malformed call directions with a Security Error', async () => {
      await expect(phonePlugin.log('123', 'incoming-internal' as any)).rejects.toThrowError('Security Error: Invalid call direction.');
      await expect(phonePlugin.log('123', null as any)).rejects.toThrowError('Security Error: Invalid call direction.');
      await expect(phonePlugin.log('123', {} as any)).rejects.toThrowError('Security Error: Invalid call direction.');
    });

    it('rejects invalid/malformed durations with a Security Error', async () => {
      await expect(phonePlugin.log('123', 'incoming', -5)).rejects.toThrowError('Security Error: Duration must be a non-negative finite number.');
      await expect(phonePlugin.log('123', 'incoming', NaN)).rejects.toThrowError('Security Error: Duration must be a non-negative finite number.');
      await expect(phonePlugin.log('123', 'incoming', Infinity)).rejects.toThrowError('Security Error: Duration must be a non-negative finite number.');
      await expect(phonePlugin.log('123', 'incoming', '120' as any)).rejects.toThrowError('Security Error: Duration must be a non-negative finite number.');
    });

    it('rejects invalid/malformed contact names with a Security Error', async () => {
      await expect(phonePlugin.log('123', 'incoming', 0, 123 as any)).rejects.toThrowError('Security Error: Contact name must be a string.');
      await expect(phonePlugin.log('123', 'incoming', 0, 'a'.repeat(101))).rejects.toThrowError('Security Error: Contact name exceeds maximum length limit of 100 characters.');
    });
  });

  describe('getHistory and getCallHistory limit validation', () => {
    it('allows valid limits', async () => {
      const history = await phonePlugin.getHistory(10);
      expect(Array.isArray(history)).toBe(true);

      const callHistory = await historyPlugin.getCallHistory(10);
      expect(Array.isArray(callHistory)).toBe(true);
    });

    it('rejects invalid limits in PhoneCallsPlugin.getHistory', async () => {
      await expect(phonePlugin.getHistory(-1)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
      await expect(phonePlugin.getHistory(0)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
      await expect(phonePlugin.getHistory(5.5)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
      await expect(phonePlugin.getHistory(NaN)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
      await expect(phonePlugin.getHistory('10' as any)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
    });

    it('rejects invalid limits in CallHistoryPlugin.getCallHistory', async () => {
      await expect(historyPlugin.getCallHistory(-1)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
      await expect(historyPlugin.getCallHistory(0)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
      await expect(historyPlugin.getCallHistory(5.5)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
      await expect(historyPlugin.getCallHistory(NaN)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
      await expect(historyPlugin.getCallHistory('10' as any)).rejects.toThrowError('Security Error: Limit must be a positive integer.');
    });
  });
});
