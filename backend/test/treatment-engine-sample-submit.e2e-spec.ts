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

describe('Treatment Engine — Sample submission (e2e)', () => {
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

  it('assembles one integrated sample from chosen attempts and enforces one active sample per cycle', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003001', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003001' } })).id,
        fullName: 'Sample Submit Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'SAMPLE-SUBMIT-TEST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003000' } })).id,
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

    await prisma.trainingCycle72h.update({
      where: { id: startRes.body.id },
      data: { status: 'SAMPLE_ELIGIBLE' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const attempt1 = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'attempt-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800, durationSeconds: 12 })
      .expect(201);
    const attempt2 = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'attempt-2.mp4', mimeType: 'video/mp4', fileSizeBytes: 307200, durationSeconds: 18 })
      .expect(201);
    const attempt1Id = attempt1.body.id;
    const attempt2Id = attempt2.body.id;

    const submitRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        parts: [
          { partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: attempt1Id },
          { partType: 'كلمة', label: 'كلمة 1', order: 2, sourceAttemptId: attempt2Id },
        ],
        selfSeverityCurrent: 5,
        selfSeverityExpectedNext: 6,
        camperdownPerformanceRating: 7,
        clientOpinionScore: 6,
      })
      .expect(201);

    expect(submitRes.body.parts).toHaveLength(2);
    expect(submitRes.body.parts[0].mimeType).toBe('video/mp4');
    expect(submitRes.body.parts[0].fileSizeBytes).toBeGreaterThan(0);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('WAITING_FOR_SPECIALIST');

    // submitting again on the same cycle must fail — AC-04, at most one active sample per cycle
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        parts: [{ partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: attempt1Id }],
        selfSeverityCurrent: 1,
        selfSeverityExpectedNext: 1,
        camperdownPerformanceRating: 1,
        clientOpinionScore: 1,
      })
      .expect(409);
  });

  it('serializes concurrent submits for the same cycle — exactly one succeeds, no orphaned SpeechSample', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003002', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003003', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003003' } })).id,
        fullName: 'Sample Submit Race Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'SAMPLE-SUBMIT-TEST-2',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003002' } })).id,
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

    await prisma.trainingCycle72h.update({
      where: { id: startRes.body.id },
      data: { status: 'SAMPLE_ELIGIBLE' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const attempt1 = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'race-attempt-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800, durationSeconds: 12 })
      .expect(201);
    const attempt2 = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'race-attempt-2.mp4', mimeType: 'video/mp4', fileSizeBytes: 307200, durationSeconds: 18 })
      .expect(201);
    const attempt1Id = attempt1.body.id;
    const attempt2Id = attempt2.body.id;

    const submitPayload = {
      parts: [
        { partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: attempt1Id },
        { partType: 'كلمة', label: 'كلمة 1', order: 2, sourceAttemptId: attempt2Id },
      ],
      selfSeverityCurrent: 5,
      selfSeverityExpectedNext: 6,
      camperdownPerformanceRating: 7,
      clientOpinionScore: 6,
    };

    // Fire 2 concurrent submits for the same cycle. This is the regression
    // test for the TOCTOU race in submitSample — without the row lock, both
    // requests can read status === SAMPLE_PREPARATION before either writes,
    // so both pass the initial guard. The first speechSample.create succeeds;
    // the second used to hit the DB's unique constraint on
    // SpeechSample.trainingCycleId and surface as a raw 500 instead of a
    // clean 409, and could leave the cycle permanently stuck.
    const results = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/submit`)
          .set('Authorization', `Bearer ${patientToken}`)
          .send(submitPayload),
      ),
    );

    const successCount = results.filter((r) => r.status === 201).length;
    const conflictCount = results.filter((r) => r.status === 409).length;
    expect(successCount).toBe(1);
    expect(conflictCount).toBe(1);

    const sampleCount = await prisma.speechSample.count({ where: { trainingCycleId: startRes.body.id } });
    expect(sampleCount).toBe(1);
  });

  it('notifies CLINICIAN role (not ADMIN) when a sample is submitted', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003004', 'CLINICIAN');
    const adminToken = await registerAndLogin(app, prisma, '+966500003005', 'ADMIN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003006', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003006' } })).id,
        fullName: 'Sample Notify Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'SAMPLE-SUBMIT-NOTIFY-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003004' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
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

    const attempt1 = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'notify-attempt-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800, durationSeconds: 12 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        parts: [{ partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: attempt1.body.id }],
        selfSeverityCurrent: 5,
        selfSeverityExpectedNext: 6,
        camperdownPerformanceRating: 7,
        clientOpinionScore: 6,
      })
      .expect(201);

    const clinicianNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);
    const clinicianFound = clinicianNotifications.body.find((n: { type: string }) => n.type === 'SAMPLE_AVAILABLE_FOR_REVIEW');
    expect(clinicianFound).toBeTruthy();
    expect(clinicianFound.body).toContain('Level 1');

    const adminNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminNotifications.body.find((n: { type: string }) => n.type === 'SAMPLE_AVAILABLE_FOR_REVIEW')).toBeUndefined();
  });

  it('allows opening a sample session from SAMPLE_SUBMISSION_DELAYED (never opened one before being flagged)', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003007', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003008', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003008' } })).id,
        fullName: 'Delayed Open Session Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'DELAYED-OPEN-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003007' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    await prisma.trainingCycle72h.update({ where: { id: startRes.body.id }, data: { status: 'SAMPLE_SUBMISSION_DELAYED' } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('SAMPLE_PREPARATION');
  });

  it('allows submitting a sample from SAMPLE_SUBMISSION_DELAYED (session was already open before being flagged)', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003009', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003010', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003010' } })).id,
        fullName: 'Delayed Submit Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'DELAYED-SUBMIT-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003009' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
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

    const attempt1 = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'delayed-attempt-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800, durationSeconds: 12 })
      .expect(201);

    // Session is open (SAMPLE_PREPARATION); simulate the lazy-evaluation flag having fired.
    await prisma.trainingCycle72h.update({ where: { id: startRes.body.id }, data: { status: 'SAMPLE_SUBMISSION_DELAYED' } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        parts: [{ partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: attempt1.body.id }],
        selfSeverityCurrent: 5,
        selfSeverityExpectedNext: 6,
        camperdownPerformanceRating: 7,
        clientOpinionScore: 6,
      })
      .expect(201);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('WAITING_FOR_SPECIALIST');
  });

  it('does not re-flip to SAMPLE_SUBMISSION_DELAYED after the patient opens a session from that status (real lazy-flip trigger)', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003011', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003012', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003012' } })).id,
        fullName: 'Delayed Reflip Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'DELAYED-REFLIP-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003011' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    // Genuinely stale sampleEligibleAt (more than the 2-day grace period ago) and
    // status SAMPLE_ELIGIBLE — this is the real precondition for the lazy flip in
    // TrainingCyclesService.getCurrent, unlike the other tests in this file which
    // jam the cycle straight into SAMPLE_SUBMISSION_DELAYED without a real timestamp.
    const staleSampleEligibleAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.trainingCycle72h.update({
      where: { id: startRes.body.id },
      data: { status: 'SAMPLE_ELIGIBLE', sampleEligibleAt: staleSampleEligibleAt },
    });

    // (b) First GET actually triggers the real lazy-evaluation flip to SAMPLE_SUBMISSION_DELAYED.
    const firstCycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(firstCycleRes.body.status).toBe('SAMPLE_SUBMISSION_DELAYED');

    // (c) Patient opens a session — allowed now that the guard is widened.
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    // (d) A second GET must NOT re-flip back to SAMPLE_SUBMISSION_DELAYED — the
    // stale sampleEligibleAt must have been cleared by openSession.
    const secondCycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(secondCycleRes.body.status).toBe('SAMPLE_PREPARATION');
  });
});
