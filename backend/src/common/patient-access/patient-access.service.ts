import { ForbiddenException, Injectable } from '@nestjs/common';
import { PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/session.guard';

@Injectable()
export class PatientAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanAccess(actor: AuthenticatedUser, profile: PatientProfile): Promise<void> {
    if (actor.role === Role.CLINICIAN || actor.role === Role.SUPERVISOR || actor.role === Role.ADMIN) {
      return;
    }
    if (actor.role === Role.PATIENT) {
      if (profile.userId === actor.id) {
        return;
      }
      throw new ForbiddenException("Cannot access another patient's data");
    }
    if (actor.role === Role.CAREGIVER) {
      const link = await this.prisma.guardianLink.findFirst({
        where: { guardianUserId: actor.id, patientUserId: profile.userId },
      });
      if (link) {
        return;
      }
      throw new ForbiddenException('Not linked as guardian for this patient');
    }
    throw new ForbiddenException('Access denied');
  }
}
