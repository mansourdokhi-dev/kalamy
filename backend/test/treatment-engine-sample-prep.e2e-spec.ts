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

describe('Treatment Engine — Sample preparation (e2e)', () => {
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

  it('caps recording attempts at 10 and does not restore the count on delete', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002001', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002001' } })).id,
        fullName: 'Sample Prep Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'SAMPLE-PREP-TEST-1',
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

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    // fast-forward the cycle directly to SAMPLE_ELIGIBLE rather than seeding 3 real training events
    await prisma.trainingCycle72h.update({
      where: { id: startRes.body.id },
      data: { status: 'SAMPLE_ELIGIBLE' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    let lastAttemptId = '';
    for (let i = 0; i < 10; i++) {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: `https://example.com/attempt-${i}.mp4` })
        .expect(201);
      lastAttemptId = res.body.id;
    }

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(10);

    // deleting one does not free up a slot
    await request(app.getHttpServer())
      .delete(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts/${lastAttemptId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'https://example.com/attempt-11.mp4' })
      .expect(409);
  });
});
