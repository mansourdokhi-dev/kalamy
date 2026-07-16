import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

// Deliberately excludes passwordHash and other internal fields (see review
// history: two prior response leaks were fixed by scoping every returning
// User query to this select). Keep in sync with SUPERVISION_ACCOUNT_SELECT
// in ../supervision/supervision.service.ts, which mirrors these same fields.
const STAFF_ACCOUNT_SUMMARY_SELECT = {
  id: true,
  fullName: true,
  mobile: true,
  email: true,
  role: true,
  status: true,
  mustChangePassword: true,
  createdAt: true,
} as const;

export interface StaffAccountSummary {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: Date;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async createStaff(dto: CreateStaffDto): Promise<StaffAccountSummary> {
    const existing = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (existing) {
      throw new ConflictException('Mobile number already registered');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    return this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        mobile: dto.mobile,
        email: dto.email,
        passwordHash,
        role: dto.role,
        status: 'ACTIVE',
        mustChangePassword: true,
      },
      select: STAFF_ACCOUNT_SUMMARY_SELECT,
    });
  }

  async list(filters: { role?: string; status?: string }): Promise<StaffAccountSummary[]> {
    return this.prisma.user.findMany({
      where: {
        role: filters.role as never,
        status: filters.status as never,
      },
      orderBy: { createdAt: 'asc' },
      select: STAFF_ACCOUNT_SUMMARY_SELECT,
    });
  }

  async findById(id: string): Promise<StaffAccountSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: STAFF_ACCOUNT_SUMMARY_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto): Promise<StaffAccountSummary> {
    await this.findById(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
      select: STAFF_ACCOUNT_SUMMARY_SELECT,
    });
    // A disabled account must lose access immediately, not just block future
    // logins — otherwise an already-issued token keeps working for up to the
    // full session TTL after an admin disables it. Mirrors the revocation
    // already done on password reset (auth.service.ts resetPassword).
    if (dto.status !== 'ACTIVE') {
      await this.prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return updated;
  }
}
