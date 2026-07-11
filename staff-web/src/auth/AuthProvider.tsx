import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { login as loginRequest, getMe, type StaffUser } from '../api/auth';
import { getToken, saveToken, clearToken } from '../storage/session';

interface AuthContextValue {
  user: StaffUser | null;
  loading: boolean;
  login: (mobile: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const me = await getMe();
    setUser(me);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await getMe();
        if (!cancelled) {
          setUser(me);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(mobile: string, password: string) {
    const result = await loginRequest(mobile, password);
    saveToken(result.token);
    await refreshUser();
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
