import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Smoke test: full session progression from start to clinician-approved advance', () => {
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

  it('walks a patient from program start through a repeat and on to an approved advance', async () => {
    // 1. Seed a clinician and create the first two session templates
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Dr. Nourah Al-Shammari',
      mobile: '+966500000800',
      password: 'clinician-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000800', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500000800' }, data: { role: 'CLINICIAN' } });
    const clinicianLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000800', password: 'clinician-pass1' });
    const clinicianToken = clinicianLogin.body.token;

    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Extend a single vowel sound for 5 seconds while opening and closing your hand.',
    });
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 2,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Extend a single-syllable word for 5 seconds.',
    });

    // 2. Register a patient and build them up to an active treatment plan
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Yousef Al-Ghamdi',
      mobile: '+966500000801',
      password: 'patient-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000801', code: patientRegister.body.devOtpCode });
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000801', password: 'patient-pass1' });
    const patientToken = patientLogin.body.token;

    const profileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'Yousef Al-Ghamdi',
        gender: 'MALE',
        dateOfBirth: '1995-06-01',
        nationalId: 'SMOKE-SESSIONS-1',
      });
    const profileId = profileResponse.body.id;

    const assessmentResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentResponse.body.id}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MODERATE' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId: assessmentResponse.body.id, goals: 'Complete the 30-session program', reviewDate: '2026-12-01' });

    // 3. Patient starts the program (session 1, attempt 1)
    const startResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(startResponse.status).toBe(201);
    expect(startResponse.body.attemptNumber).toBe(1);

    // 4. Patient submits self-ratings, then (after backdating the training start) the sample
    await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/sessions/current/ratings`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ selfSeverityCurrent: 5, selfSeverityExpectedNext: 4, camperdownPerformanceRating: 5, clientOpinionScore: 6 });
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });
    const submitResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/attempt-1.mp4' });
    expect(submitResponse.status).toBe(201);
    expect(submitResponse.body.status).toBe('SUBMITTED');

    // 5. Clinician requires a repeat
    const repeatReviewResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'REPEAT', reviewNotes: 'Hand synchronization needs more practice.' });
    expect(repeatReviewResponse.status).toBe(201);
    expect(repeatReviewResponse.body.status).toBe('REPEAT_REQUIRED');

    // 6. Patient retrains and submits a second attempt
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId, status: 'IN_TRAINING' },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });
    const secondSubmitResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/attempt-2.mp4' });
    expect(secondSubmitResponse.status).toBe(201);

    // 7. Clinician approves, advancing to session 2
    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'APPROVE', reviewNotes: 'Well done.', clinicianOpinionScore: 8 });
    expect(approveResponse.status).toBe(201);
    expect(approveResponse.body.status).toBe('APPROVED');

    // 8. The patient's current attempt is now session 2, attempt 1
    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions/current`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(currentResponse.body.attemptNumber).toBe(1);

    // 9. Full history shows 3 rows: attempt 1 (repeat-required), attempt 2 (approved), session 2 attempt 1 (in training)
    const historyResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(historyResponse.body).toHaveLength(3);

    // 10. Progress dashboard reflects one approved session and one repeated session
    const progressResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/progress`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(progressResponse.body.currentSessionNumber).toBe(2);
    expect(progressResponse.body.sessionsApproved).toBe(1);
    expect(progressResponse.body.totalAttempts).toBe(3);
    expect(progressResponse.body.repeatedSessionNumbers).toEqual([1]);

    // 11. Every mutating step was audit-logged
    const auditActions = (await prisma.auditLog.findMany()).map((log) => log.action);
    expect(auditActions).toEqual(
      expect.arrayContaining([
        'POST /api/v1/patients',
        expect.stringContaining('/sessions/start'),
        expect.stringContaining('/sessions/current/submit'),
        expect.stringContaining('/sessions/current/review'),
      ]),
    );
  });
});
