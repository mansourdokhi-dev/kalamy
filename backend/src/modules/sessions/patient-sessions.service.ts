import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, PatientSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { SessionTemplatesService } from './session-templates.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class PatientSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
    private readonly sessionTemplatesService: SessionTemplatesService,
  ) {}

  async start(patientProfileId: string, actor: AuthenticatedUser): Promise<PatientSession> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const activePlan = await this.prisma.treatmentPlan.findFirst({
      where: { patientProfileId, status: 'ACTIVE' },
    });
    if (!activePlan) {
      throw new BadRequestException('Starting the program requires an active treatment plan');
    }

    const existing = await this.prisma.patientSession.findFirst({ where: { patientProfileId } });
    if (existing) {
      throw new ConflictException('The program has already been started for this patient');
    }

    const firstTemplate = await this.sessionTemplatesService.findByNumberOrThrow(1);

    return this.prisma.patientSession.create({
      data: {
        patientProfileId,
        treatmentPlanId: activePlan.id,
        sessionTemplateId: firstTemplate.id,
        attemptNumber: 1,
      },
    });
  }

  async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
