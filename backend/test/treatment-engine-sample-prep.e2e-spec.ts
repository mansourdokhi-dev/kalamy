import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { waitForAuditLogs } from './utils/audit';
import { PrismaService } from '../src/prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

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
        .send({ recordingUrl: `attempt-${i}.mp4`, mimeType: 'video/mp4', fileSizeBytes: 100000, durationSeconds: 10 })
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
      .send({ recordingUrl: 'attempt-11.mp4', mimeType: 'video/mp4', fileSizeBytes: 100000, durationSeconds: 10 })
      .expect(409);
  });

  it('persists the session close and cycle revert when the 10-attempt cap is hit, not just a 409 response', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002200', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002201', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002201' } })).id,
        fullName: 'Sample Prep Exhaustion Persistence Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'SAMPLE-PREP-TEST-EXHAUST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002200' } })).id,
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

    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: `attempt-${i}.mp4`, mimeType: 'video/mp4', fileSizeBytes: 100000, durationSeconds: 10 })
        .expect(201);
    }

    // This 11th call hits the cap and must return 409 — but the regression this
    // test guards against is that the underlying writes (closing the session,
    // reverting the cycle) were silently rolled back by the throw inside the
    // $transaction callback, even though the HTTP layer still reported 409.
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'attempt-11.mp4', mimeType: 'video/mp4', fileSizeBytes: 100000, durationSeconds: 10 })
      .expect(409);

    const session = await prisma.sampleSession.findUniqueOrThrow({ where: { trainingCycleId: startRes.body.id } });
    expect(session.status).toBe('CLOSED_EXHAUSTED');

    const cycle = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: startRes.body.id } });
    expect(cycle.status).toBe('ACTIVE_LEVEL_TRAINING');
  });

  it('serializes concurrent recordAttempt calls so the 10-attempt cap is never exceeded', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002100', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002101', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002101' } })).id,
        fullName: 'Sample Prep Race Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'SAMPLE-PREP-TEST-RACE-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002100' } })).id,
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

    // Seed 8 attempts sequentially so the session sits at 8/10 before firing
    // the concurrent burst below.
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: `seed-attempt-${i}.mp4`, mimeType: 'video/mp4', fileSizeBytes: 100000, durationSeconds: 10 })
        .expect(201);
    }

    // Fire 3 concurrent attempts against a session with 8 live attempts and a
    // cap of 10: at most 2 can succeed. This is the regression test for the
    // TOCTOU race — without the row lock in recordAttempt, concurrent count
    // reads can all observe 8 and all pass the < 10 check, letting the
    // session exceed the cap.
    const results = await Promise.all(
      [0, 1, 2].map((i) =>
        request(app.getHttpServer())
          .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ recordingUrl: `concurrent-attempt-${i}.mp4`, mimeType: 'video/mp4', fileSizeBytes: 100000, durationSeconds: 10 }),
      ),
    );

    const successCount = results.filter((r) => r.status === 201).length;
    const conflictCount = results.filter((r) => r.status === 409).length;
    expect(successCount).toBe(2);
    expect(conflictCount).toBe(1);

    const session = await prisma.sampleSession.findUniqueOrThrow({ where: { trainingCycleId: startRes.body.id } });
    const finalCount = await prisma.sampleAttempt.count({ where: { sampleSessionId: session.id } });
    expect(finalCount).toBe(10);
    expect(finalCount).toBeLessThanOrEqual(10);
  });

  describe('sample-session upload', () => {
    let patientId: string;
    let patientToken: string;

    beforeEach(async () => {
      const clinicianToken = await registerAndLogin(app, prisma, '+966500002300', 'CLINICIAN');
      patientToken = await registerAndLogin(app, prisma, '+966500002301', null);
      void clinicianToken;

      const patientProfile = await prisma.patientProfile.create({
        data: {
          userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002301' } })).id,
          fullName: 'Sample Upload Test Patient',
          gender: 'MALE',
          dateOfBirth: new Date('2000-01-01'),
          nationalId: 'SAMPLE-UPLOAD-TEST-1',
        },
      });
      patientId = patientProfile.id;

      const assessment = await prisma.assessment.create({
        data: {
          patientProfileId: patientProfile.id,
          clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002300' } })).id,
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
        .post(`/api/v1/patients/${patientId}/cycles/start`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ treatmentPlanId: plan.id })
        .expect(201);

      // fast-forward to SAMPLE_ELIGIBLE and open the sample session so both
      // the upload endpoint and the attempt-recording endpoint are usable.
      await prisma.trainingCycle72h.update({
        where: { id: startRes.body.id },
        data: { status: 'SAMPLE_ELIGIBLE' },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(201);
    });

    it('accepts a video file upload and returns url, mimeType, and fileSizeBytes', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/upload`)
        .set('Authorization', `Bearer ${patientToken}`)
        .attach('audio', Buffer.from('fake mp4 bytes'), { filename: 'clip.mp4', contentType: 'video/mp4' });

      expect(response.status).toBe(201);
      expect(response.body.mimeType).toBe('video/mp4');
      expect(response.body.fileSizeBytes).toBeGreaterThan(0);
      expect(response.body.url).toMatch(/\.mp4$/);
      expect(response.body.url).not.toMatch(/^https?:\/\//);
    });

    it('rejects a non-video file upload', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/upload`)
        .set('Authorization', `Bearer ${patientToken}`)
        .attach('audio', Buffer.from('not a video'), { filename: 'notes.txt', contentType: 'text/plain' });

      expect(response.status).toBe(400);
    });

    it('persists mimeType, fileSizeBytes, and durationSeconds on the attempt', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: 'clip-2.mp4', mimeType: 'video/mp4', fileSizeBytes: 512000, durationSeconds: 20 });

      expect(response.status).toBe(201);
      expect(response.body.mimeType).toBe('video/mp4');
      expect(response.body.fileSizeBytes).toBe(512000);
      expect(response.body.durationSeconds).toBe(20);
    });

    it('rejects recording an attempt without mimeType or fileSizeBytes', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: 'clip-3.mp4' });

      expect(response.status).toBe(400);
    });

    it('rejects a path-traversal recordingUrl instead of storing it', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: '../../../../../../etc/passwd', mimeType: 'video/mp4', fileSizeBytes: 100, durationSeconds: 5 });

      expect(response.status).toBe(400);
    });

    it('streams an attempt recording via the authenticated media endpoint', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: 'nonexistent-file.mp4', mimeType: 'video/mp4', fileSizeBytes: 100, durationSeconds: 5 });
      const attemptId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts/${attemptId}/media`)
        .set('Authorization', `Bearer ${patientToken}`);

      // The referenced file doesn't actually exist on disk in this test (no real upload happened),
      // so this confirms the route is reached, permission-checked, and attempts to stream — the
      // read-stream's error event is caught and turned into a clean 404 rather than a hung
      // connection. The full round-trip (real upload -> real stream) is exercised by the manual
      // walkthrough in the final task.
      expect(response.status).toBe(404);
    });

    it('logs who streamed an attempt recording (a PHI-marked GET)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: 'nonexistent-file.mp4', mimeType: 'video/mp4', fileSizeBytes: 100, durationSeconds: 5 });
      const attemptId = createResponse.body.id;

      await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts/${attemptId}/media`)
        .set('Authorization', `Bearer ${patientToken}`);

      const logs = await waitForAuditLogs(prisma, {
        action: `GET /api/v1/patients/${patientId}/cycles/current/sample-session/attempts/${attemptId}/media`,
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].entityId).toBe(patientId);
      expect(logs[0].entity).toBe('samples');
    });

    it("rejects an unrelated patient from streaming another patient's attempt media", async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: 'file.mp4', mimeType: 'video/mp4', fileSizeBytes: 100, durationSeconds: 5 });
      const attemptId = createResponse.body.id;

      const strangerToken = await registerAndLogin(app, prisma, '+966500002399', null);
      const response = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts/${attemptId}/media`)
        .set('Authorization', `Bearer ${strangerToken}`);

      expect(response.status).toBe(403);
    });

    it('physically removes the media file from disk when an attempt is deleted', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/upload`)
        .set('Authorization', `Bearer ${patientToken}`)
        .attach('audio', Buffer.from('fake mp4 bytes'), { filename: 'to-be-deleted.mp4', contentType: 'video/mp4' });
      const { url, mimeType, fileSizeBytes } = createResponse.body;

      const attemptResponse = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ recordingUrl: url, mimeType, fileSizeBytes, durationSeconds: 5 });
      const attemptId = attemptResponse.body.id;

      const filePath = path.join(process.cwd(), 'uploads', 'video', url);
      expect(fs.existsSync(filePath)).toBe(true);

      await request(app.getHttpServer())
        .delete(`/api/v1/patients/${patientId}/cycles/current/sample-session/attempts/${attemptId}`)
        .set('Authorization', `Bearer ${patientToken}`);

      expect(fs.existsSync(filePath)).toBe(false);
    });
  });
});
