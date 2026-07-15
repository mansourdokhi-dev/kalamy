import type { StaffRole } from '../api/auth';

export function canEditClinicalData(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'ADMIN';
}

export function canReviewSample(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'ADMIN';
}
