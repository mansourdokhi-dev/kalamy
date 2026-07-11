import { apiRequest } from './client';

export type AssessmentType = 'INITIAL' | 'PERIODIC' | 'FINAL';
export type AssessmentStatus = 'DRAFT' | 'APPROVED';
export type SeverityCategory = 'MILD' | 'MODERATE' | 'SEVERE' | 'VERY_SEVERE';

export interface Assessment {
  id: string;
  patientProfileId: string;
  clinicianUserId: string;
  type: AssessmentType;
  status: AssessmentStatus;
  medicalHistory?: string;
  difficultSituations?: string;
  anxietyLevel?: string;
  initialGoals?: string;
  clinicianNotes?: string;
  ssi4Frequency?: number;
  ssi4Duration?: number;
  ssi4PhysicalConcomitants?: number;
  ssi4Total?: number;
  severityCategory?: SeverityCategory;
  approvedAt?: string;
  createdAt: string;
}

export interface BaselineComparison {
  current: Assessment;
  baseline: Assessment | null;
  delta: {
    ssi4FrequencyDelta: number;
    ssi4DurationDelta: number;
    ssi4PhysicalConcomitantsDelta: number;
    ssi4TotalDelta: number;
  } | null;
}

export function createAssessment(patientId: string, type: AssessmentType): Promise<Assessment> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments`, { method: 'POST', body: { type }, auth: true });
}

export function listAssessments(patientId: string): Promise<Assessment[]> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments`, { auth: true });
}

export function getAssessment(patientId: string, id: string): Promise<Assessment> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments/${id}`, { auth: true });
}

export interface UpdateAssessmentInput {
  medicalHistory?: string;
  difficultSituations?: string;
  anxietyLevel?: string;
  initialGoals?: string;
  clinicianNotes?: string;
  ssi4Frequency?: number;
  ssi4Duration?: number;
  ssi4PhysicalConcomitants?: number;
  ssi4Total?: number;
}

export function updateAssessment(patientId: string, id: string, input: UpdateAssessmentInput): Promise<Assessment> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments/${id}`, { method: 'PUT', body: input, auth: true });
}

export function approveAssessment(patientId: string, id: string, severityCategory: SeverityCategory): Promise<Assessment> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments/${id}/approve`, {
    method: 'POST',
    body: { severityCategory },
    auth: true,
  });
}

export function getBaselineComparison(patientId: string, id: string): Promise<BaselineComparison> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments/${id}/baseline-comparison`, { auth: true });
}
