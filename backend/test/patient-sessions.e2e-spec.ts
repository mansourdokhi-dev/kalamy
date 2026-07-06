import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Patient Sessions: start the program', () => {
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

  async function createClinicianToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'CLINICIAN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  async function setUpPatientWithActivePlan(clinicianToken: string, patientMobile: string, nationalId: string) {
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Session Test Patient',
      mobile: patientMobile,
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: patientMobile, code: patientRegister.body.devOtpCode });
    const profileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'Session Test Patient',
        gender: 'MALE',
        dateOfBirth: '1990-01-01',
        nationalId,
      });
    const assessmentResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/assessments/${assessmentResponse.body.id}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MODERATE' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId: assessmentResponse.body.id, goals: 'Complete the 30-session program', reviewDate: '2026-12-01' });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: patientMobile, password: 'password123' });
    return { profileId: profileResponse.body.id, patientToken: loginResponse.body.token };
  }

  it('lets a PATIENT start the program when session 1 template exists and their plan is active', async () => {
    const clinicianToken = await createClinicianToken('+966500000700', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000701', 'SES-TEST-1');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(201);
    expect(response.body.attemptNumber).toBe(1);
    expect(response.body.status).toBe('IN_TRAINING');
  });

  it('rejects starting the program without an active treatment plan', async () => {
    const clinicianToken = await createClinicianToken('+966500000702', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'No Plan Patient',
      mobile: '+966500000703',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000703', code: patientRegister.body.devOtpCode });
    const profileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'No Plan Patient',
        gender: 'MALE',
        dateOfBirth: '1990-01-01',
        nationalId: 'SES-TEST-2',
      });
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000703', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/sessions/start`)
      .set('Authorization', `Bearer ${patientLogin.body.token}`);

    expect(response.status).toBe(400);
  });

  it('rejects starting the program a second time', async () => {
    const clinicianToken = await createClinicianToken('+966500000704', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000705', 'SES-TEST-3');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(409);
  });

  it('rejects an unrelated PATIENT starting another patient\'s program', async () => {
    const clinicianToken = await createClinicianToken('+966500000706', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId } = await setUpPatientWithActivePlan(clinicianToken, '+966500000707', 'SES-TEST-4');
    const otherPatientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500000708',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000708', code: otherPatientRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000708', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });

  it('lets a PATIENT submit self-ratings while in training', async () => {
    const clinicianToken = await createClinicianToken('+966500000710', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000711', 'SES-TEST-5');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/sessions/current/ratings`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ selfSeverityCurrent: 4, selfSeverityExpectedNext: 3, camperdownPerformanceRating: 6, clientOpinionScore: 7 });

    expect(response.status).toBe(200);
    expect(response.body.selfSeverityCurrent).toBe(4);
    expect(response.body.camperdownPerformanceRating).toBe(6);
  });

  it('rejects submitting ratings when no session has been started', async () => {
    const clinicianToken = await createClinicianToken('+966500000712', 'password123');
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000713', 'SES-TEST-6');

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/sessions/current/ratings`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ selfSeverityCurrent: 2 });

    expect(response.status).toBe(404);
  });

  it('rejects submitting the sample before the training duration has elapsed', async () => {
    const clinicianToken = await createClinicianToken('+966500000720', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000721', 'SES-TEST-7');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/sample.mp4' });

    expect(response.status).toBe(400);
  });

  it('lets a PATIENT submit the sample once the training duration has elapsed', async () => {
    const clinicianToken = await createClinicianToken('+966500000722', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000723', 'SES-TEST-8');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    // Backdate trainingStartedAt so the 3-day requirement has already elapsed.
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/sample.mp4' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('SUBMITTED');
    expect(response.body.sampleVideoUrl).toBe('https://example.com/sample.mp4');
  });

  async function startAndSubmitSample(clinicianToken: string, profileId: string, patientToken: string) {
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/sample.mp4' });
  }

  it('advances the patient to session 2 when the clinician approves', async () => {
    const clinicianToken = await createClinicianToken('+966500000730', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 2,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 2 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000731', 'SES-TEST-9');
    await startAndSubmitSample(clinicianToken, profileId, patientToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'APPROVE', reviewNotes: 'Good progress.', clinicianOpinionScore: 8 });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('APPROVED');

    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions/current`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(currentResponse.body.status).toBe('IN_TRAINING');
    expect(currentResponse.body.attemptNumber).toBe(1);
  });

  it('does not create a session 31 phantom attempt when the clinician approves session 30', async () => {
    const clinicianToken = await createClinicianToken('+966500000738', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const session30Template = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        sessionNumber: 30,
        category: 11,
        trainingDurationDays: 7,
        instructions: 'Session 30 instructions.',
      });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000739', 'SES-TEST-13');

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    // Point the patient's current attempt at session 30 instead of session 1, and backdate
    // trainingStartedAt so the 7-day requirement has already elapsed.
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId },
      data: {
        sessionTemplateId: session30Template.body.id,
        trainingStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    });

    const submitResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/sample.mp4' });
    expect(submitResponse.status).toBe(201);

    const reviewResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'APPROVE', reviewNotes: 'Program complete.', clinicianOpinionScore: 9 });

    expect(reviewResponse.status).toBe(201);
    expect(reviewResponse.body.status).toBe('APPROVED');

    const allSessions = await prisma.patientSession.findMany({ where: { patientProfileId: profileId } });
    expect(allSessions).toHaveLength(1);

    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions/current`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(currentResponse.body.status).toBe('APPROVED');
    expect(currentResponse.body.sessionTemplateId).toBe(session30Template.body.id);
  });

  it('creates a new attempt at the same session when the clinician requires a repeat', async () => {
    const clinicianToken = await createClinicianToken('+966500000732', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000733', 'SES-TEST-10');
    await startAndSubmitSample(clinicianToken, profileId, patientToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'REPEAT', reviewNotes: 'Needs more practice.' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('REPEAT_REQUIRED');

    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions/current`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(currentResponse.body.attemptNumber).toBe(2);
    expect(currentResponse.body.status).toBe('IN_TRAINING');
  });

  it('rejects a PATIENT trying to review their own session', async () => {
    const clinicianToken = await createClinicianToken('+966500000734', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000735', 'SES-TEST-11');
    await startAndSubmitSample(clinicianToken, profileId, patientToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ decision: 'APPROVE' });

    expect(response.status).toBe(403);
  });

  it('rejects reviewing an attempt that has not been submitted yet', async () => {
    const clinicianToken = await createClinicianToken('+966500000736', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000737', 'SES-TEST-12');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'APPROVE' });

    expect(response.status).toBe(400);
  });

  it('lists the full attempt history for a patient, oldest first', async () => {
    const clinicianToken = await createClinicianToken('+966500000740', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000741', 'SES-TEST-13');
    await startAndSubmitSample(clinicianToken, profileId, patientToken);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'REPEAT' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0].attemptNumber).toBe(1);
    expect(response.body[0].status).toBe('REPEAT_REQUIRED');
    expect(response.body[1].attemptNumber).toBe(2);
    expect(response.body[1].status).toBe('IN_TRAINING');
  });

  it('rejects an unrelated PATIENT viewing another patient\'s session history', async () => {
    const clinicianToken = await createClinicianToken('+966500000742', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000743', 'SES-TEST-14');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    const otherPatientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500000744',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000744', code: otherPatientRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000744', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });
});
