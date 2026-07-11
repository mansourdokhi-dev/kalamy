import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getPatient } from '../api/patients';
import type { PatientProfile } from '../api/patients';
import { ar } from '../copy/ar';

interface PatientDetailContextValue {
  patient: PatientProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PatientDetailContext = createContext<PatientDetailContextValue | undefined>(undefined);

export function PatientDetailProvider({ patientId, children }: { patientId: string; children: ReactNode }) {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const found = await getPatient(patientId);
      setPatient(found);
    } catch {
      setError(ar.patientDetail.loadError);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <PatientDetailContext.Provider value={{ patient, loading, error, refresh }}>
      {children}
    </PatientDetailContext.Provider>
  );
}

export function usePatientDetail(): PatientDetailContextValue {
  const ctx = useContext(PatientDetailContext);
  if (!ctx) {
    throw new Error('usePatientDetail must be used within a PatientDetailProvider');
  }
  return ctx;
}
