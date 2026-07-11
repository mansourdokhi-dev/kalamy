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

export interface ClinicalInfo {
  referralReason?: string;
  initialDiagnosis?: string;
  medicalHistory?: string;
  medications?: string;
  allergies?: string;
  familyHistory?: string;
}

export interface PatientProfile {
  id: string;
  userId: string;
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  nationalId: string;
  address?: string;
  referralSource?: string;
  status: PatientProfileStatus;
  clinicalInfo: ClinicalInfo | null;
}

export function getPatient(id: string): Promise<PatientProfile> {
  return apiRequest(`/api/v1/patients/${id}`, { auth: true });
}

export interface UpdatePatientInput {
  fullName?: string;
  address?: string;
  referralSource?: string;
  clinicalInfo?: ClinicalInfo;
}

export function updatePatient(id: string, input: UpdatePatientInput): Promise<PatientProfile> {
  return apiRequest(`/api/v1/patients/${id}`, { method: 'PUT', body: input, auth: true });
}

export function updatePatientStatus(id: string, status: PatientProfileStatus): Promise<PatientProfile> {
  return apiRequest(`/api/v1/patients/${id}/status`, { method: 'PATCH', body: { status }, auth: true });
}

export interface CaregiverLookupResult {
  userId: string;
  fullName: string;
}

export function lookupCaregiver(mobile: string): Promise<CaregiverLookupResult> {
  return apiRequest(`/api/v1/patients/lookup-caregiver?mobile=${encodeURIComponent(mobile)}`, { auth: true });
}

export function linkGuardian(patientId: string, input: { guardianUserId: string; relationship: string }): Promise<void> {
  return apiRequest(`/api/v1/patients/${patientId}/guardian`, { method: 'POST', body: input, auth: true });
}
