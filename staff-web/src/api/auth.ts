import { apiRequest } from './client';

export type StaffRole = 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN';

export interface StaffUser {
  id: string;
  fullName: string;
  mobile: string;
  role: StaffRole;
  mustChangePassword: boolean;
}

export function login(mobile: string, password: string): Promise<{ token: string; expiresAt: string; mustChangePassword: boolean }> {
  return apiRequest('/api/v1/auth/login', { method: 'POST', body: { mobile, password } });
}

export function forgotPassword(input: { mobile: string }): Promise<{ devOtpCode?: string }> {
  return apiRequest('/api/v1/auth/forgot-password', { method: 'POST', body: input });
}

export function resetPassword(input: { mobile: string; code: string; newPassword: string }): Promise<{ reset: true }> {
  return apiRequest('/api/v1/auth/reset-password', { method: 'POST', body: input });
}

export function changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ changed: true }> {
  return apiRequest('/api/v1/auth/change-password', { method: 'POST', body: input, auth: true });
}

export function getMe(): Promise<StaffUser> {
  return apiRequest('/api/v1/auth/me', { auth: true });
}
