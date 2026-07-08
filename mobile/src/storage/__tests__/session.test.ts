import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { saveToken, getToken, clearToken } from '../session';

jest.mock('expo-secure-store');

describe('session storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('on native (ios/android)', () => {
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

  describe('on web', () => {
    let store: Record<string, string>;

    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      store = {};
      global.localStorage = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      } as unknown as Storage;
    });

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    });

    it('saves the token to localStorage, not SecureStore', async () => {
      await saveToken('abc123');
      expect(store['kalamy.session.token']).toBe('abc123');
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });

    it('reads the token back from localStorage', async () => {
      store['kalamy.session.token'] = 'abc123';
      const result = await getToken();
      expect(result).toBe('abc123');
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    });

    it('returns null when no token is stored', async () => {
      const result = await getToken();
      expect(result).toBeNull();
    });

    it('clears the token from localStorage', async () => {
      store['kalamy.session.token'] = 'abc123';
      await clearToken();
      expect(store['kalamy.session.token']).toBeUndefined();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    });
  });
});
