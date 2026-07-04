import { OtpPurpose } from '@prisma/client';
import { OtpService } from './otp.service';

function makePrismaMock() {
  const otpCode = {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  return { otpCode } as any;
}

describe('OtpService', () => {
  it('issues a 6-digit code and stores it with a 5-minute expiry', async () => {
    const prisma = makePrismaMock();
    const service = new OtpService(prisma);

    const code = await service.issue('user-1', OtpPurpose.REGISTRATION);

    expect(code).toMatch(/^\d{6}$/);
    expect(prisma.otpCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', purpose: OtpPurpose.REGISTRATION, code }),
      }),
    );
  });

  it('fails verification when no OTP exists', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue(null);
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '123456');

    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('fails verification when the OTP has expired', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      attempts: 0,
      expiresAt: new Date(Date.now() - 1000),
    });
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '123456');

    expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('fails verification after 5 attempts', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      attempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '123456');

    expect(result).toEqual({ ok: false, reason: 'TOO_MANY_ATTEMPTS' });
  });

  it('increments attempts and fails on an incorrect code', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '000000');

    expect(result).toEqual({ ok: false, reason: 'INCORRECT_CODE' });
    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { attempts: { increment: 1 } },
    });
  });

  it('succeeds and consumes the OTP on a correct code', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '123456');

    expect(result).toEqual({ ok: true });
    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { consumed: true },
    });
  });
});
