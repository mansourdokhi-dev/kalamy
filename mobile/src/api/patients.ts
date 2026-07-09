import { apiRequest } from './client';

export interface PatientProfile {
  id: string;
  userId: string;
  fullName: string;
  gender: 'MALE' | 'FEMALE';
  dateOfBirth: string;
  nationalId: string;
  address?: string | null;
  referralSource?: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

export function getMyPatientProfile(): Promise<PatientProfile> {
  return apiRequest<PatientProfile>('/api/v1/patients/me', { auth: true });
}
