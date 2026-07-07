import * as SecureStore from 'expo-secure-store';
import { saveToken, getToken, clearToken } from '../session';

jest.mock('expo-secure-store');

describe('session storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves the token under a fixed key', async () => {
    await saveToken('abc123');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('kalamy.session.token', 'abc123');
  });

  it('reads the token back', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('abc123');
    const result = await getToken();
    expect(result).toBe('abc123');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('kalamy.session.token');
  });

  it('returns null when no token is stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    const result = await getToken();
    expect(result).toBeNull();
  });

  it('clears the token', async () => {
    await clearToken();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('kalamy.session.token');
  });
});
