import { INestApplication } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationSettingsService } from '../src/modules/notifications/notification-settings.service';

describe('NotificationSettingsService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settingsService: NotificationSettingsService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    settingsService = app.get(NotificationSettingsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('getValueMs returns the hardcoded default when no row exists', async () => {
    const value = await settingsService.getValueMs('CONSULTATION_REMINDER_HOUR_BEFORE_MS');
    expect(value).toBe(60 * 60 * 1000);
  });

  it('listAll returns all four keys with defaults when nothing has been overridden', async () => {
    const all = await settingsService.listAll();
    expect(all).toEqual(
      expect.arrayContaining([
        { key: 'SPECIALIST_WORKLOAD_REVIEW_LEAD_MS', valueMs: 24 * 60 * 60 * 1000 },
        { key: 'SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS', valueMs: 24 * 60 * 60 * 1000 },
        { key: 'CONSULTATION_REMINDER_DAY_BEFORE_MS', valueMs: 24 * 60 * 60 * 1000 },
        { key: 'CONSULTATION_REMINDER_HOUR_BEFORE_MS', valueMs: 60 * 60 * 1000 },
      ]),
    );
    expect(all).toHaveLength(4);
  });

  it('updateValue persists an override that getValueMs then returns', async () => {
    await settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 30 * 60 * 1000);

    const value = await settingsService.getValueMs('CONSULTATION_REMINDER_HOUR_BEFORE_MS');
    expect(value).toBe(30 * 60 * 1000);
  });

  it('rejects a key not in the allow-list', async () => {
    await expect(settingsService.updateValue('NOT_A_REAL_SETTING', 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-positive valueMs', async () => {
    await expect(settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 0)).rejects.toThrow(BadRequestException);
    await expect(settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', -1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects a specialist-workload review lead time at or above the 48h window', async () => {
    await expect(settingsService.updateValue('SPECIALIST_WORKLOAD_REVIEW_LEAD_MS', 48 * 60 * 60 * 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects a specialist-workload intervention lead time at or above the 7-day window', async () => {
    await expect(settingsService.updateValue('SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS', 7 * 24 * 60 * 60 * 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects an hour-before value that would be >= the current day-before value', async () => {
    await expect(settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 24 * 60 * 60 * 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects a day-before value that would be <= the current hour-before value', async () => {
    await settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 2 * 60 * 60 * 1000);

    await expect(settingsService.updateValue('CONSULTATION_REMINDER_DAY_BEFORE_MS', 2 * 60 * 60 * 1000)).rejects.toThrow(BadRequestException);
  });

  it('allows a day-before/hour-before combination where the ordering genuinely holds', async () => {
    await settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 2 * 60 * 60 * 1000);

    const result = await settingsService.updateValue('CONSULTATION_REMINDER_DAY_BEFORE_MS', 12 * 60 * 60 * 1000);
    expect(result).toEqual({ key: 'CONSULTATION_REMINDER_DAY_BEFORE_MS', valueMs: 12 * 60 * 60 * 1000 });
  });
});
