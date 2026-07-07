import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reports: operational status and registered users', () => {
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

  async function createUserToken(
    mobile: string,
    password: string,
    role: 'PATIENT' | 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN',
  ): Promise<{ token: string; userId: string }> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Reports Admin Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return { token: loginResponse.body.token, userId: registerResponse.body.userId };
  }

  it('returns zero-filled counts across all roles and statuses', async () => {
    const { token: adminToken } = await createUserToken('+966500001100', 'password123', 'ADMIN');
    await createUserToken('+966500001101', 'password123', 'CLINICIAN');
    await createUserToken('+966500001102', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/operational-status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.usersByRole.ADMIN).toBe(1);
    expect(response.body.usersByRole.CLINICIAN).toBe(1);
    expect(response.body.usersByRole.PATIENT).toBe(1);
    expect(response.body.usersByRole.CAREGIVER).toBe(0);
    expect(response.body.patientProfilesByStatus.ACTIVE).toBe(0);
    expect(response.body.patientSessionsByStatus.IN_TRAINING).toBe(0);
  });

  it('rejects a CLINICIAN viewing the operational status report', async () => {
    const { token } = await createUserToken('+966500001103', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/operational-status')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('lists registered users with a case-progress summary for patients', async () => {
    const { token: adminToken } = await createUserToken('+966500001104', 'password123', 'ADMIN');
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Registered Users Test Patient',
      mobile: '+966500001105',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001105', code: patientRegister.body.devOtpCode });

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/registered-users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const patientSummary = response.body.find((u: { id: string }) => u.id === patientRegister.body.userId);
    expect(patientSummary.caseProgressSummary).toBe('Not started');
  });

  it('rejects a CLINICIAN listing registered users', async () => {
    const { token } = await createUserToken('+966500001106', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/registered-users')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});

describe('Reports: service modification log', () => {
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

  async function createUserToken(mobile: string, password: string, role: 'PATIENT' | 'CLINICIAN' | 'ADMIN'): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Service Log Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lists a mutating request performed by a known actor', async () => {
    const adminToken = await createUserToken('+966500001200', 'password123', 'ADMIN');
    const clinicianToken = await createUserToken('+966500001201', 'password123', 'CLINICIAN');
    await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ title: 'Log Test Exercise', category: 'Breathing', phaseLevel: 1, instructions: 'Breathe.', durationMinutes: 5 });

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/service-modifications')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const exerciseLog = response.body.find((entry: { entity: string }) => entry.entity === 'exercises');
    expect(exerciseLog).toBeDefined();
    expect(exerciseLog.actorRole).toBe('CLINICIAN');
  });

  it('filters by date range', async () => {
    const adminToken = await createUserToken('+966500001202', 'password123', 'ADMIN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/service-modifications?from=2099-01-01&to=2099-12-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('rejects a CLINICIAN viewing the service modification log', async () => {
    const token = await createUserToken('+966500001203', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/service-modifications')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});

describe('Reports: staff performance and complaints', () => {
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

  async function createUserToken(
    mobile: string,
    password: string,
    role: 'PATIENT' | 'CLINICIAN' | 'ADMIN',
  ): Promise<{ token: string; userId: string }> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Staff Performance Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return { token: loginResponse.body.token, userId: registerResponse.body.userId };
  }

  it('counts a complaint against the named clinician in both reports', async () => {
    const { token: adminToken } = await createUserToken('+966500001300', 'password123', 'ADMIN');
    const { userId: clinicianUserId } = await createUserToken('+966500001301', 'password123', 'CLINICIAN');
    const { token: patientToken } = await createUserToken('+966500001302', 'password123', 'PATIENT');
    await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        type: 'COMPLAINT',
        subject: 'Slow review',
        description: 'Took too long.',
        relatedClinicianUserId: clinicianUserId,
      });

    const performanceResponse = await request(app.getHttpServer())
      .get('/api/v1/reports/staff-performance')
      .set('Authorization', `Bearer ${adminToken}`);
    const complaintsResponse = await request(app.getHttpServer())
      .get(`/api/v1/reports/complaints?relatedClinicianUserId=${clinicianUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(performanceResponse.status).toBe(200);
    const clinicianSummary = performanceResponse.body.find(
      (s: { clinicianUserId: string }) => s.clinicianUserId === clinicianUserId,
    );
    expect(clinicianSummary.complaintsAgainst).toBe(1);

    expect(complaintsResponse.status).toBe(200);
    expect(complaintsResponse.body).toHaveLength(1);
    expect(complaintsResponse.body[0].subject).toBe('Slow review');
  });

  it('rejects a CLINICIAN viewing the staff performance report', async () => {
    const { token } = await createUserToken('+966500001303', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/staff-performance')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});
