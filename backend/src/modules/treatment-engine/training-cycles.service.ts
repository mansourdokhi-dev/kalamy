import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, Prisma, TrainingCycle72h } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { LevelsService } from './levels.service';
import { RecordTrainingEventDto } from './dto/record-training-event.dto';
import { isCycleEligibleForSample } from './cycle-eligibility.util';

const INACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 1 month default, admin-configurable in a later pass
const STATES_EXEMPT_FROM_INACTIVITY: readonly string[] = [
  'WAITING_FOR_SPECIALIST',
  'UNDER_REVIEW',
  'DIRECT_INTERVENTION_REQUIRED',
  'WAITING_FINAL_DECISION_AFTER_INTERVENTION',
  'NEXT_LEVEL_APPROVED',
  'LEVEL_REPEAT_DECIDED',
  'CLOSED_DUE_TO_INACTIVITY',
  'SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN',
];

export type TrainingCycleWithSample = Prisma.TrainingCycle72hGetPayload<{
  include: { speechSample: { include: { parts: true } } };
}>;

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

    try {
      return await this.prisma.$transaction(async (tx) => {
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
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This patient already has a training cycle — later levels open only via a specialist decision');
      }
      throw error;
    }
  }

  async watchHumanModel(cycleId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const cycle = await this.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'ACTIVE_LEVEL_TRAINING') {
      throw new ConflictException(`Cannot mark human model watched from status ${cycle.status}`);
    }
    if (cycle.humanModelWatchedAt) {
      return cycle;
    }
    return this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { humanModelWatchedAt: new Date() } });
  }

  async recordTrainingEvent(cycleId: string, dto: RecordTrainingEventDto, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const cycle = await this.findCycleForActor(cycleId, actor);
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

    let cycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId, closedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!cycle) {
      throw new NotFoundException('No active training cycle');
    }

    if (!STATES_EXEMPT_FROM_INACTIVITY.includes(cycle.status) && Date.now() - cycle.updatedAt.getTime() > INACTIVITY_WINDOW_MS) {
      cycle = await this.prisma.trainingCycle72h.update({
        where: { id: cycle.id },
        data: { status: 'CLOSED_DUE_TO_INACTIVITY', closedAt: new Date() },
      });
    }

    return cycle;
  }

  async listHistory(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycleWithSample[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);
    return this.prisma.trainingCycle72h.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'asc' },
      include: { speechSample: { include: { parts: true } } },
    });
  }

  async findCycleForActor(cycleId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
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
