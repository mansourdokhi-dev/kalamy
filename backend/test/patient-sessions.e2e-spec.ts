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
});
