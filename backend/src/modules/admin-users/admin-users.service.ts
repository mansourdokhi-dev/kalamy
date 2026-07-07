import { ConflictException, Injectable } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';
import { CreateStaffDto } from './dto/create-staff.dto';

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
      select: {
        id: true,
        fullName: true,
        mobile: true,
        email: true,
        role: true,
        status: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });
  }
}
