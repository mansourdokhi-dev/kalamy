import { apiRequest } from './client';

export type Gender = 'MALE' | 'FEMALE';
export type PatientProfileStatus = 'ACTIVE' | 'DISABLED';

export interface PatientSearchResult {
  id: string;
  fullName: string;
  nationalId: string;
  gender: Gender;
  dateOfBirth: string;
  status: PatientProfileStatus;
}

export function searchPatients(query: string): Promise<PatientSearchResult[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  return apiRequest(`/api/v1/patients${params}`, { auth: true });
}
