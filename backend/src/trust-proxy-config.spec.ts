import { resolveTrustProxy } from './trust-proxy-config';

describe('resolveTrustProxy', () => {
  it('returns false when TRUST_PROXY is unset', () => {
    expect(resolveTrustProxy({})).toBe(false);
  });

  it('returns false for an empty or "false" value', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: 'false' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: 'FALSE' })).toBe(false);
  });

  it('returns a positive integer hop count as a number', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '1' })).toBe(1);
    expect(resolveTrustProxy({ TRUST_PROXY: '2' })).toBe(2);
  });

  it('passes an IP/CIDR string through verbatim', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '10.0.0.0/8' })).toBe('10.0.0.0/8');
  });

  it('throws for "true" because it enables X-Forwarded-For spoofing', () => {
    expect(() => resolveTrustProxy({ TRUST_PROXY: 'true' })).toThrow('not allowed');
  });
});
