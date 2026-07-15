import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type ReminderStampField = 'dayBeforeReminderSentAt' | 'hourBeforeReminderSentAt';

@Injectable()
export class ConsultationRemindersService {
  private readonly logger = new Logger(ConsultationRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationSettingsService: NotificationSettingsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const now = new Date();
    const dayBeforeWindowMs = await this.notificationSettingsService.getValueMs('CONSULTATION_REMINDER_DAY_BEFORE_MS');
    const hourBeforeWindowMs = await this.notificationSettingsService.getValueMs('CONSULTATION_REMINDER_HOUR_BEFORE_MS');
    // The day-before window's lower bound is pinned to the hour-before window's
    // upper bound so the two windows never overlap: a consultation scheduled
    // within the next hour is only ever eligible for the hour-before reminder,
    // even on a single sweep that has never run against it before. This ordering
    // is enforced by NotificationSettingsService.updateValue whenever either
    // setting changes, so hourBeforeWindowMs < dayBeforeWindowMs always holds here.
    await this.sendDueReminders(now, hourBeforeWindowMs, dayBeforeWindowMs, 'dayBeforeReminderSentAt', 'DAY_BEFORE');
    await this.sendDueReminders(now, 0, hourBeforeWindowMs, 'hourBeforeReminderSentAt', 'HOUR_BEFORE');
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
