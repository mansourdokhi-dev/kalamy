import { apiRequest, ApiError } from '../client';
import { registerPatient, verifyOtp, login, parseOtpFailureReason } from '../auth';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('auth API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registerPatient posts to /api/v1/auth/register with role PATIENT', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ userId: 'u1', devOtpCode: '123456' });

    const result = await registerPatient({
      fullName: 'Test User',
      mobile: '+966500000001',
      password: 'password123',
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/register', {
      method: 'POST',
      body: { fullName: 'Test User', mobile: '+966500000001', password: 'password123', role: 'PATIENT' },
    });
    expect(result).toEqual({ userId: 'u1', devOtpCode: '123456' });
  });

  it('verifyOtp posts mobile and code', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ verified: true });
    const result = await verifyOtp({ mobile: '+966500000001', code: '123456' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/verify', {
      method: 'POST',
      body: { mobile: '+966500000001', code: '123456' },
    });
    expect(result).toEqual({ verified: true });
  });

  it('login posts mobile and password', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ token: 't', expiresAt: '2026-01-01', mustChangePassword: false });
    const result = await login({ mobile: '+966500000001', password: 'password123' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/login', {
      method: 'POST',
      body: { mobile: '+966500000001', password: 'password123' },
    });
    expect(result.mustChangePassword).toBe(false);
  });

  it('parseOtpFailureReason extracts the reason from an ApiError message', () => {
    const err = new ApiError(401, 'UNAUTHORIZED', 'OTP verification failed: TOO_MANY_ATTEMPTS');
    expect(parseOtpFailureReason(err)).toBe('TOO_MANY_ATTEMPTS');
  });

  it('parseOtpFailureReason returns null for unrelated errors', () => {
    const err = new ApiError(500, 'INTERNAL_ERROR', 'Unexpected error');
    expect(parseOtpFailureReason(err)).toBeNull();
  });

  it('parseOtpFailureReason returns null for non-ApiError values', () => {
    expect(parseOtpFailureReason(new Error('boom'))).toBeNull();
  });
});
