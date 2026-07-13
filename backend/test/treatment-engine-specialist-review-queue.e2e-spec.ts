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

async function createSubmittedSampleCycle(prisma: PrismaService, patientProfileId: string, treatmentPlanId: string, clinicianUserId: string) {
  const level = await prisma.level.create({ data: { name: `Level ${Date.now()}`, order: Math.floor(Math.random() * 100000) } });
  const levelVersion = await prisma.levelVersion.create({
    data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
  });
  const cycle = await prisma.trainingCycle72h.create({
    data: {
      patientProfileId,
      treatmentPlanId,
      levelId: level.id,
      levelVersionId: levelVersion.id,
      cycleNumber: 1,
      status: 'WAITING_FOR_SPECIALIST',
    },
  });
  const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
  return { cycle, sample };
}

describe('Treatment Engine — Specialist review queue (e2e)', () => {
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

  async function setupPatientAndPlan(prisma: PrismaService, patientMobile: string, clinicianUserId: string) {
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Queue Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `QUEUE-${Date.now()}-${Math.random()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    return { patientToken, patientProfile, plan };
  }

  it('lists a submitted sample as available to any clinician, with no pre-assignment', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005000', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005000' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005001', clinicianUserId);
    const { cycle } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);

    const res = await request(app.getHttpServer())
      .get('/api/v1/specialist-review/available-samples')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    expect(res.body.map((c: any) => c.id)).toContain(cycle.id);
  });

  it('escalates a sample still unreserved after 24 hours', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005010', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005010' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005011', clinicianUserId);
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);
    await prisma.speechSample.update({ where: { id: sample.id }, data: { submittedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    const res = await request(app.getHttpServer())
      .get('/api/v1/specialist-review/available-samples')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    const entry = res.body.find((c: any) => c.id === cycle.id);
    expect(entry.speechSample.escalatedAt).not.toBeNull();
  });

  it('reserves a sample for the first clinician to open it, and blocks a second', async () => {
    const clinicianAToken = await registerAndLogin(app, prisma, '+966500005020', 'CLINICIAN');
    const clinicianBToken = await registerAndLogin(app, prisma, '+966500005021', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005020' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005022', clinicianUserId);
    const { cycle } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);

    const reserveRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .expect(201);
    expect(reserveRes.body.reservedByUserId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianBToken}`)
      .expect(409);

    const afterReserve = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(afterReserve.status).toBe('UNDER_REVIEW');
  });
});
