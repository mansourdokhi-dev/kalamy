import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, TrainingCycle72h } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { LevelsService } from './levels.service';
import { RecordTrainingEventDto } from './dto/record-training-event.dto';
import { isCycleEligibleForSample } from './cycle-eligibility.util';

@Injectable()
export class TrainingCyclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
    private readonly levelsService: LevelsService,
  ) {}

  async startFirstCycle(patientProfileId: string, treatmentPlanId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const plan = await this.prisma.treatmentPlan.findUnique({ where: { id: treatmentPlanId } });
    if (!plan || plan.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Treatment plan not found for this patient');
    }

    const levels = await this.levelsService.list();
    const firstLevel = levels.find((l) => l.status === 'ACTIVE');
    if (!firstLevel) {
      throw new ConflictException('No active level is configured');
    }
    const activeVersion = await this.levelsService.getActiveVersion(firstLevel.id);

    return this.prisma.$transaction(async (tx) => {
      const existingCycle = await tx.trainingCycle72h.findFirst({ where: { patientProfileId } });
      if (existingCycle) {
        throw new ConflictException('This patient already has a training cycle — later levels open only via a specialist decision');
      }

      return tx.trainingCycle72h.create({
        data: {
          patientProfileId,
          treatmentPlanId,
          levelId: firstLevel.id,
          levelVersionId: activeVersion.id,
          cycleNumber: 1,
        },
      });
    });
  }

  async watchHumanModel(cycleId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const cycle = await this.findCycleOrThrow(cycleId, actor);
    if (cycle.status !== 'ACTIVE_LEVEL_TRAINING') {
      throw new ConflictException(`Cannot mark human model watched from status ${cycle.status}`);
    }
    if (cycle.humanModelWatchedAt) {
      return cycle;
    }
    return this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { humanModelWatchedAt: new Date() } });
  }

  async recordTrainingEvent(cycleId: string, dto: RecordTrainingEventDto, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const cycle = await this.findCycleOrThrow(cycleId, actor);
    if (cycle.status !== 'ACTIVE_LEVEL_TRAINING') {
      throw new ConflictException(`Cannot record training from status ${cycle.status}`);
    }
    if (!cycle.humanModelWatchedAt) {
      throw new ConflictException('Must watch the human model before training');
    }

    const occurredAt = new Date();
    await this.prisma.trainingEvent.create({
      data: { trainingCycleId: cycleId, occurredAt, durationSeconds: dto.durationSeconds, unitsCompleted: dto.unitsCompleted },
    });

    const firstTrainingEventAt = cycle.firstTrainingEventAt ?? occurredAt;
    const events = await this.prisma.trainingEvent.findMany({ where: { trainingCycleId: cycleId }, select: { occurredAt: true } });
    const eligible = isCycleEligibleForSample(
      firstTrainingEventAt,
      events.map((e) => e.occurredAt),
    );

    return this.prisma.trainingCycle72h.update({
      where: { id: cycleId },
      data: {
        firstTrainingEventAt,
        status: eligible ? 'SAMPLE_ELIGIBLE' : 'ACTIVE_LEVEL_TRAINING',
      },
    });
  }

  async getCurrent(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const cycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId, closedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!cycle) {
      throw new NotFoundException('No active training cycle');
    }
    return cycle;
  }

  private async findCycleOrThrow(cycleId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const cycle = await this.prisma.trainingCycle72h.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException('Training cycle not found');
    }
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: cycle.patientProfileId } });
    await this.patientAccessService.assertCanAccess(actor, profile);
    return cycle;
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
