import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getMyPatientProfile } from '../api/patients';
import { ApiError } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import { AgeGroup } from '../theme/tokens';

interface PatientProfileContextValue {
  patientProfileId: string | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

const PatientProfileContext = createContext<PatientProfileContextValue | undefined>(undefined);

export function computeAgeGroup(dateOfBirth: string, now: Date = new Date()): AgeGroup {
  const birth = new Date(dateOfBirth);
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
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

  useEffect(() => {
    let cancelled = false;
    getMyPatientProfile()
      .then((profile) => {
        if (cancelled) return;
        setPatientProfileId(profile.id);
        setAgeGroup(computeAgeGroup(profile.dateOfBirth));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PatientProfileContext.Provider value={{ patientProfileId, loading, notFound, error }}>
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
