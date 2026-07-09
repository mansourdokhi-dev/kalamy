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

describe('Treatment Engine — Cycle lifecycle (e2e)', () => {
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

  it('rejects recording a training event before the human model has been watched', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500001000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001001', null);
    const patientMe = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Authorization', `Bearer ${patientToken}`);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001001' } })).id,
        fullName: 'Cycle Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'CYCLE-TEST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001000' } })).id, type: 'INITIAL', status: 'APPROVED' },
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

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    expect(startRes.body.status).toBe('ACTIVE_LEVEL_TRAINING');
    expect(startRes.body.levelId).toBe(level.id); // the service picks the lowest-order active level itself
    expect(startRes.body.levelVersionId).toBe(version.id);

    // starting again for the same patient must fail — later levels only open via a specialist decision
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(201);

    const currentRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(currentRes.body.status).toBe('ACTIVE_LEVEL_TRAINING'); // one event alone is not the full 72h gate
  });

  it('rejects starting a cycle with a treatment plan that belongs to a different patient', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500001002', 'CLINICIAN');
    const patientAToken = await registerAndLogin(app, prisma, '+966500001003', null);
    await registerAndLogin(app, prisma, '+966500001004', null);

    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001002' } })).id;

    const patientAProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001003' } })).id,
        fullName: 'Patient A',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'CYCLE-TEST-A',
      },
    });
    const patientBProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001004' } })).id,
        fullName: 'Patient B',
        gender: 'FEMALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'CYCLE-TEST-B',
      },
    });

    const assessmentA = await prisma.assessment.create({
      data: { patientProfileId: patientAProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    await prisma.treatmentPlan.create({
      data: { patientProfileId: patientAProfile.id, clinicianUserId, assessmentId: assessmentA.id, goals: 'g', reviewDate: new Date() },
    });

    const assessmentB = await prisma.assessment.create({
      data: { patientProfileId: patientBProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const planB = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientBProfile.id, clinicianUserId, assessmentId: assessmentB.id, goals: 'g', reviewDate: new Date() },
    });

    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientAProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientAToken}`)
      .send({ treatmentPlanId: planB.id })
      .expect(404);
  });

  it('allows only one cycle to be created when two start requests race for the same patient', async () => {
    await registerAndLogin(app, prisma, '+966500001005', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001006', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001006' } })).id,
        fullName: 'Race Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'CYCLE-TEST-RACE',
      },
    });
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001005' } })).id;
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const sendStart = () =>
      request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ treatmentPlanId: plan.id });

    const [resA, resB] = await Promise.all([sendStart(), sendStart()]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const cycles = await prisma.trainingCycle72h.findMany({ where: { patientProfileId: patientProfile.id } });
    expect(cycles).toHaveLength(1);
  });
});
