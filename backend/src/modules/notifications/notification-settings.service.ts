import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const NOTIFICATION_SETTING_DEFAULTS_MS: Record<string, number> = {
  SPECIALIST_WORKLOAD_REVIEW_LEAD_MS: 24 * 60 * 60 * 1000,
  SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS: 24 * 60 * 60 * 1000,
  CONSULTATION_REMINDER_DAY_BEFORE_MS: 24 * 60 * 60 * 1000,
  CONSULTATION_REMINDER_HOUR_BEFORE_MS: 60 * 60 * 1000,
};

const REVIEW_DECISION_WINDOW_MS = 48 * 60 * 60 * 1000;
const INTERVENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getValueMs(key: string): Promise<number> {
    const row = await this.prisma.notificationSetting.findUnique({ where: { key } });
    return row?.valueMs ?? NOTIFICATION_SETTING_DEFAULTS_MS[key];
  }

  async listAll(): Promise<Array<{ key: string; valueMs: number }>> {
    return Promise.all(
      Object.keys(NOTIFICATION_SETTING_DEFAULTS_MS).map(async (key) => ({ key, valueMs: await this.getValueMs(key) })),
    );
  }

  async updateValue(key: string, valueMs: number): Promise<{ key: string; valueMs: number }> {
    if (!Object.prototype.hasOwnProperty.call(NOTIFICATION_SETTING_DEFAULTS_MS, key)) {
      throw new BadRequestException(`${key} is not a configurable notification setting`);
    }
    if (!Number.isInteger(valueMs) || valueMs <= 0) {
      throw new BadRequestException('valueMs must be a positive integer');
    }
    if (key === 'SPECIALIST_WORKLOAD_REVIEW_LEAD_MS' && valueMs >= REVIEW_DECISION_WINDOW_MS) {
      throw new BadRequestException('SPECIALIST_WORKLOAD_REVIEW_LEAD_MS must be less than the 48h review-decision window');
    }
    if (key === 'SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS' && valueMs >= INTERVENTION_WINDOW_MS) {
      throw new BadRequestException('SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS must be less than the 7-day intervention window');
    }
    if (key === 'CONSULTATION_REMINDER_HOUR_BEFORE_MS') {
      const dayBefore = await this.getValueMs('CONSULTATION_REMINDER_DAY_BEFORE_MS');
      if (valueMs >= dayBefore) {
        throw new BadRequestException('CONSULTATION_REMINDER_HOUR_BEFORE_MS must be less than CONSULTATION_REMINDER_DAY_BEFORE_MS');
      }
    }
    if (key === 'CONSULTATION_REMINDER_DAY_BEFORE_MS') {
      const hourBefore = await this.getValueMs('CONSULTATION_REMINDER_HOUR_BEFORE_MS');
      if (valueMs <= hourBefore) {
        throw new BadRequestException('CONSULTATION_REMINDER_DAY_BEFORE_MS must be greater than CONSULTATION_REMINDER_HOUR_BEFORE_MS');
      }
    }

    await this.prisma.notificationSetting.upsert({
      where: { key },
      create: { key, valueMs },
      update: { valueMs },
    });
    return { key, valueMs };
  }
}
