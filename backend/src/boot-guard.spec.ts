import { assertSafeBootConfig } from './boot-guard';

describe('assertSafeBootConfig', () => {
  it('throws when DEV_MODE=true and NODE_ENV=production', () => {
    expect(() => assertSafeBootConfig({ DEV_MODE: 'true', NODE_ENV: 'production' })).toThrow(
      'Refusing to start: DEV_MODE=true is not allowed when NODE_ENV=production',
    );
  });

  it('does not throw when DEV_MODE=true and NODE_ENV is unset (local dev)', () => {
    expect(() => assertSafeBootConfig({ DEV_MODE: 'true' })).not.toThrow();
  });

  it('does not throw when DEV_MODE=false, regardless of NODE_ENV', () => {
    expect(() => assertSafeBootConfig({ DEV_MODE: 'false', NODE_ENV: 'production' })).not.toThrow();
  });

  it('does not throw when DEV_MODE is unset in production', () => {
    expect(() => assertSafeBootConfig({ NODE_ENV: 'production' })).not.toThrow();
  });
});
