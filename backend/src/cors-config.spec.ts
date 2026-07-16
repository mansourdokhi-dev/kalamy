import { resolveAllowedOrigins } from './cors-config';

describe('resolveAllowedOrigins', () => {
  it('returns the local dev defaults when CORS_ALLOWED_ORIGINS is unset', () => {
    expect(resolveAllowedOrigins({})).toEqual(['http://localhost:5173', 'http://localhost:8081']);
  });

  it('parses a comma-separated CORS_ALLOWED_ORIGINS into an array', () => {
    expect(resolveAllowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://staff.kalamy.app,https://app.kalamy.app' })).toEqual([
      'https://staff.kalamy.app',
      'https://app.kalamy.app',
    ]);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(resolveAllowedOrigins({ CORS_ALLOWED_ORIGINS: ' https://staff.kalamy.app , , https://app.kalamy.app ' })).toEqual([
      'https://staff.kalamy.app',
      'https://app.kalamy.app',
    ]);
  });

  it('does not fall back to defaults when explicitly set to a single origin', () => {
    expect(resolveAllowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://staff.kalamy.app' })).toEqual(['https://staff.kalamy.app']);
  });
});
