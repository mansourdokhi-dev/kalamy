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
