import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Level, LevelVersion, PatientProfile, Prisma, TrainingCycle72h } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { LevelsService } from './levels.service';
import { RecordTrainingEventDto } from './dto/record-training-event.dto';
import { isCycleEligibleForSample } from './cycle-eligibility.util';
import { NotificationsService } from '../notifications/notifications.service';
import { getNotificationContext } from '../notifications/notification-context.util';

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
const SAMPLE_SUBMISSION_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const STATES_AWAITING_SAMPLE_SUBMISSION: readonly string[] = ['SAMPLE_ELIGIBLE', 'SAMPLE_PREPARATION'];

export type TrainingCycleWithSample = Prisma.TrainingCycle72hGetPayload<{
  include: { speechSample: { include: { parts: true } } };
}>;

@Injectable()
export class TrainingCyclesService {
  private readonly logger = new Logger(TrainingCyclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
    private readonly levelsService: LevelsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async startFirstCycle(patientProfileId: string, treatmentPlanId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const plan = await this.prisma.treatmentPlan.findUnique({ where: { id: treatmentPlanId } });
    if (!plan || plan.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Treatment plan not found for this patient');
    }

    const { level: firstLevel, version: activeVersion } = await this.resolveFirstLevel();

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

  private async resolveFirstLevel(): Promise<{ level: Level; version: LevelVersion }> {
    const levels = await this.levelsService.list();
    const firstLevel = levels.find((l) => l.status === 'ACTIVE');
    if (!firstLevel) {
      throw new ConflictException('No active level is configured');
    }
    const activeVersion = await this.levelsService.getActiveVersion(firstLevel.id);
    return { level: firstLevel, version: activeVersion };
  }

  async restartAfterInactivity(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const latestCycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latestCycle || latestCycle.status !== 'CLOSED_DUE_TO_INACTIVITY') {
      throw new ConflictException('Patient does not have a cycle closed due to inactivity');
    }

    const activePlan = await this.prisma.treatmentPlan.findFirst({
      where: { patientProfileId, status: 'ACTIVE' },
    });
    if (!activePlan) {
      throw new ConflictException('Patient has no active treatment plan');
    }

    const { level: firstLevel, version: activeVersion } = await this.resolveFirstLevel();

    try {
      return await this.prisma.trainingCycle72h.create({
        data: {
          patientProfileId,
          treatmentPlanId: activePlan.id,
          levelId: firstLevel.id,
          levelVersionId: activeVersion.id,
          cycleNumber: 1,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Patient already has an open training cycle');
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

    const updatedCycle = await this.prisma.trainingCycle72h.update({
      where: { id: cycleId },
      data: {
        firstTrainingEventAt,
        status: eligible ? 'SAMPLE_ELIGIBLE' : 'ACTIVE_LEVEL_TRAINING',
        sampleEligibleAt: eligible ? new Date() : undefined,
      },
    });

    if (eligible) {
      // Fetched directly rather than via the shared getNotificationContext util:
      // this call site needs patientProfile.userId (the recipient), which that
      // util doesn't expose (it returns patientName/levelName only) — going
      // through it here would mean fetching patientProfile twice for no reason.
      const [patientProfile, level] = await Promise.all([
        this.prisma.patientProfile.findUniqueOrThrow({ where: { id: updatedCycle.patientProfileId } }),
        this.prisma.level.findUniqueOrThrow({ where: { id: updatedCycle.levelId } }),
      ]);
      try {
        await this.notificationsService.create(
          patientProfile.userId,
          'SAMPLE_ELIGIBLE_FOR_RECORDING',
          { levelName: level.name },
          { entity: 'TrainingCycle72h', entityId: updatedCycle.id },
        );
      } catch (err) {
        // The cycle's status has already been committed above — a notification
        // failure must never mask that success or block the response to the patient.
        this.logger.error(`Failed to send SAMPLE_ELIGIBLE_FOR_RECORDING notification for cycle ${updatedCycle.id}: ${err}`);
      }
    }

    return updatedCycle;
  }

  async getCurrent(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycleWithSample> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    let cycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId, closedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { speechSample: { include: { parts: true } } },
    });

    if (
      cycle &&
      STATES_AWAITING_SAMPLE_SUBMISSION.includes(cycle.status) &&
      cycle.sampleEligibleAt &&
      Date.now() - cycle.sampleEligibleAt.getTime() > SAMPLE_SUBMISSION_GRACE_MS
    ) {
      cycle = await this.prisma.trainingCycle72h.update({
        where: { id: cycle.id },
        data: { status: 'SAMPLE_SUBMISSION_DELAYED' },
        include: { speechSample: { include: { parts: true } } },
      });

      const [patientProfile, { patientName, levelName }] = await Promise.all([
        this.prisma.patientProfile.findUniqueOrThrow({ where: { id: cycle.patientProfileId } }),
        getNotificationContext(this.prisma, cycle),
      ]);
      try {
        await this.notificationsService.create(
          patientProfile.userId,
          'SAMPLE_SUBMISSION_REMINDER',
          { levelName },
          { entity: 'TrainingCycle72h', entityId: cycle.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send SAMPLE_SUBMISSION_REMINDER notification for cycle ${cycle.id}: ${err}`);
      }
      try {
        await this.notificationsService.notifyRole(
          'SUPERVISOR',
          'SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR',
          { patientName, levelName },
          { entity: 'TrainingCycle72h', entityId: cycle.id },
        );
      } catch (err) {
        this.logger.error(`Failed to notify SUPERVISOR role of SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR for cycle ${cycle.id}: ${err}`);
      }
    }

    if (cycle && !STATES_EXEMPT_FROM_INACTIVITY.includes(cycle.status) && Date.now() - cycle.updatedAt.getTime() > INACTIVITY_WINDOW_MS) {
      cycle = await this.prisma.trainingCycle72h.update({
        where: { id: cycle.id },
        data: { status: 'CLOSED_DUE_TO_INACTIVITY', closedAt: new Date() },
        include: { speechSample: { include: { parts: true } } },
      });
    }

    if (!cycle) {
      // No open cycle — fall back to the most recent cycle overall (e.g. one
      // already closed for inactivity on a prior read) so callers can see its
      // real terminal status instead of a blind 404. Only a patient who has
      // never had any cycle at all still gets NotFoundException below.
      cycle = await this.prisma.trainingCycle72h.findFirst({
        where: { patientProfileId },
        orderBy: { createdAt: 'desc' },
        include: { speechSample: { include: { parts: true } } },
      });
    }

    if (!cycle) {
      throw new NotFoundException('No active training cycle');
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
