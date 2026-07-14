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

describe('Treatment Engine — Inactivity closure (e2e)', () => {
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

  it('closes a cycle for inactivity after the configured window with no qualifying activity, and specialist-wait time never counts', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002001', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002001' } })).id,
        fullName: 'Inactivity Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'INACTIVITY-TEST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002000' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    // cycle A: ACTIVE_LEVEL_TRAINING, last TrainingEvent 40 days ago, no other activity — should close
    const staleCycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1 },
    });
    await prisma.trainingEvent.create({
      data: { trainingCycleId: staleCycle.id, occurredAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });
    await prisma.trainingCycle72h.update({
      where: { id: staleCycle.id },
      data: { updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('CLOSED_DUE_TO_INACTIVITY');
  });

  it('does not close a cycle waiting on the specialist, no matter how long the wait', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002002', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002003', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002003' } })).id,
        fullName: 'Inactivity Test Patient 2',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'INACTIVITY-TEST-2',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002002' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const waitingCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'WAITING_FOR_SPECIALIST',
        updatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.id).toBe(waitingCycle.id);
    expect(res.body.status).toBe('WAITING_FOR_SPECIALIST'); // unaffected by how long the specialist takes
  });

  it('returns the same closed cycle on a second read instead of 404ing', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002004', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002005', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002005' } })).id,
        fullName: 'Inactivity Test Patient 3',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'INACTIVITY-TEST-3',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002004' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const staleCycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1 },
    });
    await prisma.trainingEvent.create({
      data: { trainingCycleId: staleCycle.id, occurredAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });
    await prisma.trainingCycle72h.update({
      where: { id: staleCycle.id },
      data: { updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });

    const firstRead = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(firstRead.body.status).toBe('CLOSED_DUE_TO_INACTIVITY');

    const secondRead = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(secondRead.body.id).toBe(staleCycle.id);
    expect(secondRead.body.status).toBe('CLOSED_DUE_TO_INACTIVITY');
  });

  it('returns 404 for a patient who has never had any training cycle', async () => {
    await registerAndLogin(app, prisma, '+966500002006', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002007', null);
    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002007' } })).id,
        fullName: 'Never Started Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'INACTIVITY-TEST-4',
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(404);
  });

  it("allows a CLINICIAN to restart a patient after inactivity closure, at Level 1 under the patient's active plan", async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002010', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002011', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002010' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002011' } })).id,
        fullName: 'Restart Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'RESTART-TEST-1',
      },
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
    const closedCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'CLOSED_DUE_TO_INACTIVITY',
        closedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/restart-after-inactivity`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    expect(res.body.status).toBe('ACTIVE_LEVEL_TRAINING');
    expect(res.body.levelId).toBe(level.id);
    expect(res.body.levelVersionId).toBe(version.id);
    expect(res.body.treatmentPlanId).toBe(plan.id);
    expect(res.body.cycleNumber).toBe(1);
    expect(res.body.id).not.toBe(closedCycle.id);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const oldInHistory = history.body.find((c: { id: string }) => c.id === closedCycle.id);
    expect(oldInHistory.status).toBe('CLOSED_DUE_TO_INACTIVITY');
    expect(history.body.map((c: { id: string }) => c.id)).toContain(res.body.id);
  });

  it('rejects restart-after-inactivity from a PATIENT', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002012', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002013', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002012' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002013' } })).id,
        fullName: 'Restart Reject Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'RESTART-TEST-2',
      },
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
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'CLOSED_DUE_TO_INACTIVITY',
        closedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/restart-after-inactivity`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(403);
  });

  it('rejects restart-after-inactivity when the latest cycle is not closed for inactivity', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002014', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500002015', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002014' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002015' } })).id,
        fullName: 'Restart Conflict Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'RESTART-TEST-3',
      },
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
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'ACTIVE_LEVEL_TRAINING',
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/restart-after-inactivity`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(409);
  });

  it('allows only one cycle to be created when two restart-after-inactivity requests race for the same patient', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002016', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002016' } })).id;
    const patientUser = await (async () => {
      await registerAndLogin(app, prisma, '+966500002017', null);
      return prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002017' } });
    })();

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUser.id,
        fullName: 'Restart Race Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'RESTART-TEST-RACE',
      },
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
    const closedCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'CLOSED_DUE_TO_INACTIVITY',
        closedAt: new Date(),
      },
    });

    const sendRestart = () =>
      request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/restart-after-inactivity`)
        .set('Authorization', `Bearer ${clinicianToken}`);

    const [resA, resB] = await Promise.all([sendRestart(), sendRestart()]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const cycles = await prisma.trainingCycle72h.findMany({ where: { patientProfileId: patientProfile.id } });
    expect(cycles).toHaveLength(2);
    expect(cycles.filter((c) => c.id !== closedCycle.id && c.status !== 'CLOSED_DUE_TO_INACTIVITY')).toHaveLength(1);
  });
});
