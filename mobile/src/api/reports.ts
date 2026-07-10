import { apiRequest } from './client';

export interface AssessmentResult {
  id: string;
  type: 'INITIAL' | 'PERIODIC' | 'FINAL';
  status: 'DRAFT' | 'APPROVED';
  ssi4Frequency: number | null;
  ssi4Duration: number | null;
  ssi4PhysicalConcomitants: number | null;
  ssi4Total: number | null;
  severityCategory: 'MILD' | 'MODERATE' | 'SEVERE' | 'VERY_SEVERE' | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface AssessmentResultsReport {
  patientProfileId: string;
  assessments: AssessmentResult[];
}

export interface MedicalReportClinicalInfo {
  referralReason: string | null;
  initialDiagnosis: string | null;
  medicalHistory: string | null;
  medications: string | null;
  allergies: string | null;
  familyHistory: string | null;
}

export interface MedicalReportLatestAssessment {
  id: string;
  type: 'INITIAL' | 'PERIODIC' | 'FINAL';
  severityCategory: 'MILD' | 'MODERATE' | 'SEVERE' | 'VERY_SEVERE' | null;
  ssi4Total: number | null;
  approvedAt: string | null;
}

export interface MedicalReportActivePlan {
  id: string;
  phase: string;
  goals: string;
  reviewDate: string;
}

export interface MedicalReport {
  patientProfileId: string;
  patientFullName: string;
  clinicalInfo: MedicalReportClinicalInfo | null;
  latestApprovedAssessment: MedicalReportLatestAssessment | null;
  activeTreatmentPlan: MedicalReportActivePlan | null;
}

export function getAssessmentResultsReport(patientProfileId: string): Promise<AssessmentResultsReport> {
  return apiRequest<AssessmentResultsReport>(`/api/v1/reports/patients/${patientProfileId}/assessment-results`, {
    auth: true,
  });
}

export function getMedicalReport(patientProfileId: string): Promise<MedicalReport> {
  return apiRequest<MedicalReport>(`/api/v1/reports/patients/${patientProfileId}/medical`, { auth: true });
}
