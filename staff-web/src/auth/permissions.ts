import type { StaffRole } from '../api/auth';

export function canEditClinicalData(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'ADMIN';
}

export function canReviewSample(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'ADMIN';
}

export function canManageComplaints(role: StaffRole): boolean {
  return role === 'SUPERVISOR' || role === 'ADMIN';
}

export function canViewAdminReports(role: StaffRole): boolean {
  return role === 'SUPERVISOR' || role === 'ADMIN';
}
