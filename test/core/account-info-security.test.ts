import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AccountInfoPlugin } from '../../plugins/account-info';

describe('AccountInfoPlugin security restrictions', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Inject test environment variables
    process.env.SAFE_VAR = 'safe_value_here';
    process.env.MY_SECRET_KEY = 'super_secret_api_key_123';
    process.env.DB_PASSWORD = 'my_secure_db_password_abc';
    process.env.USER_TOKEN = 'some_jwt_auth_token_xyz';
  });

  afterEach(() => {
    // Restore original process.env
    process.env = { ...originalEnv };
  });

  it('allows access to safe environment variables', async () => {
    const plugin = new AccountInfoPlugin({
      id: 'account-info',
      name: 'Account Info',
      type: 'api-connection',
      capabilities: [],
    } as any);

    const result = await plugin.getEnv('SAFE_VAR');
    expect(result).toEqual({ SAFE_VAR: 'safe_value_here' });
  });

  it('blocks individual access to sensitive keys with a Security Error', async () => {
    const plugin = new AccountInfoPlugin({
      id: 'account-info',
      name: 'Account Info',
      type: 'api-connection',
      capabilities: [],
    } as any);

    // Try accessing various sensitive keys
    await expect(plugin.getEnv('MY_SECRET_KEY')).rejects.toThrow(/Security Error: Access to sensitive environment variable is blocked/);
    await expect(plugin.getEnv('DB_PASSWORD')).rejects.toThrow(/Security Error: Access to sensitive environment variable is blocked/);
    await expect(plugin.getEnv('USER_TOKEN')).rejects.toThrow(/Security Error: Access to sensitive environment variable is blocked/);
  });

  it('filters/omits sensitive keys when listing all environment variables', async () => {
    const plugin = new AccountInfoPlugin({
      id: 'account-info',
      name: 'Account Info',
      type: 'api-connection',
      capabilities: [],
    } as any);

    const allEnv = await plugin.getEnv();

    // Safe variables should be included
    expect(allEnv.SAFE_VAR).toBe('safe_value_here');

    // Sensitive variables must be completely filtered out
    expect(allEnv.MY_SECRET_KEY).toBeUndefined();
    expect(allEnv.DB_PASSWORD).toBeUndefined();
    expect(allEnv.USER_TOKEN).toBeUndefined();

    // Verify there are no sensitive keys present at all in the output keys
    const keys = Object.keys(allEnv);
    const SENSITIVE_PATTERN = /key|secret|password|token|auth|pass|credential|cert|cookie|jwt|hash|salt|ssh|database|db_|session|bearer|sig|private/i;
    for (const key of keys) {
      expect(SENSITIVE_PATTERN.test(key)).toBe(false);
    }
  });

  it('executes whoami safely and returns current username', async () => {
    const plugin = new AccountInfoPlugin({
      id: 'account-info',
      name: 'Account Info',
      type: 'api-connection',
      capabilities: [],
    } as any);

    const username = await plugin.whoami();
    expect(typeof username).toBe('string');
    expect(username.length).toBeGreaterThan(0);
  });
});
