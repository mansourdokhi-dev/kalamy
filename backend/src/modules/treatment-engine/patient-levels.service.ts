import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export interface PassedLevelSummary {
  levelId: string;
  levelName: string;
  order: number;
  levelVersionId: string;
  passedAt: Date | null;
}

@Injectable()
export class PatientLevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async listPassed(patientProfileId: string, actor: AuthenticatedUser): Promise<PassedLevelSummary[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { patientProfileId, status: 'NEXT_LEVEL_APPROVED' },
      orderBy: { closedAt: 'desc' },
      distinct: ['levelId'],
      include: { level: true },
    });

    return cycles
      .map((cycle) => ({
        levelId: cycle.levelId,
        levelName: cycle.level.name,
        order: cycle.level.order,
        levelVersionId: cycle.levelVersionId,
        passedAt: cycle.closedAt,
      }))
      .sort((a, b) => a.order - b.order);
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
