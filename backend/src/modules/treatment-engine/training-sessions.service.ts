import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TrainingCycle72h, TrainingSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrainingCyclesService } from './training-cycles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { RecordProgressDto } from './dto/record-progress.dto';
import { isCycleEligibleForSample } from './cycle-eligibility.util';

export const TRAINING_INTERVAL_MS = 60 * 60 * 1000;
export const COMPLETION_THRESHOLD_UNITS = 100;
export const DAILY_TARGET_TRAININGS = 7;

@Injectable()
export class TrainingSessionsService {
  private readonly logger = new Logger(TrainingSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async startOrResume(cycleId: string, actor: AuthenticatedUser): Promise<TrainingSession> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'ACTIVE_LEVEL_TRAINING') {
      throw new ConflictException(`Cannot start or resume a training session from status ${cycle.status}`);
    }
    if (!cycle.humanModelWatchedAt) {
      throw new ConflictException('Must watch the human model before training');
    }

    const existing = await this.prisma.trainingSession.findFirst({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });
    if (existing) {
      return existing;
    }

    const { intervalActive, nextAvailableAt } = await this.resolveIntervalStatus(cycleId);
    if (intervalActive) {
      throw new ConflictException(`Cannot start a new training session until ${nextAvailableAt!.toISOString()}`);
    }

    try {
      return await this.prisma.trainingSession.create({ data: { trainingCycleId: cycleId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.trainingSession.findFirstOrThrow({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });
      }
      throw error;
    }
  }

  async recordProgress(cycleId: string, dto: RecordProgressDto, actor: AuthenticatedUser): Promise<TrainingSession> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.prisma.trainingSession.findFirst({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });
    if (!session) {
      throw new NotFoundException('No in-progress training session for this cycle');
    }

    const unitsCompleted = Math.max(session.unitsCompleted, dto.unitsCompleted);

    if (unitsCompleted >= COMPLETION_THRESHOLD_UNITS) {
      const completed = await this.prisma.trainingSession.update({
        where: { id: session.id },
        data: { unitsCompleted, status: 'COMPLETED', completedAt: new Date() },
      });
      await this.completeAndCheckEligibility(completed, cycle);
      return completed;
    }

    return this.prisma.trainingSession.update({ where: { id: session.id }, data: { unitsCompleted } });
  }

  private async completeAndCheckEligibility(session: TrainingSession, cycle: TrainingCycle72h): Promise<void> {
    const occurredAt = session.completedAt!;
    await this.prisma.trainingEvent.create({
      data: { trainingCycleId: cycle.id, occurredAt, unitsCompleted: session.unitsCompleted },
    });

    const firstTrainingEventAt = cycle.firstTrainingEventAt ?? occurredAt;
    const events = await this.prisma.trainingEvent.findMany({ where: { trainingCycleId: cycle.id }, select: { occurredAt: true } });
    const eligible = isCycleEligibleForSample(
      firstTrainingEventAt,
      events.map((e) => e.occurredAt),
    );

    const updatedCycle = await this.prisma.trainingCycle72h.update({
      where: { id: cycle.id },
      data: {
        firstTrainingEventAt,
        status: eligible ? 'SAMPLE_ELIGIBLE' : 'ACTIVE_LEVEL_TRAINING',
        sampleEligibleAt: eligible ? new Date() : undefined,
      },
    });

    if (eligible) {
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
        this.logger.error(`Failed to send SAMPLE_ELIGIBLE_FOR_RECORDING notification for cycle ${updatedCycle.id}: ${err}`);
      }
    }
  }

  async resolveIntervalStatus(cycleId: string): Promise<{ intervalActive: boolean; nextAvailableAt: Date | null }> {
    const lastCompleted = await this.prisma.trainingSession.findFirst({
      where: { trainingCycleId: cycleId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
    if (!lastCompleted?.completedAt) {
      return { intervalActive: false, nextAvailableAt: null };
    }
    const nextAvailableAt = new Date(lastCompleted.completedAt.getTime() + TRAINING_INTERVAL_MS);
    const intervalActive = Date.now() < nextAvailableAt.getTime();
    return { intervalActive, nextAvailableAt: intervalActive ? nextAvailableAt : null };
  }

  async computeDailyStatus(
    cycleId: string,
    firstTrainingEventAt: Date | null,
    cycleCreatedAt: Date,
  ): Promise<{ completedToday: number; periodStart: Date }> {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const anchorMs = (firstTrainingEventAt ?? cycleCreatedAt).getTime();
    const currentPeriodIndex = Math.floor((Date.now() - anchorMs) / DAY_MS);
    const periodStart = new Date(anchorMs + currentPeriodIndex * DAY_MS);
    const periodEnd = new Date(anchorMs + (currentPeriodIndex + 1) * DAY_MS);

    let completedToday = 0;
    if (firstTrainingEventAt) {
      completedToday = await this.prisma.trainingSession.count({
        where: { trainingCycleId: cycleId, status: 'COMPLETED', completedAt: { gte: periodStart, lt: periodEnd } },
      });
    }

    return { completedToday, periodStart };
  }

  async getProgress(
    cycleId: string,
    actor: AuthenticatedUser,
  ): Promise<{ completedToday: number; targetPerDay: number; intervalActive: boolean; nextAvailableAt: string | null; currentSessionId: string | null }> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const { intervalActive, nextAvailableAt } = await this.resolveIntervalStatus(cycleId);
    const { completedToday } = await this.computeDailyStatus(cycleId, cycle.firstTrainingEventAt, cycle.createdAt);

    const inProgress = await this.prisma.trainingSession.findFirst({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });

    return {
      completedToday,
      targetPerDay: DAILY_TARGET_TRAININGS,
      intervalActive,
      nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
      currentSessionId: inProgress?.id ?? null,
    };
  }
}
