import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrainingSessionsService, DAILY_TARGET_TRAININGS } from './training-sessions.service';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class TrainingReminderSweepService {
  private readonly logger = new Logger(TrainingReminderSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingSessionsService: TrainingSessionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { status: 'ACTIVE_LEVEL_TRAINING', closedAt: null, humanModelWatchedAt: { not: null } },
      include: { patientProfile: true },
    });

    for (const cycle of cycles) {
      const { intervalActive } = await this.trainingSessionsService.resolveIntervalStatus(cycle.id);
      if (intervalActive) {
        continue;
      }

      const { completedToday, periodStart } = await this.trainingSessionsService.computeDailyStatus(
        cycle.id,
        cycle.firstTrainingEventAt,
        cycle.createdAt,
      );
      if (completedToday >= DAILY_TARGET_TRAININGS) {
        continue;
      }

      if (cycle.lastDailyReminderSentAt && cycle.lastDailyReminderSentAt >= periodStart) {
        continue;
      }

      try {
        await this.notificationsService.create(
          cycle.patientProfile.userId,
          'DAILY_TRAINING_REMINDER',
          { completedToday: String(completedToday), targetPerDay: String(DAILY_TARGET_TRAININGS) },
          { entity: 'TrainingCycle72h', entityId: cycle.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send DAILY_TRAINING_REMINDER for cycle ${cycle.id}: ${err}`);
      }
      await this.prisma.trainingCycle72h.update({ where: { id: cycle.id }, data: { lastDailyReminderSentAt: new Date() } });
    }
  }
}
