import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reports: patient-scoped (assessment results, medical)', () => {
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

  async function setUpPatientWithApprovedAssessmentAndPlan(clinicianToken: string, patientMobile: string, nationalId: string) {
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Reports Test Patient',
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
        fullName: 'Reports Test Patient',
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

  it('returns the assessment results report for the patient who owns it', async () => {
    const clinicianToken = await createClinicianToken('+966500001000', 'password123');
    const { profileId, patientToken } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001001', 'REP-TEST-1');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/assessment-results`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.assessments).toHaveLength(1);
    expect(response.body.assessments[0].severityCategory).toBe('MODERATE');
    expect(response.body.assessments[0].status).toBe('APPROVED');
  });

  it("rejects an unrelated PATIENT viewing another patient's assessment results report", async () => {
    const clinicianToken = await createClinicianToken('+966500001002', 'password123');
    const { profileId } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001003', 'REP-TEST-2');
    const otherRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500001004',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001004', code: otherRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500001004', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/assessment-results`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });

  it("rejects an unrelated PATIENT viewing another patient's medical report", async () => {
    const clinicianToken = await createClinicianToken('+966500001009', 'password123');
    const { profileId } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001010', 'REP-TEST-5');
    const otherRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500001011',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001011', code: otherRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500001011', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/medical`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });

  it('returns the medical report combining clinical info, latest approved assessment, and active plan', async () => {
    const clinicianToken = await createClinicianToken('+966500001005', 'password123');
    const { profileId, patientToken } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001006', 'REP-TEST-3');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/medical`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.patientFullName).toBe('Reports Test Patient');
    expect(response.body.latestApprovedAssessment.severityCategory).toBe('MODERATE');
    expect(response.body.activeTreatmentPlan.goals).toBe('Complete the 30-session program');
    expect(response.body.clinicalInfo).toBeNull();
  });

  it('lets a CLINICIAN view the medical report for any patient', async () => {
    const clinicianToken = await createClinicianToken('+966500001007', 'password123');
    const { profileId } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001008', 'REP-TEST-4');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/medical`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body.activeTreatmentPlan).not.toBeNull();
  });
});
