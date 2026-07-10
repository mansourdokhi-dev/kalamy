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

describe('Treatment Engine — Sample upload (e2e)', () => {
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

  async function seedPatientReadyForSample(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id,
        fullName: 'Upload Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: `UPLOAD-TEST-${patientMobile}`,
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
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

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    await prisma.trainingCycle72h.update({ where: { id: startRes.body.id }, data: { status: 'SAMPLE_ELIGIBLE' } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    return { patientProfile, patientToken };
  }

  it('accepts an audio file upload and returns a servable URL', async () => {
    const { patientProfile, patientToken } = await seedPatientReadyForSample('+966500003000', '+966500003001');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/upload`)
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('fake-audio-bytes'), { filename: 'test.m4a', contentType: 'audio/m4a' })
      .expect(201);

    expect(res.body.url).toContain('/uploads/audio/');
    expect(res.body.url).toMatch(/\.m4a$/);
  });

  it('rejects a non-audio file with 400', async () => {
    const { patientProfile, patientToken } = await seedPatientReadyForSample('+966500003100', '+966500003101');

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/upload`)
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('not audio'), { filename: 'test.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('rejects the request with 404 when patientId does not resolve to a current cycle for this actor', async () => {
    const patientToken = await registerAndLogin(app, prisma, '+966500003201', null);

    await request(app.getHttpServer())
      .post('/api/v1/patients/00000000-0000-0000-0000-000000000000/cycles/current/sample-session/upload')
      .set('Authorization', `Bearer ${patientToken}`)
      .attach('audio', Buffer.from('fake-audio-bytes'), { filename: 'test.m4a', contentType: 'audio/m4a' })
      .expect(404);
  });
});
