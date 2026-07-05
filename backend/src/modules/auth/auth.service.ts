import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpPurpose, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from './otp.service';
import { PasswordService } from '../../common/security/password.service';
import { generateSessionToken, hashToken } from '../../common/security/token-hash.util';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;
const SESSION_TTL_HOURS = 24;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string; devOtpCode?: string }> {
    const existing = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (existing) {
      throw new ConflictException('Mobile number already registered');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        mobile: dto.mobile,
        email: dto.email,
        passwordHash,
        role: dto.role,
        status: UserStatus.PENDING_VERIFICATION,
      },
    });

    const code = await this.otpService.issue(user.id, OtpPurpose.REGISTRATION);

    return {
      userId: user.id,
      devOtpCode: process.env.DEV_MODE === 'true' ? code : undefined,
    };
  }

  async verifyRegistration(dto: VerifyOtpDto): Promise<{ verified: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const result = await this.otpService.verify(user.id, OtpPurpose.REGISTRATION, dto.code);
    if (!result.ok) {
      throw new UnauthorizedException(`OTP verification failed: ${result.reason}`);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.ACTIVE },
    });
    return { verified: true };
  }

  async login(dto: LoginDto, deviceInfo?: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException('Account temporarily locked. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    const passwordMatches = await this.passwordService.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= LOGIN_MAX_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60_000);
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        deviceInfo,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async listSessions(
    userId: string,
  ): Promise<Array<{ id: string; deviceInfo: string | null; createdAt: Date; expiresAt: Date }>> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ devOtpCode?: string }> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      // Deliberately do not reveal whether the mobile number is registered.
      return {};
    }
    const code = await this.otpService.issue(user.id, OtpPurpose.PASSWORD_RESET);
    return { devOtpCode: process.env.DEV_MODE === 'true' ? code : undefined };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const result = await this.otpService.verify(user.id, OtpPurpose.PASSWORD_RESET, dto.code);
    if (!result.ok) {
      throw new UnauthorizedException(`OTP verification failed: ${result.reason}`);
    }
    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
