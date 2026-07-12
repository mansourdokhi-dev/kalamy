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
  await request(app.getHttpServer()).post('/api/v1/auth/verify').send({ mobile, code: register.body.devOtpCode });
  if (role) {
    await prisma.user.update({ where: { mobile }, data: { role } });
  }
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  return login.body.token;
}

describe('Treatment Engine — Resubmit after technical re-record (e2e)', () => {
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

  it('lets a patient re-record only the damaged parts and resubmits the same sample for specialist review', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003001', null);
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003001' } });
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003000' } });

    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'RR-1', dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '["a"]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1, status: 'TECHNICAL_PARTIAL_RERECORD' },
    });
    const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
    const damagedPart = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'مقطع', label: 'مقطع 1', order: 1, technicallyDamaged: true, recordingUrl: null },
    });
    const untouchedPart = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'كلمة', label: 'كلمة 1', order: 2, technicallyDamaged: false, recordingUrl: 'https://example.com/untouched.mp4' },
    });

    const rerecordRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/sample-session/rerecord`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ parts: [{ id: damagedPart.id, recordingUrl: 'clip-4.mp4', mimeType: 'video/mp4', fileSizeBytes: 300000, durationSeconds: 15 }] })
      .expect(201);
    expect(rerecordRes.body.parts.find((p: any) => p.id === damagedPart.id).mimeType).toBe('video/mp4');

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('WAITING_FOR_SPECIALIST');

    const fixedPart = await prisma.sampleSamplePart.findUniqueOrThrow({ where: { id: damagedPart.id } });
    expect(fixedPart.technicallyDamaged).toBe(false);
    expect(fixedPart.recordingUrl).toBe('clip-4.mp4');
    expect(fixedPart.mimeType).toBe('video/mp4');
    expect(fixedPart.fileSizeBytes).toBe(300000);
    expect(fixedPart.durationSeconds).toBe(15);
    const stillUntouchedPart = await prisma.sampleSamplePart.findUniqueOrThrow({ where: { id: untouchedPart.id } });
    expect(stillUntouchedPart.recordingUrl).toBe('https://example.com/untouched.mp4');

    // now the specialist can review the corrected sample like any other WAITING_FOR_SPECIALIST cycle
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 7, reviewNotes: 'ok now' })
      .expect(201);
  });

  it('rejects resubmitting when not every currently-damaged part is included', async () => {
    const patientToken = await registerAndLogin(app, prisma, '+966500003002', null);
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003002' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'RR-2', dateOfBirth: new Date('2000-01-01') },
    });
    const plan = await prisma.treatmentPlan.create({
      data: {
        patientProfileId: profile.id,
        clinicianUserId: (await prisma.user.create({ data: { fullName: 'c', mobile: '+966500003003', passwordHash: 'x', role: 'CLINICIAN', status: 'ACTIVE' } })).id,
        assessmentId: (
          await prisma.assessment.create({
            data: {
              patientProfileId: profile.id,
              clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003003' } })).id,
              type: 'INITIAL',
              status: 'APPROVED',
            },
          })
        ).id,
        goals: 'g',
        reviewDate: new Date(),
      },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '["a"]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1, status: 'TECHNICAL_PARTIAL_RERECORD' },
    });
    const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
    const part1 = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'مقطع', label: 'مقطع 1', order: 1, technicallyDamaged: true, recordingUrl: null },
    });
    await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'كلمة', label: 'كلمة 1', order: 2, technicallyDamaged: true, recordingUrl: null },
    });

    // only re-records part1, leaves the second damaged part unaddressed
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/sample-session/rerecord`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ parts: [{ id: part1.id, recordingUrl: 'fixed.mp4', mimeType: 'video/mp4', fileSizeBytes: 300000, durationSeconds: 15 }] })
      .expect(409);
  });

  it('rejects submitting a part that is not currently damaged', async () => {
    const patientToken = await registerAndLogin(app, prisma, '+966500003004', null);
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003004' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'RR-3', dateOfBirth: new Date('2000-01-01') },
    });
    const plan = await prisma.treatmentPlan.create({
      data: {
        patientProfileId: profile.id,
        clinicianUserId: (await prisma.user.create({ data: { fullName: 'c2', mobile: '+966500003005', passwordHash: 'x', role: 'CLINICIAN', status: 'ACTIVE' } })).id,
        assessmentId: (
          await prisma.assessment.create({
            data: {
              patientProfileId: profile.id,
              clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003005' } })).id,
              type: 'INITIAL',
              status: 'APPROVED',
            },
          })
        ).id,
        goals: 'g',
        reviewDate: new Date(),
      },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '["a"]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1, status: 'TECHNICAL_PARTIAL_RERECORD' },
    });
    const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
    const damagedPart = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'مقطع', label: 'مقطع 1', order: 1, technicallyDamaged: true, recordingUrl: null },
    });
    const alreadyFinePart = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'كلمة', label: 'كلمة 1', order: 2, technicallyDamaged: false, recordingUrl: 'https://example.com/fine.mp4' },
    });

    // tries to re-record both the damaged part and the already-fine part
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/sample-session/rerecord`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        parts: [
          { id: damagedPart.id, recordingUrl: 'fixed.mp4', mimeType: 'video/mp4', fileSizeBytes: 300000, durationSeconds: 15 },
          { id: alreadyFinePart.id, recordingUrl: 'fine-override.mp4', mimeType: 'video/mp4', fileSizeBytes: 300000, durationSeconds: 15 },
        ],
      })
      .expect(404);
  });
});
