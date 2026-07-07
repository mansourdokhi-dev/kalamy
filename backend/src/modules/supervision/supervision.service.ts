import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignSupervisorDto } from './dto/assign-supervisor.dto';
import { StaffAccountSummary } from '../admin-users/admin-users.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

const SUPERVISION_ACCOUNT_SELECT = {
  id: true,
  fullName: true,
  mobile: true,
  email: true,
  role: true,
  status: true,
  mustChangePassword: true,
  createdAt: true,
  supervisorUserId: true,
} as const;

@Injectable()
export class SupervisionService {
  constructor(private readonly prisma: PrismaService) {}

  async assignSupervisor(
    clinicianUserId: string,
    dto: AssignSupervisorDto,
  ): Promise<StaffAccountSummary & { supervisorUserId: string | null }> {
    const clinician = await this.prisma.user.findUnique({ where: { id: clinicianUserId } });
    if (!clinician) {
      throw new NotFoundException('Clinician not found');
    }
    if (clinician.role !== 'CLINICIAN') {
      throw new BadRequestException('Target user is not a CLINICIAN');
    }

    if (dto.supervisorUserId) {
      const supervisor = await this.prisma.user.findUnique({ where: { id: dto.supervisorUserId } });
      if (!supervisor || supervisor.role !== 'SUPERVISOR') {
        throw new BadRequestException('supervisorUserId must reference an existing user with role SUPERVISOR');
      }
    }

    return this.prisma.user.update({
      where: { id: clinicianUserId },
      data: { supervisorUserId: dto.supervisorUserId },
      select: SUPERVISION_ACCOUNT_SELECT,
    });
  }

  async listClinicians(
    supervisorUserId: string,
    actor: AuthenticatedUser,
  ): Promise<Array<StaffAccountSummary & { supervisorUserId: string | null }>> {
    if (actor.role === 'SUPERVISOR' && actor.id !== supervisorUserId) {
      throw new ForbiddenException('Cannot view another supervisor\'s clinician list');
    }
    return this.prisma.user.findMany({
      where: { supervisorUserId, role: 'CLINICIAN' },
      orderBy: { createdAt: 'asc' },
      select: SUPERVISION_ACCOUNT_SELECT,
    });
  }
}
