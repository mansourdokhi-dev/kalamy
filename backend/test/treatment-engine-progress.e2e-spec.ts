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

describe('Treatment Engine — Progress dashboard (e2e)', () => {
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

  it('reports the current level, completed count, repeats, and days in program from the new model', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500005001', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005000' } })).id;
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005001' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Progress Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PROGRESS-TEST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });

    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const level1Version = await prisma.levelVersion.create({
      data: {
        levelId: level1.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    // First attempt at level 1: repeated (clinician sent patient back to redo it).
    const repeatCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level1.id,
        levelVersionId: level1Version.id,
        cycleNumber: 1,
        status: 'LEVEL_REPEAT_DECIDED',
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.trainingEvent.create({
      data: { trainingCycleId: repeatCycle.id, durationSeconds: 60, unitsCompleted: 1 },
    });

    // Second attempt at level 1: approved to move on.
    const approvedCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level1.id,
        levelVersionId: level1Version.id,
        cycleNumber: 2,
        status: 'NEXT_LEVEL_APPROVED',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.trainingEvent.create({
      data: { trainingCycleId: approvedCycle.id, durationSeconds: 90, unitsCompleted: 1 },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.currentLevelOrder).toBe(1);
    expect(res.body.levelsCompleted).toBe(1);
    expect(res.body.repeatedLevelOrders).toEqual([1]);
    expect(res.body.totalTrainingEvents).toBeGreaterThan(0);
    expect(typeof res.body.daysInProgram).toBe('number');
  });
});
