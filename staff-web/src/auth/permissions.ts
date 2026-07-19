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

export function canManageStaffAccounts(role: StaffRole): boolean {
  return role === 'ADMIN';
}

export function canViewMyClinicians(role: StaffRole): boolean {
  return role === 'SUPERVISOR';
}

export function canTransferReview(role: StaffRole): boolean {
  return role === 'SUPERVISOR';
}

export function canManageConsultation(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'SUPERVISOR' || role === 'ADMIN';
}

// Messaging is the treating clinician's direct channel to the patient; the
// backend grants VIEW_MESSAGE/SEND_MESSAGE to CLINICIAN only among staff.
export function canMessagePatient(role: StaffRole): boolean {
  return role === 'CLINICIAN';
}
