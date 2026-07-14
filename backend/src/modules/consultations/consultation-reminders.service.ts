import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY_BEFORE_WINDOW_MS = 24 * 60 * 60 * 1000;
const HOUR_BEFORE_WINDOW_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type ReminderStampField = 'dayBeforeReminderSentAt' | 'hourBeforeReminderSentAt';

@Injectable()
export class ConsultationRemindersService {
  private readonly logger = new Logger(ConsultationRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const now = new Date();
    // The day-before window's lower bound is pinned to the hour-before window's
    // upper bound so the two windows never overlap: a consultation scheduled
    // within the next hour is only ever eligible for the hour-before reminder,
    // even on a single sweep that has never run against it before.
    await this.sendDueReminders(now, HOUR_BEFORE_WINDOW_MS, DAY_BEFORE_WINDOW_MS, 'dayBeforeReminderSentAt', 'DAY_BEFORE');
    await this.sendDueReminders(now, 0, HOUR_BEFORE_WINDOW_MS, 'hourBeforeReminderSentAt', 'HOUR_BEFORE');
  }

  private async sendDueReminders(
    now: Date,
    minWindowMs: number,
    maxWindowMs: number,
    stampField: ReminderStampField,
    leadTime: 'DAY_BEFORE' | 'HOUR_BEFORE',
  ): Promise<void> {
    const due = await this.prisma.consultation.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { gt: new Date(now.getTime() + minWindowMs), lte: new Date(now.getTime() + maxWindowMs) },
        [stampField]: null,
      },
      include: { patientProfile: true },
    });

    for (const consultation of due) {
      try {
        await this.notificationsService.create(
          consultation.patientProfile.userId,
          'CONSULTATION_REMINDER',
          { leadTime },
          { entity: 'Consultation', entityId: consultation.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send CONSULTATION_REMINDER (${leadTime}) for consultation ${consultation.id}: ${err}`);
      }
      await this.prisma.consultation.update({ where: { id: consultation.id }, data: { [stampField]: now } });
    }
  }
}
