import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

export type OtpCheckResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INCORRECT_CODE' };

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  async issue(userId: string, purpose: OtpPurpose): Promise<string> {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
    await this.prisma.otpCode.create({
      data: { userId, purpose, code, expiresAt },
    });
    return code;
  }

  async verify(userId: string, purpose: OtpPurpose, submittedCode: string): Promise<OtpCheckResult> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumed: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (otp.expiresAt < new Date()) {
      return { ok: false, reason: 'EXPIRED' };
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
    }
    if (otp.code !== submittedCode) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, reason: 'INCORRECT_CODE' };
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumed: true },
    });
    return { ok: true };
  }
}
