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

describe('Treatment Engine — Specialist review (e2e)', () => {
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

  it('transition decision opens the next level without starting its 72-hour clock yet', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500004000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500004001', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004000' } })).id;
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004001' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Review Test Patient 1',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'REVIEW-TEST-1',
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
    const level2 = await prisma.level.create({ data: { name: 'Level 2', order: 2 } });
    await prisma.levelVersion.create({
      data: {
        levelId: level2.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level1.id,
        levelVersionId: level1Version.id,
        cycleNumber: 1,
        status: 'WAITING_FOR_SPECIALIST',
      },
    });
    await prisma.speechSample.create({
      data: { trainingCycleId: cycle.id, submittedAt: new Date() },
    });

    const reviewRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'أداء جيد' })
      .expect(201);

    expect(reviewRes.body.decision).toBe('TRANSITION');

    const nextCycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(nextCycleRes.body.levelId).toBe(level2.id);
    expect(nextCycleRes.body.status).toBe('ACTIVE_LEVEL_TRAINING');
    expect(nextCycleRes.body.firstTrainingEventAt).toBeNull(); // clock has not started — must watch the model and train first
  });

  it('level-repeat decision creates a new cycle for the same level, preserving the old one', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500004002', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500004003', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004002' } })).id;
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004003' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Review Test Patient 2',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'REVIEW-TEST-2',
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

    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level1.id,
        levelVersionId: level1Version.id,
        cycleNumber: 1,
        status: 'WAITING_FOR_SPECIALIST',
      },
    });
    await prisma.speechSample.create({
      data: { trainingCycleId: cycle.id, submittedAt: new Date() },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'LEVEL_REPEAT', clinicianOpinionScore: 3, reviewNotes: 'يحتاج مزيدًا من التدريب' })
      .expect(201);

    const cycles = await prisma.trainingCycle72h.findMany({ where: { patientProfileId: patientProfile.id, levelId: level1.id } });
    expect(cycles).toHaveLength(2); // old cycle preserved, new one created
    expect(cycles.map((c) => c.cycleNumber).sort()).toEqual([1, 2]);

    // patientToken is used only to keep symmetry with the other cases and confirm access still works
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
  });

  it('technical-rerecord decision reopens only the affected parts, not the whole sample or cycle', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500004004', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500004005', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004004' } })).id;
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004005' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Review Test Patient 3',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'REVIEW-TEST-3',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });

    const level3 = await prisma.level.create({ data: { name: 'Level 3', order: 3 } });
    const level3Version = await prisma.levelVersion.create({
      data: {
        levelId: level3.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level3.id,
        levelVersionId: level3Version.id,
        cycleNumber: 1,
        status: 'WAITING_FOR_SPECIALIST',
      },
    });
    const sample = await prisma.speechSample.create({
      data: { trainingCycleId: cycle.id, submittedAt: new Date() },
    });
    const part1 = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'مقطع', label: 'مقطع 1', order: 1, recordingUrl: 'https://example.com/part-1.mp4' },
    });
    const part2 = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'كلمة', label: 'كلمة 1', order: 2, recordingUrl: 'https://example.com/part-2.mp4' },
    });
    const partId1 = part1.id;
    const partId2 = part2.id;

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TECHNICAL_RERECORD', damagedPartIds: [partId1], reviewNotes: 'انقطاع في الصوت' })
      .expect(201);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('TECHNICAL_PARTIAL_RERECORD');

    const refreshedPart1 = await prisma.sampleSamplePart.findUniqueOrThrow({ where: { id: partId1 } });
    const refreshedPart2 = await prisma.sampleSamplePart.findUniqueOrThrow({ where: { id: partId2 } });
    expect(refreshedPart1.technicallyDamaged).toBe(true);
    expect(refreshedPart1.recordingUrl).toBeNull(); // cleared, must be re-recorded
    expect(refreshedPart2.technicallyDamaged).toBe(false);
    expect(refreshedPart2.recordingUrl).not.toBeNull(); // untouched — the rule this whole decision exists to enforce (AC-06)

    // no new cycle was created for a technical issue
    const cyclesForThisLevel = await prisma.trainingCycle72h.findMany({ where: { patientProfileId: patientProfile.id, levelId: level3.id } });
    expect(cyclesForThisLevel).toHaveLength(1);
  });
});
