import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Assessments: create, list, get', () => {
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

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER') {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test User',
      mobile,
      password,
      role,
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return { token: loginResponse.body.token, userId: registerResponse.body.userId };
  }

  async function createPatientProfile(clinicianToken: string, patientUserId: string, nationalId: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientUserId,
        fullName: 'Assessment Test Patient',
        gender: 'MALE',
        dateOfBirth: '1990-01-01',
        nationalId,
      });
    return response.body.id;
  }

  it('lets a CLINICIAN create a draft assessment for a patient', async () => {
    const clinicianToken = await createClinicianToken('+966500000300', 'password123');
    const patient = await registerActivateAndLogin('+966500000301', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-TEST-1');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    expect(response.status).toBe(201);
    expect(response.body.type).toBe('INITIAL');
    expect(response.body.status).toBe('DRAFT');
  });

  it('rejects a PATIENT trying to create an assessment', async () => {
    const clinicianToken = await createClinicianToken('+966500000302', 'password123');
    const patient = await registerActivateAndLogin('+966500000303', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-TEST-2');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ type: 'INITIAL' });

    expect(response.status).toBe(403);
  });

  it('lets the patient view their own assessments', async () => {
    const clinicianToken = await createClinicianToken('+966500000304', 'password123');
    const patient = await registerActivateAndLogin('+966500000305', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-TEST-3');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${patient.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('rejects a PATIENT viewing another patient\'s assessments', async () => {
    const clinicianToken = await createClinicianToken('+966500000306', 'password123');
    const patientA = await registerActivateAndLogin('+966500000307', 'password123', 'PATIENT');
    const patientB = await registerActivateAndLogin('+966500000308', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patientA.userId, 'ASM-TEST-4');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${patientB.token}`);

    expect(response.status).toBe(403);
  });

  it('gets a single assessment by id', async () => {
    const clinicianToken = await createClinicianToken('+966500000309', 'password123');
    const patient = await registerActivateAndLogin('+966500000310', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-TEST-5');
    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/assessments/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(createResponse.body.id);
  });

  it('returns 404 when fetching an assessment via another patient\'s profile id', async () => {
    const clinicianToken = await createClinicianToken('+966500000311', 'password123');
    const patientA = await registerActivateAndLogin('+966500000312', 'password123', 'PATIENT');
    const patientB = await registerActivateAndLogin('+966500000313', 'password123', 'PATIENT');
    const profileAId = await createPatientProfile(clinicianToken, patientA.userId, 'ASM-TEST-6A');
    const profileBId = await createPatientProfile(clinicianToken, patientB.userId, 'ASM-TEST-6B');
    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileAId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileBId}/assessments/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(404);
  });
});

describe('Assessments: update and approve', () => {
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

  async function setUpPatientWithDraftAssessment(clinicianToken: string, patientMobile: string, nationalId: string) {
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Draft Assessment Patient',
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
        fullName: 'Draft Assessment Patient',
        gender: 'FEMALE',
        dateOfBirth: '1995-01-01',
        nationalId,
      });
    const assessmentResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });
    return { profileId: profileResponse.body.id, assessmentId: assessmentResponse.body.id };
  }

  it('lets a CLINICIAN update a draft assessment with SSI-4 scores', async () => {
    const clinicianToken = await createClinicianToken('+966500000320', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithDraftAssessment(
      clinicianToken,
      '+966500000321',
      'ASM-UPD-1',
    );

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/assessments/${assessmentId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ ssi4Frequency: 12, ssi4Duration: 3, ssi4PhysicalConcomitants: 2, ssi4Total: 17 });

    expect(response.status).toBe(200);
    expect(response.body.ssi4Total).toBe(17);
  });

  it('approves a draft assessment with a clinician-assigned severity category', async () => {
    const clinicianToken = await createClinicianToken('+966500000322', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithDraftAssessment(
      clinicianToken,
      '+966500000323',
      'ASM-UPD-2',
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentId}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MODERATE' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('APPROVED');
    expect(response.body.severityCategory).toBe('MODERATE');
    expect(response.body.approvedAt).not.toBeNull();
  });

  it('rejects updating an already-approved assessment', async () => {
    const clinicianToken = await createClinicianToken('+966500000324', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithDraftAssessment(
      clinicianToken,
      '+966500000325',
      'ASM-UPD-3',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentId}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MILD' });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/assessments/${assessmentId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ clinicianNotes: 'Trying to edit after approval' });

    expect(response.status).toBe(400);
  });

  it('rejects a PATIENT trying to approve an assessment', async () => {
    const clinicianToken = await createClinicianToken('+966500000326', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithDraftAssessment(
      clinicianToken,
      '+966500000327',
      'ASM-UPD-4',
    );
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000327', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentId}/approve`)
      .set('Authorization', `Bearer ${patientLogin.body.token}`)
      .send({ severityCategory: 'MILD' });

    expect(response.status).toBe(403);
  });
});
