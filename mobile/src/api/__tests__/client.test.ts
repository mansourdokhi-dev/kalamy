import { apiRequest, ApiError } from '../client';
import * as session from '../../storage/session';

jest.mock('../../storage/session');

const originalFetch = global.fetch;

describe('apiRequest', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns parsed JSON on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    }) as unknown as typeof fetch;

    const result = await apiRequest<{ hello: string }>('/health');
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws ApiError with parsed code/message on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'CONFLICT', message: 'Mobile number already registered' }),
    }) as unknown as typeof fetch;

    await expect(apiRequest('/api/v1/auth/register', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Mobile number already registered',
    });
  });

  it('attaches the Authorization header when auth is true and a token exists', async () => {
    (session.getToken as jest.Mock).mockResolvedValue('my-token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await apiRequest('/api/v1/auth/sessions', { auth: true });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/sessions'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
      }),
    );
  });
});
