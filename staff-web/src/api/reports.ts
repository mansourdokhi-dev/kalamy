import { apiRequest } from './client';
import type { Complaint, ComplaintStatus } from './complaints';

export interface AssessmentResultsReportRow {
  id: string;
  type: string;
  status: string;
  ssi4Frequency: number | null;
  ssi4Duration: number | null;
  ssi4PhysicalConcomitants: number | null;
  ssi4Total: number | null;
  severityCategory: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export function getAssessmentResultsReport(patientId: string): Promise<AssessmentResultsReportRow[]> {
  return apiRequest<AssessmentResultsReportRow[]>(`/api/v1/reports/patients/${patientId}/assessment-results`, { auth: true });
}

export interface MedicalReport {
  patientProfileId: string;
  patientFullName: string;
  clinicalInfo: {
    referralReason: string | null;
    initialDiagnosis: string | null;
    medicalHistory: string | null;
    medications: string | null;
    allergies: string | null;
    familyHistory: string | null;
  } | null;
  latestApprovedAssessment: {
    id: string;
    type: string;
    severityCategory: string | null;
    ssi4Total: number | null;
    approvedAt: string;
  } | null;
  activeTreatmentPlan: {
    id: string;
    phase: string;
    goals: string;
    reviewDate: string | null;
  } | null;
}

export function getMedicalReport(patientId: string): Promise<MedicalReport> {
  return apiRequest<MedicalReport>(`/api/v1/reports/patients/${patientId}/medical`, { auth: true });
}

export interface OperationalStatusReport {
  usersByRole: Record<string, number>;
  patientProfilesByStatus: Record<string, number>;
  treatmentPlansByStatus: Record<string, number>;
  trainingCyclesByStatus: Record<string, number>;
}

export function getOperationalStatusReport(): Promise<OperationalStatusReport> {
  return apiRequest<OperationalStatusReport>('/api/v1/reports/operational-status', { auth: true });
}

export interface RegisteredUserSummary {
  id: string;
  fullName: string;
  mobile: string;
  role: string;
  status: string;
  createdAt: string;
  caseProgressSummary: string;
}

export function getRegisteredUsersReport(): Promise<RegisteredUserSummary[]> {
  return apiRequest<RegisteredUserSummary[]>('/api/v1/reports/registered-users', { auth: true });
}

export interface ServiceModificationLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  actorFullName: string;
  actorRole: string;
  createdAt: string;
}

export function getServiceModificationsReport(filter: { from?: string; to?: string } = {}): Promise<ServiceModificationLogEntry[]> {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  const query = params.toString();
  return apiRequest<ServiceModificationLogEntry[]>(`/api/v1/reports/service-modifications${query ? `?${query}` : ''}`, { auth: true });
}

export interface StaffPerformanceSummary {
  clinicianUserId: string;
  fullName: string;
  role: string;
  patientsHandled: number;
  reviewsApproved: number;
  reviewsRepeatRequired: number;
  complaintsAgainst: number;
}

export function getStaffPerformanceReport(): Promise<StaffPerformanceSummary[]> {
  return apiRequest<StaffPerformanceSummary[]>('/api/v1/reports/staff-performance', { auth: true });
}

export function getComplaintsReport(filter: { status?: ComplaintStatus; relatedClinicianUserId?: string } = {}): Promise<Complaint[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.relatedClinicianUserId) params.set('relatedClinicianUserId', filter.relatedClinicianUserId);
  const query = params.toString();
  return apiRequest<Complaint[]>(`/api/v1/reports/complaints${query ? `?${query}` : ''}`, { auth: true });
}
