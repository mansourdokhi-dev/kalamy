import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingReminderSweepService } from '../src/modules/treatment-engine/training-reminder-sweep.service';

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

describe('Daily Training Reminder sweep (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweepService: TrainingReminderSweepService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sweepService = app.get(TrainingReminderSweepService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function setupActiveCycle(clinicianMobile: string, patientMobile: string, watchHumanModel = true) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id, fullName: 'Reminder Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `REMINDER-${Date.now()}-${Math.random()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    if (watchHumanModel) {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(201);
    }

    return { clinicianToken, patientToken, patientProfile, cycleId: startRes.body.id as string };
  }

  it('sends a reminder when the interval has cleared and today\'s target has not been met', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009000', '+966500009001');
    const completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago — the 1h interval has cleared
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: completedAt } });
    await prisma.trainingSession.create({ data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(1);
    const updatedCycle = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
    expect(updatedCycle.lastDailyReminderSentAt).not.toBeNull();
  });

  it('does not send a reminder while the interval is still active', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009002', '+966500009003');
    const completedAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago — the 1h interval is still active
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: completedAt } });
    await prisma.trainingSession.create({ data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a reminder once today\'s target of 7 trainings is already met', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009004', '+966500009005');
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: start } });
    for (let i = 0; i < 7; i++) {
      // Spaced 1 minute apart, all within the last 3 hours — irrelevant to the interval gate here (the
      // last one is still well over an hour in the past), this test isolates the daily-target gate.
      await prisma.trainingSession.create({
        data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(start.getTime() + i * 60 * 1000) },
      });
    }

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a second reminder on a repeated sweep within the same day-period', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009006', '+966500009007');
    const completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: completedAt } });
    await prisma.trainingSession.create({ data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt } });

    await sweepService.runSweep();
    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(1);
  });

  it('sends again once a new day-period has rolled over past the last reminder', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009008', '+966500009009');
    const start = new Date(Date.now() - 26 * 60 * 60 * 1000); // 26 hours ago — currently in period 1 (24h-48h from start)
    await prisma.trainingCycle72h.update({
      where: { id: cycleId },
      data: { firstTrainingEventAt: start, lastDailyReminderSentAt: new Date(start.getTime() + 5 * 60 * 60 * 1000) }, // stamped during period 0
    });
    // One completed session in period 0 (so the interval gate resolves against a timestamp well over an hour old).
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(start.getTime() + 5 * 60 * 60 * 1000) },
    });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(1);
  });

  it('does not send a reminder for a cycle whose human model has not been watched yet', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009010', '+966500009011', false);

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a reminder for a cycle that is not ACTIVE_LEVEL_TRAINING', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009012', '+966500009013');
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'SAMPLE_ELIGIBLE' } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });
});
