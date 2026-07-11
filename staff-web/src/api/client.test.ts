/// <reference types="vitest/globals" />
import { apiRequest, ApiError } from './client';
import { saveToken, clearToken } from '../storage/session';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearToken();
});

describe('apiRequest', () => {
  it('sends a GET with no auth header when auth is not requested', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: 'world' }),
    }) as unknown as typeof fetch;

    const result = await apiRequest<{ hello: string }>('/api/v1/ping');

    expect(result).toEqual({ hello: 'world' });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('attaches a bearer token when auth is requested and a token exists', async () => {
    saveToken('token-xyz');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await apiRequest('/api/v1/protected', { auth: true });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer token-xyz');
  });

  it('sends a POST with a JSON body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: true }),
    }) as unknown as typeof fetch;

    await apiRequest('/api/v1/things', { method: 'POST', body: { name: 'a thing' } });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'a thing' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws a typed ApiError on a non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'UNAUTHORIZED', message: 'Invalid credentials' }),
    }) as unknown as typeof fetch;

    await expect(apiRequest('/api/v1/login')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid credentials',
    });
    await expect(apiRequest('/api/v1/login')).rejects.toBeInstanceOf(ApiError);
  });
});
