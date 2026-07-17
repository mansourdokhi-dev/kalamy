import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SpecialistReviewService } from './specialist-review.service';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

// evaluateReviewDeadlines is otherwise only applied lazily, on demand, by the
// specialist-facing endpoints it's called from (see specialist-review.service.ts).
// This sweep covers the gap: a cycle nobody happens to interact with still gets
// its 24h escalation / 48h auto-release / 7-day intervention-timeout applied on
// a schedule, mirroring TrainingReminderSweepService's periodic-sweep pattern.
@Injectable()
export class SlaEvaluationSweepService {
  private readonly logger = new Logger(SlaEvaluationSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly specialistReviewService: SpecialistReviewService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { status: { in: ['WAITING_FOR_SPECIALIST', 'UNDER_REVIEW', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION', 'DIRECT_INTERVENTION_REQUIRED'] } },
    });

    for (const cycle of cycles) {
      try {
        await this.specialistReviewService.evaluateReviewDeadlines(cycle.id);
      } catch (err) {
        this.logger.error(`Failed to evaluate review deadlines for cycle ${cycle.id}: ${err}`);
      }
    }
  }
}
