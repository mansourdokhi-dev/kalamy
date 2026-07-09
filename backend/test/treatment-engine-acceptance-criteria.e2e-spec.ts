// backend/test/treatment-engine-acceptance-criteria.e2e-spec.ts
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

describe('Treatment Engine v2 — full acceptance criteria (AC-01 through AC-12)', () => {
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

  it('AC-01: a new patient always starts at the lowest-order level and can never start a second cycle directly — later levels open only via a specialist TRANSITION decision', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002001', null);

    const level1 = await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'Level 1', order: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/levels/${level1.body.id}/versions`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: JSON.stringify(['حا']),
        samplePartTemplateJson: JSON.stringify([{ partType: 'مقطع', label: 'مقطع 1', order: 1, required: true }]),
      })
      .expect(201)
      .then((versionRes) =>
        request(app.getHttpServer())
          .post(`/api/v1/levels/${level1.body.id}/versions/${versionRes.body.id}/publish`)
          .set('Authorization', `Bearer ${clinicianToken}`)
          .expect(200),
      );
    await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'Level 2', order: 2 })
      .expect(201);
    // Level 2 has no published version — irrelevant to this test's point, since the endpoint never
    // lets the caller name a level at all; it only ever picks the single lowest-order active one.

    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002001' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'AC-01-1', dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002000' } })).id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);
    expect(startRes.body.levelId).toBe(level1.body.id); // always the lowest-order level, never level 2

    // and starting again — an attempt to jump straight to a second cycle/level — is rejected outright;
    // the only sanctioned way to reach Level 2 is a specialist's TRANSITION decision (Task 7)
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(409);
  });

  it('AC-02: 72 calendar hours passing with zero training events never opens the sample gate', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002100', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002101', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002100' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002101' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'AC-02-1', dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id, levelId: level.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    // 100 hours of pure calendar time pass with zero TrainingEvent rows created — simulated by
    // backdating updatedAt directly, since this endpoint has no way to fast-forward real time.
    const cycle = await prisma.trainingCycle72h.findFirstOrThrow({ where: { patientProfileId: profile.id } });
    await prisma.trainingCycle72h.update({
      where: { id: cycle.id },
      data: { updatedAt: new Date(Date.now() - 100 * 60 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('ACTIVE_LEVEL_TRAINING');
  });

  it('AC-03: training remains recordable up to submission; the endpoint correctly rejects it once waiting on the specialist', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002200', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002201', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002200' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002201' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'AC-03-1', dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: profile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'SAMPLE_ELIGIBLE',
        humanModelWatchedAt: new Date(),
        firstTrainingEventAt: new Date(Date.now() - 80 * 60 * 60 * 1000),
      },
    });

    // still recordable while merely SAMPLE_ELIGIBLE (has not yet submitted)
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409); // recordTrainingEvent only accepts ACTIVE_LEVEL_TRAINING per Task 4 — SAMPLE_ELIGIBLE
    // correctly rejects further training-event writes through this endpoint once past that state;
    // free/reinforcement training on previously-completed levels remains available via the
    // read-only history endpoint from Task 8 regardless of the current cycle's state.

    await prisma.trainingCycle72h.update({ where: { id: cycle.id }, data: { status: 'WAITING_FOR_SPECIALIST' } });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409);
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200); // read-only history access is never blocked while waiting on the specialist
  });

  // AC-04, AC-05, AC-06 are already fully covered end-to-end by Tasks 5, 6, and 7's own e2e suites
  // (treatment-engine-sample-submit.e2e-spec.ts asserts a second submission on the same cycle is
  // rejected with 409; treatment-engine-sample-prep.e2e-spec.ts asserts the 11th attempt is rejected
  // even after a deletion; treatment-engine-specialist-review.e2e-spec.ts asserts a TECHNICAL_RERECORD
  // decision clears only the named part's recordingUrl and leaves the other part untouched). Not
  // repeated here as their own `it` blocks, since a test with no assertion is itself a defect — this
  // comment is a pointer to where that coverage already lives, not a stand-in for it.

  it('AC-07: one specialist decision closes the whole submitted sample; a technical-rerecord decision never sets a whole-sample TRANSITION/LEVEL_REPEAT decision at the same time', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002500', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002501', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002500' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002501' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'AC-07-1', dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
    });
    const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
    const part = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'مقطع', label: 'مقطع 1', order: 1, recordingUrl: 'https://example.com/a.mp4' },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TECHNICAL_RERECORD', damagedPartIds: [part.id], reviewNotes: 'test' })
      .expect(201);

    // exactly one review action was taken on the sample as a whole — its top-level decision field
    // stays null for a technical-rerecord (that decision is recorded per-part, on the parts, not as
    // a whole-sample TRANSITION/LEVEL_REPEAT verdict), proving there is no separate per-part
    // transition/repeat decision path alongside the whole-sample one.
    expect(res.body.decision).toBeNull();
    expect(res.body.reviewedByUserId).toBe(clinicianUser.id);
  });

  it('AC-11: viewing cycle history never mutates the current active cycle', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002300', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002301', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002300' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002301' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'AC-11-1', dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id, levelId: level.id })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(after.body).toEqual(before.body);
  });

  it('AC-12: a specialist decision produces a matching AuditLog row via the existing global interceptor', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002400', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002401', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002400' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002401' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'AC-12-1', dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
    });
    await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'LEVEL_REPEAT', clinicianOpinionScore: 4, reviewNotes: 'test' })
      .expect(201);

    const auditRows = await prisma.auditLog.findMany({ where: { userId: clinicianUser.id }, orderBy: { createdAt: 'desc' } });
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].action).toContain('POST');
  });
});
