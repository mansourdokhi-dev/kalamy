import { getToken, saveToken, clearToken } from './session';

beforeEach(() => {
  localStorage.clear();
});

describe('session storage', () => {
  it('returns null when no token has been saved', () => {
    expect(getToken()).toBeNull();
  });

  it('saves and retrieves a token', () => {
    saveToken('abc123');
    expect(getToken()).toBe('abc123');
  });

  it('clears a saved token', () => {
    saveToken('abc123');
    clearToken();
    expect(getToken()).toBeNull();
  });
});
