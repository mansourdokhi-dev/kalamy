import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Patients: create profile', () => {
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

  async function createActiveUser(mobile: string, role: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN') {
    const passwordHash = '$2a$10$abcdefghijklmnopqrstuv'; // not used for login in these tests
    return prisma.user.create({
      data: { fullName: 'Seed User', mobile, passwordHash, role, status: 'ACTIVE' },
    });
  }

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
  }

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN') {
    if (role === 'CLINICIAN') {
      // Clinicians can't self-register (Task 6 restricts /register to PATIENT/CAREGIVER),
      // so seed one directly with a real password hash via the register+verify flow's hashing,
      // by registering as PATIENT then promoting the row for test purposes.
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
      return loginAs(mobile, password);
    }

    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test User',
      mobile,
      password,
      role,
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    return loginAs(mobile, password);
  }

  it('lets a CLINICIAN create an adult patient profile', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000060', 'password123', 'CLINICIAN');
    const patientUser = await createActiveUser('+966500000061', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientUser.id,
        fullName: 'Adult Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: '1234567890',
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACTIVE');
  });

  it('rejects a PATIENT trying to create a profile', async () => {
    const patientToken = await registerActivateAndLogin('+966500000062', 'password123', 'PATIENT');
    const targetUser = await createActiveUser('+966500000063', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        userId: targetUser.id,
        fullName: 'Some Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: '1234567891',
      });

    expect(response.status).toBe(403);
  });

  it('rejects creating a minor profile without a guardianUserId', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000064', 'password123', 'CLINICIAN');
    const minorUser = await createActiveUser('+966500000065', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minorUser.id,
        fullName: 'Minor Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: '1234567892',
      });

    expect(response.status).toBe(400);
  });

  it('creates a minor profile with a guardian atomically when guardianUserId is provided', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000066', 'password123', 'CLINICIAN');
    const minorUser = await createActiveUser('+966500000067', 'PATIENT');
    const guardianUser = await createActiveUser('+966500000068', 'CAREGIVER');

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minorUser.id,
        fullName: 'Minor Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: '1234567893',
        guardianUserId: guardianUser.id,
      });

    expect(response.status).toBe(201);

    const link = await prisma.guardianLink.findFirst({
      where: { patientUserId: minorUser.id, guardianUserId: guardianUser.id },
    });
    expect(link).not.toBeNull();
  });

  it('rejects a duplicate national ID', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000069', 'password123', 'CLINICIAN');
    const firstPatient = await createActiveUser('+966500000070', 'PATIENT');
    const secondPatient = await createActiveUser('+966500000071', 'PATIENT');

    await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: firstPatient.id,
        fullName: 'First Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'DUPLICATE-ID',
      });

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: secondPatient.id,
        fullName: 'Second Patient',
        gender: 'MALE',
        dateOfBirth: '1991-05-01',
        nationalId: 'DUPLICATE-ID',
      });

    expect(response.status).toBe(409);
  });
});
