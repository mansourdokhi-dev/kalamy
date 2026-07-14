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
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);

    const currentRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(currentRes.body.status).toBe('ACTIVE_LEVEL_TRAINING'); // one completed training alone is not the full 72h gate
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

  it('includes each cycle\'s speech sample and decision in the history listing', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500001500', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001501', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001500' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001501' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'HIST-1', dateOfBirth: new Date('2000-01-01') },
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
    const closedCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: profile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'NEXT_LEVEL_APPROVED',
        closedAt: new Date(),
      },
    });
    await prisma.speechSample.create({
      data: {
        trainingCycleId: closedCycle.id,
        submittedAt: new Date(),
        reviewedByUserId: clinicianUser.id,
        reviewedAt: new Date(),
        decision: 'TRANSITION',
        reviewNotes: 'Great progress',
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const returnedClosedCycle = response.body.find((c: { id: string }) => c.id === closedCycle.id);
    expect(returnedClosedCycle.speechSample.decision).toBe('TRANSITION');
    expect(returnedClosedCycle.speechSample.reviewNotes).toBe('Great progress');
  });

  it('notifies the patient when a cycle becomes SAMPLE_ELIGIBLE via real training events', async () => {
    await registerAndLogin(app, prisma, '+966500001600', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001601', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001600' } })).id;
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001601' } });

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'Eligibility Notify Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'ELIGIBLE-NOTIFY-1' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    // firstTrainingEventAt is seeded 73 real hours in the past so that (a) "now" is
    // genuinely >= firstTrainingEventAt + 72h (the eligibility function's own gate),
    // and (b) the three seeded events below each land inside one of the three
    // 24h periods relative to that same start — exactly what isCycleEligibleForSample
    // requires. This drives the transition through the real recordTrainingEvent
    // code path (not a direct status override), so the notification call site
    // inside it actually runs.
    const start = new Date(Date.now() - 73 * 60 * 60 * 1000);
    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, humanModelWatchedAt: new Date(), firstTrainingEventAt: start,
      },
    });
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 1 * 60 * 60 * 1000) } }); // period 0
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 25 * 60 * 60 * 1000) } }); // period 1
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 50 * 60 * 60 * 1000) } }); // period 2

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('SAMPLE_ELIGIBLE');

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const found = notifications.body.find((n: { type: string }) => n.type === 'SAMPLE_ELIGIBLE_FOR_RECORDING');
    expect(found).toBeTruthy();
    expect(found.body).toContain('Level 1');
  });

  it('flags a cycle SAMPLE_SUBMISSION_DELAYED and notifies patient + supervisors when 2 days pass without submission from SAMPLE_ELIGIBLE', async () => {
    await registerAndLogin(app, prisma, '+966500001700', 'CLINICIAN');
    const supervisorToken = await registerAndLogin(app, prisma, '+966500001701', 'SUPERVISOR');
    const patientToken = await registerAndLogin(app, prisma, '+966500001702', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001700' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001702' } })).id, fullName: 'Delay Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'DELAY-TEST-1' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const sampleEligibleAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago — past the 2-day grace period
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'SAMPLE_ELIGIBLE', sampleEligibleAt,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('SAMPLE_SUBMISSION_DELAYED');

    const patientNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(patientNotifications.body.find((n: { type: string }) => n.type === 'SAMPLE_SUBMISSION_REMINDER')).toBeTruthy();

    const supervisorNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);
    const found = supervisorNotifications.body.find((n: { type: string }) => n.type === 'SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR');
    expect(found).toBeTruthy();
    expect(found.body).toContain('Level 1');
  });

  it('flags a cycle SAMPLE_SUBMISSION_DELAYED when 2 days pass from SAMPLE_PREPARATION (session opened but never submitted)', async () => {
    await registerAndLogin(app, prisma, '+966500001703', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001704', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001703' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001704' } })).id, fullName: 'Delay Test Patient 2', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'DELAY-TEST-2' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    // Seed the cycle as SAMPLE_ELIGIBLE with a FRESH sampleEligibleAt (not yet stale) —
    // opening a session immediately below must not trigger the lazy-evaluation flip
    // via the controller's own getCurrent() precheck.
    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'SAMPLE_ELIGIBLE', sampleEligibleAt: new Date(),
      },
    });

    // Open the session through the REAL endpoint (not seeded directly into
    // SAMPLE_PREPARATION via prisma) — this exercises the actual openSession code
    // path, which must preserve sampleEligibleAt when opening from SAMPLE_ELIGIBLE.
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const opened = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(opened.status).toBe('SAMPLE_PREPARATION');
    expect(opened.sampleEligibleAt).not.toBeNull();

    // Now simulate 2+ days passing since the (preserved) sampleEligibleAt timestamp —
    // there's no way to literally wait 2 days in a test, so we backdate the clock the
    // same way the other tests in this file do, but only AFTER driving the real
    // SAMPLE_ELIGIBLE -> SAMPLE_PREPARATION transition through openSession.
    await prisma.trainingCycle72h.update({
      where: { id: cycle.id },
      data: { sampleEligibleAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('SAMPLE_SUBMISSION_DELAYED');
  });

  it('does not flag a cycle as delayed if sampleEligibleAt is less than 2 days old', async () => {
    await registerAndLogin(app, prisma, '+966500001705', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001706', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001705' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001706' } })).id, fullName: 'Not Delayed Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'DELAY-TEST-3' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const sampleEligibleAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // only 1 day ago — inside the grace period
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'SAMPLE_ELIGIBLE', sampleEligibleAt,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('SAMPLE_ELIGIBLE');
  });

  it('does not create duplicate notifications on a second read after already being flagged delayed', async () => {
    await registerAndLogin(app, prisma, '+966500001707', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500001708', 'SUPERVISOR');
    const patientToken = await registerAndLogin(app, prisma, '+966500001709', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001707' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001709' } })).id, fullName: 'Idempotent Delay Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'DELAY-TEST-4' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const sampleEligibleAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'SAMPLE_ELIGIBLE', sampleEligibleAt,
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const patientNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const reminders = patientNotifications.body.filter((n: { type: string }) => n.type === 'SAMPLE_SUBMISSION_REMINDER');
    expect(reminders).toHaveLength(1);
  });
});
