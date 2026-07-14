import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, TrainingSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrainingCyclesService } from './training-cycles.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export const TRAINING_INTERVAL_MS = 60 * 60 * 1000;
export const COMPLETION_THRESHOLD_UNITS = 100;
export const DAILY_TARGET_TRAININGS = 7;

@Injectable()
export class TrainingSessionsService {
  private readonly logger = new Logger(TrainingSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
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
}
