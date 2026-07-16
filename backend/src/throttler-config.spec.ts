import { shouldSkipThrottling, buildThrottlerOptions } from './throttler-config';

describe('shouldSkipThrottling', () => {
  it('returns true when NODE_ENV=test', () => {
    expect(shouldSkipThrottling({ NODE_ENV: 'test' })).toBe(true);
  });

  it('returns false when NODE_ENV=production', () => {
    expect(shouldSkipThrottling({ NODE_ENV: 'production' })).toBe(false);
  });

  it('returns false when NODE_ENV is unset (local dev)', () => {
    expect(shouldSkipThrottling({})).toBe(false);
  });
});

describe('buildThrottlerOptions', () => {
  it('configures a 60 requests/minute global default', () => {
    const options = buildThrottlerOptions({});
    expect(options).toMatchObject({ throttlers: [{ limit: 60, ttl: 60_000 }] });
  });

  it("wires skipIf to shouldSkipThrottling's result for the given env", () => {
    const testOptions = buildThrottlerOptions({ NODE_ENV: 'test' });
    expect(testOptions.skipIf?.(null as never)).toBe(true);

    const prodOptions = buildThrottlerOptions({ NODE_ENV: 'production' });
    expect(prodOptions.skipIf?.(null as never)).toBe(false);
  });
});
