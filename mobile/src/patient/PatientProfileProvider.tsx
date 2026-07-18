import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { getMyPatientProfile } from '../api/patients';
import { ApiError } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import { AgeGroup } from '../theme/tokens';

interface PatientProfileContextValue {
  patientProfileId: string | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PatientProfileContext = createContext<PatientProfileContextValue | undefined>(undefined);

export function computeAgeGroup(dateOfBirth: string, now: Date = new Date()): AgeGroup {
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  let age = now.getFullYear() - birthYear;
  const nowMonth = now.getMonth() + 1; // getMonth() is 0-indexed; birthMonth from the ISO string is 1-indexed
  const hasHadBirthdayThisYear = nowMonth > birthMonth || (nowMonth === birthMonth && now.getDate() >= birthDay);
  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }
  if (age < 13) return 'child';
  if (age < 18) return 'teen';
  return 'adult';
}

export function PatientProfileProvider({ children }: { children: ReactNode }) {
  const { setAgeGroup } = useTheme();
  const [patientProfileId, setPatientProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exposed so the login screen can force a re-fetch after saving the token —
  // this provider lives at the root layout and is mounted once (while logged
  // out), so without an explicit refresh its initial not-found/error state
  // would persist through the first login instead of loading the real profile.
  const refresh = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const profile = await getMyPatientProfile();
      setPatientProfileId(profile.id);
      setAgeGroup(computeAgeGroup(profile.dateOfBirth));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <PatientProfileContext.Provider value={{ patientProfileId, loading, notFound, error, refresh }}>
      {children}
    </PatientProfileContext.Provider>
  );
}

export function usePatientProfile(): PatientProfileContextValue {
  const ctx = useContext(PatientProfileContext);
  if (!ctx) {
    throw new Error('usePatientProfile must be used within a PatientProfileProvider');
  }
  return ctx;
}
