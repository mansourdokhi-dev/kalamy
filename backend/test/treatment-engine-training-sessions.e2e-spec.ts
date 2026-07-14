import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

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

describe('Treatment Engine — Training Sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function setupActiveCycle(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id, fullName: 'Session Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-${Date.now()}-${Math.random()}` },
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
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    return { clinicianToken, patientToken, patientProfile, cycleId: startRes.body.id as string };
  }

  it('creates a new IN_PROGRESS session when none exists', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008000', '+966500008001');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.unitsCompleted).toBe(0);
  });

  it('returns the same session on a second start call (idempotent resume, proves the parallel-block)', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008002', '+966500008003');

    const first = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects starting a session before the human model has been watched', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500008004', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500008005', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008004' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008005' } })).id, fullName: 'No Model Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-NOMODEL-${Date.now()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);
  });

  it('rejects starting a new session within 1 hour of completing the previous one', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008006', '+966500008007');
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 30 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);
    expect(res.body.message).toContain('Cannot start a new training session');
  });

  it('allows starting a new session once the 1-hour interval has elapsed', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008008', '+966500008009');
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 90 * 60 * 1000) },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
  });
});
