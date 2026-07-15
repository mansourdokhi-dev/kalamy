import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getNotificationContext } from '../notifications/notification-context.util';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const REVIEW_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // half of the 48h review-decision window
const INTERVENTION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // flat one-day-before on the 7-day intervention window

@Injectable()
export class SpecialistWorkloadReminderSweepService {
  private readonly logger = new Logger(SpecialistWorkloadReminderSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const samples = await this.prisma.speechSample.findMany({
      where: {
        reservedByUserId: { not: null },
        deadlineReminderSentAt: null,
        OR: [
          { trainingCycle: { status: { in: ['UNDER_REVIEW', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'] } }, reviewDeadlineAt: { not: null } },
          { trainingCycle: { status: 'DIRECT_INTERVENTION_REQUIRED' }, interventionDeadlineAt: { not: null } },
        ],
      },
      include: { trainingCycle: true },
    });

    const now = Date.now();
    for (const sample of samples) {
      const isIntervention = sample.trainingCycle.status === 'DIRECT_INTERVENTION_REQUIRED';
      const deadline = isIntervention ? sample.interventionDeadlineAt : sample.reviewDeadlineAt;
      if (!deadline) {
        continue;
      }
      const leadTimeMs = isIntervention ? INTERVENTION_REMINDER_LEAD_MS : REVIEW_REMINDER_LEAD_MS;
      const remindAt = deadline.getTime() - leadTimeMs;
      if (now < remindAt || now >= deadline.getTime()) {
        continue;
      }

      const { patientName, levelName } = await getNotificationContext(this.prisma, sample.trainingCycle);
      try {
        await this.notificationsService.create(
          sample.reservedByUserId!,
          'SPECIALIST_WORKLOAD_REMINDER',
          { kind: isIntervention ? 'INTERVENTION_OUTCOME' : 'REVIEW_DECISION', patientName, levelName },
          { entity: 'SpeechSample', entityId: sample.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send SPECIALIST_WORKLOAD_REMINDER for sample ${sample.id}: ${err}`);
      }
      await this.prisma.speechSample.update({ where: { id: sample.id }, data: { deadlineReminderSentAt: new Date() } });
    }
  }
}
