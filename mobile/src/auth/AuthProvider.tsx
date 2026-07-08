import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getToken, clearToken } from '../storage/session';

interface AuthContextValue {
  isLoggedIn: boolean;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getToken().then((token) => {
      if (!cancelled) {
        setIsLoggedIn(Boolean(token));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await clearToken();
    setIsLoggedIn(false);
  }

  return <AuthContext.Provider value={{ isLoggedIn, loading, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
