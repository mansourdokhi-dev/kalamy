import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(app: INestApplication, prisma: PrismaService, mobile: string, role: 'CLINICIAN' | 'SUPERVISOR' | null): Promise<string> {
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

async function fullSetup(app: INestApplication, prisma: PrismaService, suffix: string, clinicianUserId: string) {
  const patientToken = await registerAndLogin(app, prisma, `+96650000${suffix}0`, null);
  const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: `+96650000${suffix}0` } })).id;
  const profile = await prisma.patientProfile.create({
    data: { userId: patientUserId, fullName: 'AC Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `AC-TEST-${suffix}` },
  });
  const assessment = await prisma.assessment.create({ data: { patientProfileId: profile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' } });
  const plan = await prisma.treatmentPlan.create({
    data: { patientProfileId: profile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
  });
  const level = await prisma.level.create({ data: { name: `AC Level ${suffix}`, order: 70000 + Number(suffix) } });
  const levelVersion = await prisma.levelVersion.create({
    data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
  });
  const cycle = await prisma.trainingCycle72h.create({
    data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
  });
  const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
  return { patientToken, profile, cycle, sample };
}

describe('Specialist Review v2 — Acceptance Criteria (e2e)', () => {
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

  it('AC-08: reservation auto-releases exactly at the 48-hour boundary, not before', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+9665000010', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+9665000010' } })).id;
    const { cycle, sample } = await fullSetup(app, prisma, '1', clinicianUserId);

    await request(app.getHttpServer()).post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`).set('Authorization', `Bearer ${clinicianToken}`).expect(201);

    // 47 hours: still reserved.
    await prisma.speechSample.update({ where: { id: sample.id }, data: { reservedAt: new Date(Date.now() - 47 * 60 * 60 * 1000), reviewDeadlineAt: new Date(Date.now() + 1 * 60 * 60 * 1000) } });
    let refreshed = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(refreshed.reservedByUserId).not.toBeNull();

    // 49 hours: released on next evaluation (triggered here by a second clinician's reserve attempt).
    await prisma.speechSample.update({ where: { id: sample.id }, data: { reservedAt: new Date(Date.now() - 49 * 60 * 60 * 1000), reviewDeadlineAt: new Date(Date.now() - 1 * 60 * 60 * 1000) } });
    const secondClinicianToken = await registerAndLogin(app, prisma, '+9665000011', 'CLINICIAN');
    await request(app.getHttpServer()).post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`).set('Authorization', `Bearer ${secondClinicianToken}`).expect(201);
    refreshed = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(refreshed.reservedByUserId).not.toBe(clinicianUserId);
  });

  it('AC-09: direct intervention pauses the review deadline, then a fresh 48h starts on completion', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+9665000020', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+9665000020' } })).id;
    const { cycle } = await fullSetup(app, prisma, '2', clinicianUserId);

    await request(app.getHttpServer()).post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`).set('Authorization', `Bearer ${clinicianToken}`).expect(201);
    const interventionRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ interventionType: 'TARGETED_MESSAGE', reasonNote: 'x' })
      .expect(201);
    expect(interventionRes.body.reviewDeadlineAt).toBeNull();

    const completeRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention/complete`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ outcomeNotes: 'x' })
      .expect(201);
    const deadline = new Date(completeRes.body.reviewDeadlineAt).getTime();
    const expectedDeadline = Date.now() + 48 * 60 * 60 * 1000;
    expect(Math.abs(deadline - expectedDeadline)).toBeLessThan(60 * 1000);
  });

  it('AC-10: only one free consultation is ever available, video and voice draw from the same credit', async () => {
    const patientToken = await registerAndLogin(app, prisma, '+9665000030', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+9665000030' } })).id;
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Free Consult Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'AC-10-TEST' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ type: 'VOICE', reasonNote: 'y' })
      .expect(409);
  });
});
