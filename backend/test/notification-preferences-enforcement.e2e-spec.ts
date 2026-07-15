import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

async function registerPatient(app: INestApplication, prisma: PrismaService, mobile: string): Promise<{ userId: string }> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
  return { userId };
}

describe('Notification preferences — enforcement in NotificationsService.create (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notificationsService: NotificationsService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    notificationsService = app.get(NotificationsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('creates a notification for a gateable type when no preference row exists (default enabled)', async () => {
    const { userId } = await registerPatient(app, prisma, '+966500007000');

    const result = await notificationsService.create(userId, 'DAILY_TRAINING_REMINDER', { completedToday: '2', targetPerDay: '7' });

    expect(result).not.toBeNull();
    const notifications = await prisma.notification.findMany({ where: { recipientUserId: userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(1);
  });

  it('does not create a notification when the recipient has explicitly disabled a gateable type', async () => {
    const { userId } = await registerPatient(app, prisma, '+966500007001');
    await prisma.notificationPreference.create({ data: { userId, type: 'DAILY_TRAINING_REMINDER', enabled: false } });

    const result = await notificationsService.create(userId, 'DAILY_TRAINING_REMINDER', { completedToday: '2', targetPerDay: '7' });

    expect(result).toBeNull();
    const notifications = await prisma.notification.findMany({ where: { recipientUserId: userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('still creates a notification for a non-gateable type even if a preference row exists with enabled: false', async () => {
    const { userId } = await registerPatient(app, prisma, '+966500007002');
    // Seeded directly via Prisma to prove create()'s guard is scoped to GATEABLE_NOTIFICATION_TYPES,
    // not "any row that happens to exist" — the real PATCH endpoint (Task 2) would never let this
    // row be created through the API itself.
    await prisma.notificationPreference.create({ data: { userId, type: 'SPECIALIST_DECISION_ISSUED', enabled: false } });

    const result = await notificationsService.create(userId, 'SPECIALIST_DECISION_ISSUED', { decision: 'TRANSITION', levelName: 'Level 1' });

    expect(result).not.toBeNull();
    const notifications = await prisma.notification.findMany({ where: { recipientUserId: userId, type: 'SPECIALIST_DECISION_ISSUED' } });
    expect(notifications).toHaveLength(1);
  });

  it('scopes the preference to the individual user, not globally', async () => {
    const { userId: disabledUserId } = await registerPatient(app, prisma, '+966500007003');
    const { userId: defaultUserId } = await registerPatient(app, prisma, '+966500007004');
    await prisma.notificationPreference.create({ data: { userId: disabledUserId, type: 'DAILY_TRAINING_REMINDER', enabled: false } });

    const disabledResult = await notificationsService.create(disabledUserId, 'DAILY_TRAINING_REMINDER', { completedToday: '2', targetPerDay: '7' });
    const defaultResult = await notificationsService.create(defaultUserId, 'DAILY_TRAINING_REMINDER', { completedToday: '2', targetPerDay: '7' });

    expect(disabledResult).toBeNull();
    expect(defaultResult).not.toBeNull();
  });
});
