import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { SlaEvaluationSweepService } from '../src/modules/treatment-engine/sla-evaluation-sweep.service';

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

async function setupPatientAndPlan(app: INestApplication, prisma: PrismaService, patientMobile: string, clinicianUserId: string) {
  await registerAndLogin(app, prisma, patientMobile, null);
  const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id;
  const patientProfile = await prisma.patientProfile.create({
    data: { userId: patientUserId, fullName: 'SLA Sweep Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SLA-${Date.now()}-${Math.random()}` },
  });
  const assessment = await prisma.assessment.create({
    data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
  });
  const plan = await prisma.treatmentPlan.create({
    data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
  });
  return { patientProfile, plan };
}

async function createSubmittedSampleCycle(prisma: PrismaService, patientProfileId: string, treatmentPlanId: string) {
  const level = await prisma.level.create({ data: { name: `Level ${Date.now()}`, order: Math.floor(Math.random() * 100000) } });
  const levelVersion = await prisma.levelVersion.create({
    data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
  });
  const cycle = await prisma.trainingCycle72h.create({
    data: { patientProfileId, treatmentPlanId, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
  });
  const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
  return { cycle, sample };
}

describe('SLA evaluation sweep (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweepService: SlaEvaluationSweepService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sweepService = app.get(SlaEvaluationSweepService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('escalates a sample still unreserved after 24 hours, with no API call ever made against it', async () => {
    const supervisorToken = await registerAndLogin(app, prisma, '+966500007000', 'SUPERVISOR');
    void supervisorToken;
    const supervisorUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500007000' } })).id;
    const clinicianToken = await registerAndLogin(app, prisma, '+966500007001', 'CLINICIAN');
    void clinicianToken;
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500007001' } })).id;
    const { patientProfile, plan } = await setupPatientAndPlan(app, prisma, '+966500007002', clinicianUserId);
    const { sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id);
    await prisma.speechSample.update({ where: { id: sample.id }, data: { submittedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const updatedSample = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(updatedSample.escalatedAt).not.toBeNull();
    const notifications = await prisma.notification.findMany({ where: { recipientUserId: supervisorUserId, type: 'SAMPLE_ESCALATED_TO_SUPERVISOR' } });
    expect(notifications).toHaveLength(1);
  });

  it('auto-releases a reservation once the 48-hour decision window elapses, with no API call ever made against it', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500007010', 'CLINICIAN');
    void clinicianToken;
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500007010' } })).id;
    const { patientProfile, plan } = await setupPatientAndPlan(app, prisma, '+966500007011', clinicianUserId);
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id);
    await prisma.trainingCycle72h.update({ where: { id: cycle.id }, data: { status: 'UNDER_REVIEW' } });
    await prisma.speechSample.update({
      where: { id: sample.id },
      data: { reservedByUserId: clinicianUserId, reservedAt: new Date(), reviewDeadlineAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    await sweepService.runSweep();

    const updatedCycle = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(updatedCycle.status).toBe('WAITING_FOR_SPECIALIST');
    const updatedSample = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(updatedSample.reservedByUserId).toBeNull();
    expect(updatedSample.reviewDeadlineAt).toBeNull();
  });
});
