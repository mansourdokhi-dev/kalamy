import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Progress: aggregated dashboard', () => {
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
      fullName: 'Progress Test Patient',
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
        fullName: 'Progress Test Patient',
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

  it('returns a zeroed dashboard before the program has started', async () => {
    const clinicianToken = await createClinicianToken('+966500000750', 'password123');
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000751', 'PROG-TEST-1');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/progress`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.currentSessionNumber).toBeNull();
    expect(response.body.totalAttempts).toBe(0);
  });

  it('reflects a repeated session in the dashboard', async () => {
    const clinicianToken = await createClinicianToken('+966500000752', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000753', 'PROG-TEST-2');
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
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'REPEAT' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/progress`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.currentSessionNumber).toBe(1);
    expect(response.body.totalAttempts).toBe(2);
    expect(response.body.sessionsApproved).toBe(0);
    expect(response.body.repeatedSessionNumbers).toEqual([1]);
  });

  it('rejects an unrelated PATIENT viewing another patient\'s progress', async () => {
    const clinicianToken = await createClinicianToken('+966500000754', 'password123');
    const { profileId } = await setUpPatientWithActivePlan(clinicianToken, '+966500000755', 'PROG-TEST-3');
    const otherPatientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500000756',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000756', code: otherPatientRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000756', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/progress`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });
});
