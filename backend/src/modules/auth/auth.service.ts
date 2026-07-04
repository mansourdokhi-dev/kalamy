import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from './otp.service';
import { PasswordService } from '../../common/security/password.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

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
}
