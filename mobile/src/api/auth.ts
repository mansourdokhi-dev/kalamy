import { apiRequest, ApiError } from './client';

export type OtpFailureReason = 'NOT_FOUND' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INCORRECT_CODE';

const OTP_FAILURE_REASONS: OtpFailureReason[] = ['NOT_FOUND', 'EXPIRED', 'TOO_MANY_ATTEMPTS', 'INCORRECT_CODE'];

export function parseOtpFailureReason(error: unknown): OtpFailureReason | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  const found = OTP_FAILURE_REASONS.find((reason) => error.message.includes(reason));
  return found ?? null;
}

export interface RegisterPatientInput {
  fullName: string;
  mobile: string;
  email?: string;
  password: string;
  acceptedTerms?: boolean;
}

export interface RegisterResponse {
  userId: string;
  devOtpCode?: string;
}

export function registerPatient(input: RegisterPatientInput): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: { ...input, role: 'PATIENT' },
  });
}

export interface RegisterCaregiverInput extends RegisterPatientInput {}

export function registerCaregiver(input: RegisterCaregiverInput): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: { ...input, role: 'CAREGIVER' },
  });
}

export function verifyOtp(input: { mobile: string; code: string }): Promise<{ verified: true }> {
  return apiRequest('/api/v1/auth/verify', { method: 'POST', body: input });
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  mustChangePassword: boolean;
}

export function login(input: { mobile: string; password: string }): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/api/v1/auth/login', { method: 'POST', body: input });
}

export interface ForgotPasswordResponse {
  devOtpCode?: string;
}

export function forgotPassword(input: { mobile: string }): Promise<ForgotPasswordResponse> {
  return apiRequest('/api/v1/auth/forgot-password', { method: 'POST', body: input });
}

export function resetPassword(input: { mobile: string; code: string; newPassword: string }): Promise<{ reset: true }> {
  return apiRequest('/api/v1/auth/reset-password', { method: 'POST', body: input });
}
