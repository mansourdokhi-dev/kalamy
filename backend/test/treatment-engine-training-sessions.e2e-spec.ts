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

describe('Treatment Engine — Training Sessions (e2e)', () => {
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

  async function setupActiveCycle(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id, fullName: 'Session Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-${Date.now()}-${Math.random()}` },
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

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    return { clinicianToken, patientToken, patientProfile, cycleId: startRes.body.id as string };
  }

  it('creates a new IN_PROGRESS session when none exists', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008000', '+966500008001');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.unitsCompleted).toBe(0);
  });

  it('returns the same session on a second start call (idempotent resume, proves the parallel-block)', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008002', '+966500008003');

    const first = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects starting a session before the human model has been watched', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500008004', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500008005', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008004' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008005' } })).id, fullName: 'No Model Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-NOMODEL-${Date.now()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);
  });

  it('rejects starting a new session within 1 hour of completing the previous one', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008006', '+966500008007');
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 30 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);
    expect(res.body.message).toContain('Cannot start a new training session');
  });

  it('allows starting a new session once the 1-hour interval has elapsed', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008008', '+966500008009');
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 90 * 60 * 1000) },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
  });

  it('persists progress below the threshold without completing the session', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008010', '+966500008011');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 40 })
      .expect(200);

    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.unitsCompleted).toBe(40);
  });

  it('does not let a smaller unitsCompleted decrease the stored value', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008012', '+966500008013');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 60 })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 20 })
      .expect(200);

    expect(res.body.unitsCompleted).toBe(60);
  });

  it('completes the session and creates a TrainingEvent once the threshold is reached, without making the cycle eligible on a single session', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008014', '+966500008015');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);

    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.completedAt).not.toBeNull();

    const events = await prisma.trainingEvent.findMany({ where: { trainingCycleId: cycleId } });
    expect(events).toHaveLength(1);
    expect(events[0].unitsCompleted).toBe(100);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('ACTIVE_LEVEL_TRAINING'); // one completed session alone is not the full 72h gate
  });

  it('fires SAMPLE_ELIGIBLE_FOR_RECORDING once a completed session satisfies all three 24h periods', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500008016', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500008017', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008016' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008017' } })).id, fullName: 'Eligibility Session Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-ELIGIBLE-${Date.now()}` },
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

    // Same technique already proven in the §101 notification test: seed firstTrainingEventAt
    // 73 real hours in the past, plus two raw TrainingEvent rows landing in periods 0 and 1, so
    // this test's own session-completion (period 2) is the one real transition being exercised.
    const start = new Date(Date.now() - 73 * 60 * 60 * 1000);
    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, humanModelWatchedAt: new Date(), firstTrainingEventAt: start,
      },
    });
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 1 * 60 * 60 * 1000) } });
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 25 * 60 * 60 * 1000) } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);
    expect(res.body.status).toBe('COMPLETED');

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('SAMPLE_ELIGIBLE');

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(notifications.body.find((n: { type: string }) => n.type === 'SAMPLE_ELIGIBLE_FOR_RECORDING')).toBeTruthy();
  });

  it('sets sampleEligibleAt on the cycle when a completed session transitions it to SAMPLE_ELIGIBLE', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500008020', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500008021', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008020' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008021' } })).id, fullName: 'SampleEligibleAt Session Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-SAMPLEAT-${Date.now()}` },
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

    // Same 73-hours-in-the-past seeding technique as the eligibility test above: two raw
    // TrainingEvent rows land in periods 0 and 1, so this test's session-completion (period 2)
    // is the one real transition to SAMPLE_ELIGIBLE being exercised.
    const start = new Date(Date.now() - 73 * 60 * 60 * 1000);
    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, humanModelWatchedAt: new Date(), firstTrainingEventAt: start,
      },
    });
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 1 * 60 * 60 * 1000) } });
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 25 * 60 * 60 * 1000) } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);

    const updatedCycle = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(updatedCycle.status).toBe('SAMPLE_ELIGIBLE');
    expect(updatedCycle.sampleEligibleAt).not.toBeNull();
  });

  it('returns 404 when recording progress with no in-progress session', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008018', '+966500008019');

    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 50 })
      .expect(404);
  });

  it('counts only sessions completed within the current 24h period as completedToday', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008020', '+966500008021');
    const start = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 hours ago — currently in period 1 (24h-48h)
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: start } });

    // One session completed in period 0 (hours 0-24) — should NOT count as "today" (period 1).
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(start.getTime() + 5 * 60 * 60 * 1000) },
    });
    // Two sessions completed in period 1 (24h-48h from start, i.e. the last 6 hours) — should count.
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(start.getTime() + 26 * 60 * 60 * 1000) },
    });
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.completedToday).toBe(2);
    expect(res.body.targetPerDay).toBe(7);
  });

  it('reports intervalActive and nextAvailableAt consistently with the start-session gate', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008022', '+966500008023');
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.intervalActive).toBe(true);
    expect(res.body.nextAvailableAt).not.toBeNull();
    expect(res.body.currentSessionId).toBeNull();
  });

  it('reports the in-progress session id when one exists', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008024', '+966500008025');
    const started = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.currentSessionId).toBe(started.body.id);
  });
});
