import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, PatientSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { SessionTemplatesService } from './session-templates.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { SubmitRatingsDto } from './dto/submit-ratings.dto';
import { SubmitSampleDto } from './dto/submit-sample.dto';

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

  async findCurrentOrThrow(patientProfileId: string, actor: AuthenticatedUser): Promise<PatientSession> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const current = await this.prisma.patientSession.findFirst({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!current) {
      throw new NotFoundException('No session has been started for this patient yet');
    }
    return current;
  }

  async submitRatings(patientProfileId: string, dto: SubmitRatingsDto, actor: AuthenticatedUser): Promise<PatientSession> {
    const current = await this.findCurrentOrThrow(patientProfileId, actor);
    if (current.status !== 'IN_TRAINING') {
      throw new BadRequestException('Ratings can only be submitted while the current attempt is in training');
    }

    return this.prisma.patientSession.update({
      where: { id: current.id },
      data: {
        selfSeverityCurrent: dto.selfSeverityCurrent,
        selfSeverityExpectedNext: dto.selfSeverityExpectedNext,
        camperdownPerformanceRating: dto.camperdownPerformanceRating,
        clientOpinionScore: dto.clientOpinionScore,
      },
    });
  }

  async submitSample(patientProfileId: string, dto: SubmitSampleDto, actor: AuthenticatedUser): Promise<PatientSession> {
    const current = await this.findCurrentOrThrow(patientProfileId, actor);
    if (current.status !== 'IN_TRAINING') {
      throw new BadRequestException('The sample can only be submitted while the current attempt is in training');
    }

    const template = await this.sessionTemplatesService.findById(current.sessionTemplateId);
    const requiredMillis = template.trainingDurationDays * 24 * 60 * 60 * 1000;
    const elapsedMillis = Date.now() - current.trainingStartedAt.getTime();
    if (elapsedMillis < requiredMillis) {
      throw new BadRequestException(
        `The required training period (${template.trainingDurationDays} day(s)) has not elapsed yet`,
      );
    }

    return this.prisma.patientSession.update({
      where: { id: current.id },
      data: {
        sampleVideoUrl: dto.sampleVideoUrl,
        sampleSubmittedAt: new Date(),
        status: 'SUBMITTED',
      },
    });
  }
}
