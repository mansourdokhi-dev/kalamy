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

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

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
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

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
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

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

    const refreshedSample = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    // decision stays null (AC-07): TECHNICAL_RERECORD is a deferral pending
    // re-recording, not a clinical progression verdict — that's reserved for
    // an eventual real TRANSITION/LEVEL_REPEAT once the sample is complete again.
    expect(refreshedSample.decision).toBeNull();
  });

  it('rejects reviewing a cycle that is not waiting for review', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500004006', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500004007', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004007' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Review Test Patient 4',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'REVIEW-TEST-4',
      },
    });
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004006' } })).id;
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

    // Cycle left in its default status — ACTIVE_LEVEL_TRAINING, not eligible for review.
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level1.id,
        levelVersionId: level1Version.id,
        cycleNumber: 1,
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'test' })
      .expect(409);
  });

  it('rejects a damagedPartIds entry that does not belong to the sample', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500004008', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500004009', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004009' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Review Test Patient 5',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'REVIEW-TEST-5',
      },
    });
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004008' } })).id;
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
    const sample = await prisma.speechSample.create({
      data: { trainingCycleId: cycle.id, submittedAt: new Date() },
    });
    await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'مقطع', label: 'مقطع 1', order: 1, recordingUrl: 'https://example.com/part-1.mp4' },
    });

    // A part id from a completely different patient's sample — not a member of this sample's
    // parts. Uses a separate patient profile so it doesn't become this patient's "current" cycle.
    await registerAndLogin(app, prisma, '+9665000040091', null);
    const otherPatientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+9665000040091' } })).id;
    const otherPatientProfile = await prisma.patientProfile.create({
      data: {
        userId: otherPatientUserId,
        fullName: 'Review Test Patient 5b',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'REVIEW-TEST-5B',
      },
    });
    const otherAssessment = await prisma.assessment.create({
      data: { patientProfileId: otherPatientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const otherPlan = await prisma.treatmentPlan.create({
      data: { patientProfileId: otherPatientProfile.id, clinicianUserId, assessmentId: otherAssessment.id, goals: 'g', reviewDate: new Date() },
    });
    const foreignSampleCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: otherPatientProfile.id,
        treatmentPlanId: otherPlan.id,
        levelId: level1.id,
        levelVersionId: level1Version.id,
        cycleNumber: 1,
      },
    });
    const foreignSample = await prisma.speechSample.create({
      data: { trainingCycleId: foreignSampleCycle.id, submittedAt: new Date() },
    });
    const foreignPart = await prisma.sampleSamplePart.create({
      data: { speechSampleId: foreignSample.id, partType: 'مقطع', label: 'مقطع 1', order: 1, recordingUrl: 'https://example.com/other.mp4' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TECHNICAL_RERECORD', damagedPartIds: [foreignPart.id], reviewNotes: 'test' })
      .expect(404);
  });

  it('serializes concurrent review calls on the same cycle — exactly one succeeds and exactly one next-level cycle is created', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500004010', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500004011', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004011' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Review Test Patient 6',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'REVIEW-TEST-6',
      },
    });
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004010' } })).id;
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

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'concurrent-1' }),
      request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'concurrent-2' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const nextLevelCycles = await prisma.trainingCycle72h.findMany({
      where: { patientProfileId: patientProfile.id, levelId: level2.id },
    });
    expect(nextLevelCycles).toHaveLength(1);
  });

  it('rejects a review decision from a clinician who does not hold the reservation', async () => {
    const clinicianAToken = await registerAndLogin(app, prisma, '+966500004100', 'CLINICIAN');
    const clinicianBToken = await registerAndLogin(app, prisma, '+966500004101', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004100' } })).id;
    const patientToken = await registerAndLogin(app, prisma, '+966500004102', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004102' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Ownership Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'OWNERSHIP-TEST-1' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Ownership Level', order: 90001 } });
    const levelVersion = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
    });
    await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianBToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'x' })
      .expect(403);
  });

  it('accepts a review decision on a cycle waiting for the final decision after an intervention', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500004110', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004110' } })).id;
    const patientToken = await registerAndLogin(app, prisma, '+966500004111', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004111' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Post-Intervention Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'POST-INTERVENTION-TEST-1' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Post-Intervention Level', order: 90002 } });
    const levelVersion = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1, status: 'WAITING_FINAL_DECISION_AFTER_INTERVENTION' },
    });
    await prisma.speechSample.create({
      data: { trainingCycleId: cycle.id, submittedAt: new Date(), reservedByUserId: clinicianUserId, reservedAt: new Date(), reviewDeadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });

    // Regression test for a bug the coordinator caught during Task 4's own review: the
    // inner transaction's re-check must accept this status too, not just the outer guard,
    // or every decision on this status would fail with a spurious "already reviewed" 409.
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'x' })
      .expect(201);
  });

  it('notifies the patient when the specialist issues a decision', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500007000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500007001', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500007000' } })).id;
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500007001' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Notification Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'NOTIF-TEST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level1 = await prisma.level.create({ data: { name: 'Notif Level 1', order: 1 } });
    const level1Version = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const level2 = await prisma.level.create({ data: { name: 'Notif Level 2', order: 2 } });
    await prisma.levelVersion.create({
      data: { levelId: level2.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level1.id, levelVersionId: level1Version.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
    });
    await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'أداء جيد' })
      .expect(201);

    const notificationsRes = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(notificationsRes.body.some((n: any) => n.type === 'SPECIALIST_DECISION_ISSUED')).toBe(true);
  });
});
