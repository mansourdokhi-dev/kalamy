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

describe('Notification preferences — endpoints (e2e)', () => {
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

  it('defaults every gateable type to enabled when no preference has been set', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007010', null);

    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([{ type: 'DAILY_TRAINING_REMINDER', enabled: true }]);
  });

  it('persists a disabled preference and reflects it on a subsequent GET', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007011', null);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/DAILY_TRAINING_REMINDER')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual([{ type: 'DAILY_TRAINING_REMINDER', enabled: false }]);
  });

  it('allows toggling a preference back to enabled (upsert, not insert-only)', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007012', null);
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/DAILY_TRAINING_REMINDER')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/DAILY_TRAINING_REMINDER')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual([{ type: 'DAILY_TRAINING_REMINDER', enabled: true }]);
  });

  it('rejects an attempt to disable a real but non-gateable (critical) notification type', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007013', null);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/SPECIALIST_DECISION_ISSUED')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(400);
  });

  it('rejects a preference update for a string that is not a real notification type', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007014', null);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/NOT_A_REAL_TYPE')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(400);
  });

  async function setupActiveCycle(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id,
        fullName: 'Preference Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: `PREF-${Date.now()}-${Math.random()}`,
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: `Level ${Date.now()}`, order: Math.floor(Math.random() * 100000) } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const cycleId = startRes.body.id as string;
    const completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago — interval cleared, target not met
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: completedAt } });
    await prisma.trainingSession.create({ data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt } });

    return { patientToken, patientProfile };
  }

  it('a patient who disabled DAILY_TRAINING_REMINDER via the real endpoint gets none from a real sweep, while a patient who never touched it still does', async () => {
    const { patientToken: disabledPatientToken, patientProfile: disabledPatientProfile } = await setupActiveCycle('+966500007015', '+966500007016');
    const { patientProfile: defaultPatientProfile } = await setupActiveCycle('+966500007017', '+966500007018');

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/DAILY_TRAINING_REMINDER')
      .set('Authorization', `Bearer ${disabledPatientToken}`)
      .send({ enabled: false })
      .expect(200);

    await sweepService.runSweep();

    const disabledPatientNotifications = await prisma.notification.findMany({
      where: { recipientUserId: disabledPatientProfile.userId, type: 'DAILY_TRAINING_REMINDER' },
    });
    expect(disabledPatientNotifications).toHaveLength(0);

    const defaultPatientNotifications = await prisma.notification.findMany({
      where: { recipientUserId: defaultPatientProfile.userId, type: 'DAILY_TRAINING_REMINDER' },
    });
    expect(defaultPatientNotifications).toHaveLength(1);
  });
});
