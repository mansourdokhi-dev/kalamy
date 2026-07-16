import { apiRequest } from './client';

export type StaffRoleValue = 'PATIENT' | 'CAREGIVER' | 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN';
export type AccountStatusValue = 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
export type StaffCreatableRole = 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'DISABLED';

export interface StaffAccountSummary {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  role: StaffRoleValue;
  status: AccountStatusValue;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface CreateStaffAccountInput {
  fullName: string;
  mobile: string;
  email?: string;
  password: string;
  role: StaffCreatableRole;
}

export function createStaffAccount(input: CreateStaffAccountInput): Promise<StaffAccountSummary> {
  return apiRequest<StaffAccountSummary>('/api/v1/admin/staff', { method: 'POST', body: input, auth: true });
}

export function listStaffAccounts(filter: { role?: string; status?: string } = {}): Promise<StaffAccountSummary[]> {
  const params = new URLSearchParams();
  if (filter.role) params.set('role', filter.role);
  if (filter.status) params.set('status', filter.status);
  const query = params.toString();
  return apiRequest<StaffAccountSummary[]>(`/api/v1/admin/users${query ? `?${query}` : ''}`, { auth: true });
}

export function updateAccountStatus(id: string, status: AccountStatus): Promise<StaffAccountSummary> {
  return apiRequest<StaffAccountSummary>(`/api/v1/admin/users/${id}/status`, { method: 'PATCH', body: { status }, auth: true });
}
