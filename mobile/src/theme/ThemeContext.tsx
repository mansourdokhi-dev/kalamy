import { createContext, useContext, useMemo, useState, ReactNode } from 'react';
import { AgeGroup, ThemeTokens, tokens } from './tokens';

interface ThemeContextValue {
  ageGroup: AgeGroup;
  tokens: ThemeTokens;
  setAgeGroup: (group: AgeGroup) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('adult');
  const value = useMemo(() => ({ ageGroup, tokens: tokens[ageGroup], setAgeGroup }), [ageGroup]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
