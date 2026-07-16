import { shouldExposeSwaggerDocs } from './swagger-gate';

describe('shouldExposeSwaggerDocs', () => {
  it('returns false when NODE_ENV=production', () => {
    expect(shouldExposeSwaggerDocs({ NODE_ENV: 'production' })).toBe(false);
  });

  it('returns true when NODE_ENV is unset (local dev)', () => {
    expect(shouldExposeSwaggerDocs({})).toBe(true);
  });

  it('returns true when NODE_ENV=development', () => {
    expect(shouldExposeSwaggerDocs({ NODE_ENV: 'development' })).toBe(true);
  });

  it('returns true when NODE_ENV=test', () => {
    expect(shouldExposeSwaggerDocs({ NODE_ENV: 'test' })).toBe(true);
  });
});
