import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConsultationRemindersService } from '../src/modules/consultations/consultation-reminders.service';

async function registerAndLogin(
  app: INestApplication,
  prisma: PrismaService,
  mobile: string,
  role: 'CLINICIAN' | 'ADMIN' | 'SUPERVISOR' | null,
): Promise<string> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  if (role) {
    await prisma.user.update({ where: { mobile }, data: { role } });
  }
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  return login.body.token;
}

describe('Consultation Reminders sweep (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let remindersService: ConsultationRemindersService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    remindersService = app.get(ConsultationRemindersService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function setupScheduledConsultation(mobile: string, scheduledAt: Date) {
    const patientToken = await registerAndLogin(app, prisma, mobile, null);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
    const profile = await prisma.patientProfile.create({
      data: { userId, fullName: 'Reminder Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `REMINDER-${Date.now()}-${Math.random()}` },
    });
    const consultation = await prisma.consultation.create({
      data: {
        patientProfileId: profile.id,
        requestedByUserId: userId,
        type: 'VOICE',
        status: 'SCHEDULED',
        scheduledAt,
      },
    });
    return { patientToken, consultation };
  }

  it('sends a day-before reminder for a consultation scheduled 23 hours from now', async () => {
    const { patientToken, consultation } = await setupScheduledConsultation('+966500007000', new Date(Date.now() + 23 * 60 * 60 * 1000));

    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const found = notifications.body.find((n: { type: string }) => n.type === 'CONSULTATION_REMINDER');
    expect(found).toBeTruthy();

    const updated = await prisma.consultation.findUniqueOrThrow({ where: { id: consultation.id } });
    expect(updated.dayBeforeReminderSentAt).not.toBeNull();
    expect(updated.hourBeforeReminderSentAt).toBeNull();
  });

  it('does not send a second day-before reminder on a repeated sweep', async () => {
    const { patientToken } = await setupScheduledConsultation('+966500007001', new Date(Date.now() + 23 * 60 * 60 * 1000));

    await remindersService.runSweep();
    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const matches = notifications.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER');
    expect(matches).toHaveLength(1);
  });

  it('sends an hour-before reminder for a consultation scheduled 45 minutes from now', async () => {
    const { patientToken, consultation } = await setupScheduledConsultation('+966500007002', new Date(Date.now() + 45 * 60 * 1000));

    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(notifications.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER')).toHaveLength(1);

    const updated = await prisma.consultation.findUniqueOrThrow({ where: { id: consultation.id } });
    expect(updated.hourBeforeReminderSentAt).not.toBeNull();
  });

  it('sends no reminder for a consultation scheduled 3 days from now', async () => {
    const { patientToken } = await setupScheduledConsultation('+966500007003', new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));

    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(notifications.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER')).toHaveLength(0);
  });

  it('sends no reminder for a cancelled consultation even if its old scheduledAt is within the window', async () => {
    const { patientToken, consultation } = await setupScheduledConsultation('+966500007004', new Date(Date.now() + 30 * 60 * 1000));
    await prisma.consultation.update({ where: { id: consultation.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });

    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(notifications.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER')).toHaveLength(0);
  });
});
