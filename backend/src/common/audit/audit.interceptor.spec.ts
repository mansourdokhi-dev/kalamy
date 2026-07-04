import { redactSensitiveFields } from './audit.interceptor';

describe('redactSensitiveFields', () => {
  it('redacts a plaintext password and leaves other fields untouched', () => {
    const input = {
      password: 'secret123',
      fullName: 'Ahmed Ali',
      mobile: '+966500000000',
    };

    const result = redactSensitiveFields(input);

    expect(result.password).toBe('[REDACTED]');
    expect(result.fullName).toBe('Ahmed Ali');
    expect(result.mobile).toBe('+966500000000');
  });

  it('redacts newPassword, passwordHash, token, code, and devOtpCode', () => {
    const input = {
      newPassword: 'newSecret',
      passwordHash: '$2b$10$hash',
      token: 'session-token-value',
      code: '123456',
      devOtpCode: '654321',
      expiresAt: '2026-07-04T00:00:00.000Z',
    };

    const result = redactSensitiveFields(input);

    expect(result.newPassword).toBe('[REDACTED]');
    expect(result.passwordHash).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.code).toBe('[REDACTED]');
    expect(result.devOtpCode).toBe('[REDACTED]');
    expect(result.expiresAt).toBe('2026-07-04T00:00:00.000Z');
  });

  it('returns primitives and nullish values unchanged', () => {
    expect(redactSensitiveFields(undefined)).toBeUndefined();
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields('plain-string')).toBe('plain-string');
  });

  it('does not mutate the original object', () => {
    const input = { password: 'secret123', fullName: 'Ahmed Ali' };

    const result = redactSensitiveFields(input);

    expect(input.password).toBe('secret123');
    expect(result).not.toBe(input);
  });
});
