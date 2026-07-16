import { apiRequest } from './client';
import type { StaffAccountSummary } from './admin-users';

export interface ClinicianWithSupervisor extends StaffAccountSummary {
  supervisorUserId: string | null;
}

export function assignSupervisor(clinicianUserId: string, supervisorUserId: string | null): Promise<ClinicianWithSupervisor> {
  return apiRequest<ClinicianWithSupervisor>(`/api/v1/admin/supervision/${clinicianUserId}`, {
    method: 'PUT',
    body: { supervisorUserId },
    auth: true,
  });
}

export function listMyClinicians(supervisorUserId: string): Promise<ClinicianWithSupervisor[]> {
  return apiRequest<ClinicianWithSupervisor[]>(`/api/v1/admin/supervision/${supervisorUserId}/clinicians`, { auth: true });
}
