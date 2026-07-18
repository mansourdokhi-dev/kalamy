import { OtpPurpose, Role, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';

function makePrismaMock(overrides: Partial<Record<string, any>> = {}) {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  } as any;
}

function makeOtpServiceMock() {
  return { issue: jest.fn().mockResolvedValue('123456'), verify: jest.fn() } as any;
}

function makePasswordServiceMock() {
  return { hash: jest.fn().mockResolvedValue('hashed'), compare: jest.fn() } as any;
}

function makeOtpDeliveryServiceMock() {
  return { deliver: jest.fn().mockResolvedValue({ delivered: true, channel: 'email' }) } as any;
}

describe('AuthService OTP delivery integration', () => {
  it('register() delivers the OTP via OtpDeliveryService with the new user as recipient', async () => {
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      fullName: 'Test Patient',
      mobile: '+966500000000',
      email: 'patient@example.com',
      role: Role.PATIENT,
      status: UserStatus.PENDING_VERIFICATION,
    });
    const otpService = makeOtpServiceMock();
    const passwordService = makePasswordServiceMock();
    const otpDeliveryService = makeOtpDeliveryServiceMock();
    const service = new AuthService(prisma, otpService, passwordService, otpDeliveryService);

    await service.register({
      fullName: 'Test Patient',
      mobile: '+966500000000',
      email: 'patient@example.com',
      password: 'password123',
      role: Role.PATIENT,
    } as any);

    expect(otpDeliveryService.deliver).toHaveBeenCalledWith(
      { mobile: '+966500000000', email: 'patient@example.com', fullName: 'Test Patient' },
      '123456',
      OtpPurpose.REGISTRATION,
    );
  });

  it('register() does not let a delivery failure block the response', async () => {
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      fullName: 'Test Patient',
      mobile: '+966500000000',
      email: null,
      role: Role.PATIENT,
      status: UserStatus.PENDING_VERIFICATION,
    });
    const otpService = makeOtpServiceMock();
    const passwordService = makePasswordServiceMock();
    const otpDeliveryService = { deliver: jest.fn().mockRejectedValue(new Error('boom')) };
    const service = new AuthService(prisma, otpService, passwordService, otpDeliveryService as any);

    const result = await service.register({
      fullName: 'Test Patient',
      mobile: '+966500000000',
      password: 'password123',
      role: Role.PATIENT,
    } as any);

    expect(result.userId).toBe('user-1');
  });

  it('forgotPassword() delivers the OTP via OtpDeliveryService when the mobile is registered', async () => {
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      fullName: 'Test Patient',
      mobile: '+966500000000',
      email: 'patient@example.com',
    });
    const otpService = makeOtpServiceMock();
    const passwordService = makePasswordServiceMock();
    const otpDeliveryService = makeOtpDeliveryServiceMock();
    const service = new AuthService(prisma, otpService, passwordService, otpDeliveryService);

    await service.forgotPassword({ mobile: '+966500000000' } as any);

    expect(otpDeliveryService.deliver).toHaveBeenCalledWith(
      { mobile: '+966500000000', email: 'patient@example.com', fullName: 'Test Patient' },
      '123456',
      OtpPurpose.PASSWORD_RESET,
    );
  });

  it('forgotPassword() does not attempt delivery for an unregistered mobile', async () => {
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const otpService = makeOtpServiceMock();
    const passwordService = makePasswordServiceMock();
    const otpDeliveryService = makeOtpDeliveryServiceMock();
    const service = new AuthService(prisma, otpService, passwordService, otpDeliveryService);

    await service.forgotPassword({ mobile: '+966500000000' } as any);

    expect(otpDeliveryService.deliver).not.toHaveBeenCalled();
  });
});
