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

  it('lets a patient fetch their own profile via /me', async () => {
    const patientToken = await registerActivateAndLogin('+966500000070', 'password123', 'PATIENT');
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500000070' } });
    const clinicianToken = await registerActivateAndLogin('+966500000071', 'password123', 'CLINICIAN');

    await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientUser.id,
        fullName: 'Self Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: '1111111111',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/me')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(response.body.userId).toBe(patientUser.id);
    expect(response.body.fullName).toBe('Self Patient');
  });

  it('returns 404 from /me when no patient profile exists yet', async () => {
    const patientToken = await registerActivateAndLogin('+966500000072', 'password123', 'PATIENT');
    await request(app.getHttpServer())
      .get('/api/v1/patients/me')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(404);
  });

  it('lets a linked caregiver fetch their child\'s profile via /me', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000073', 'password123', 'CLINICIAN');
    const childUser = await createActiveUser('+966500000074', 'PATIENT');
    const caregiverToken = await registerActivateAndLogin('+966500000075', 'password123', 'CAREGIVER');
    const caregiverUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500000075' } });

    const profileRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: childUser.id,
        fullName: 'Child Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-01-01',
        nationalId: '2222222222',
        guardianUserId: caregiverUser.id,
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/me')
      .set('Authorization', `Bearer ${caregiverToken}`)
      .expect(200);

    expect(response.body.id).toBe(profileRes.body.id);
    expect(response.body.userId).toBe(childUser.id);
  });
});

describe('Patients: get and update profile', () => {
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

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
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
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

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
    return loginAs(mobile, password);
  }

  it('lets a patient view their own profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000080', 'password123');
    const patient = await registerActivateAndLogin('+966500000081', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Own Profile Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'OWN-PROFILE-1',
      });
    const profileId = createResponse.body.id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${patient.token}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(profileId);
  });

  it('forbids a patient from viewing another patient\'s profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000082', 'password123');
    const owner = await registerActivateAndLogin('+966500000083', 'password123', 'PATIENT');
    const stranger = await registerActivateAndLogin('+966500000084', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: owner.userId,
        fullName: 'Owner Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'OWN-PROFILE-2',
      });
    const profileId = createResponse.body.id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${stranger.token}`);

    expect(response.status).toBe(403);
  });

  it('lets a linked caregiver view and update the patient profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000085', 'password123');
    const minor = await registerActivateAndLogin('+966500000086', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000087', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minor.userId,
        fullName: 'Minor Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: 'MINOR-PROFILE-1',
        guardianUserId: guardian.userId,
      });
    const profileId = createResponse.body.id;

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${guardian.token}`);
    expect(getResponse.status).toBe(200);

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${guardian.token}`)
      .send({ address: 'Riyadh, Saudi Arabia' });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.address).toBe('Riyadh, Saudi Arabia');
  });

  it('forbids an unlinked caregiver from viewing the profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000088', 'password123');
    const minor = await registerActivateAndLogin('+966500000089', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000090', 'password123', 'CAREGIVER');
    const unrelatedCaregiver = await registerActivateAndLogin('+966500000091', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minor.userId,
        fullName: 'Minor Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: 'MINOR-PROFILE-2',
        guardianUserId: guardian.userId,
      });
    const profileId = createResponse.body.id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${unrelatedCaregiver.token}`);

    expect(response.status).toBe(403);
  });

  it('returns 404 for a non-existent profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000092', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(404);
  });
});

describe('Patients: link guardian', () => {
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

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
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
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

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
    return loginAs(mobile, password);
  }

  it('lets a clinician link a second guardian to an adult patient', async () => {
    const clinicianToken = await createClinicianToken('+966500000100', 'password123');
    const adult = await registerActivateAndLogin('+966500000101', 'password123', 'PATIENT');
    const secondGuardian = await registerActivateAndLogin('+966500000102', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: adult.userId,
        fullName: 'Adult Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'LINK-GUARDIAN-1',
      });
    const profileId = createResponse.body.id;

    const linkResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/guardian`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ guardianUserId: secondGuardian.userId, relationship: 'FAMILY_SUPPORT' });

    expect(linkResponse.status).toBe(201);

    const link = await prisma.guardianLink.findFirst({
      where: { patientUserId: adult.userId, guardianUserId: secondGuardian.userId },
    });
    expect(link?.relationship).toBe('FAMILY_SUPPORT');
  });

  it('rejects linking a guardianUserId that is not a CAREGIVER role', async () => {
    const clinicianToken = await createClinicianToken('+966500000103', 'password123');
    const adult = await registerActivateAndLogin('+966500000104', 'password123', 'PATIENT');
    const notAGuardian = await registerActivateAndLogin('+966500000105', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: adult.userId,
        fullName: 'Adult Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'LINK-GUARDIAN-2',
      });
    const profileId = createResponse.body.id;

    const linkResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/guardian`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ guardianUserId: notAGuardian.userId, relationship: 'FAMILY_SUPPORT' });

    expect(linkResponse.status).toBe(400);
  });

  it('rejects a PATIENT trying to link a guardian', async () => {
    const clinicianToken = await createClinicianToken('+966500000106', 'password123');
    const adult = await registerActivateAndLogin('+966500000107', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000108', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: adult.userId,
        fullName: 'Adult Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'LINK-GUARDIAN-3',
      });
    const profileId = createResponse.body.id;

    const linkResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/guardian`)
      .set('Authorization', `Bearer ${adult.token}`)
      .send({ guardianUserId: guardian.userId, relationship: 'FAMILY_SUPPORT' });

    expect(linkResponse.status).toBe(403);
  });
});

describe('Patients: disable and search', () => {
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

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
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
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

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
    return loginAs(mobile, password);
  }

  it('disables a profile without deleting the row', async () => {
    const clinicianToken = await createClinicianToken('+966500000110', 'password123');
    const patient = await registerActivateAndLogin('+966500000111', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'To Be Disabled',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'DISABLE-TEST-1',
      });
    const profileId = createResponse.body.id;

    const disableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${profileId}/status`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'DISABLED' });

    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body.status).toBe('DISABLED');

    const stillExists = await prisma.patientProfile.findUnique({ where: { id: profileId } });
    expect(stillExists).not.toBeNull();
  });

  it('rejects a PATIENT trying to disable a profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000112', 'password123');
    const patient = await registerActivateAndLogin('+966500000113', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Protected Profile',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'DISABLE-TEST-2',
      });
    const profileId = createResponse.body.id;

    const disableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${profileId}/status`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ status: 'DISABLED' });

    expect(disableResponse.status).toBe(403);
  });

  it('lets a clinician search patients by name', async () => {
    const clinicianToken = await createClinicianToken('+966500000114', 'password123');
    const patient = await registerActivateAndLogin('+966500000115', 'password123', 'PATIENT');

    await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Findable Patient Name',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'SEARCH-TEST-1',
      });

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients?q=Findable')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].fullName).toBe('Findable Patient Name');
  });

  it('does not include clinical info in search results', async () => {
    const clinicianToken = await createClinicianToken('+966500000117', 'password123');
    const patient = await registerActivateAndLogin('+966500000118', 'password123', 'PATIENT');

    await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Findable Clinical Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'SEARCH-CLINICAL-1',
        clinicalInfo: { initialDiagnosis: 'Should not leak into search results' },
      });

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients?q=Findable Clinical')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].fullName).toBe('Findable Clinical Patient');
    expect(response.body[0].clinicalInfo).toBeUndefined();
    expect(Object.keys(response.body[0]).sort()).toEqual(
      ['dateOfBirth', 'fullName', 'gender', 'id', 'nationalId', 'status'].sort(),
    );
  });

  it('rejects a PATIENT trying to search', async () => {
    const patient = await registerActivateAndLogin('+966500000116', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients?q=anything')
      .set('Authorization', `Bearer ${patient.token}`);

    expect(response.status).toBe(403);
  });
});

describe('Patients: edit clinical info', () => {
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

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
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
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

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
    return loginAs(mobile, password);
  }

  it('lets a CLINICIAN add clinical info to a patient who has none yet', async () => {
    const clinicianToken = await createClinicianToken('+966500000120', 'password123');
    const patient = await registerActivateAndLogin('+966500000121', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'No Clinical Info Yet',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'CLINICAL-INFO-1',
      });
    const profileId = createResponse.body.id;
    expect(createResponse.body.clinicalInfo).toBeNull();

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ clinicalInfo: { initialDiagnosis: 'Moderate stutter', allergies: 'None known' } });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.clinicalInfo.initialDiagnosis).toBe('Moderate stutter');
    expect(updateResponse.body.clinicalInfo.allergies).toBe('None known');
  });

  it('updates only the provided clinical-info fields without clearing the others', async () => {
    const clinicianToken = await createClinicianToken('+966500000122', 'password123');
    const patient = await registerActivateAndLogin('+966500000123', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Has Clinical Info',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'CLINICAL-INFO-2',
        clinicalInfo: { initialDiagnosis: 'Original diagnosis', medications: 'Original meds' },
      });
    const profileId = createResponse.body.id;

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ clinicalInfo: { medications: 'Updated meds' } });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.clinicalInfo.medications).toBe('Updated meds');
    expect(updateResponse.body.clinicalInfo.initialDiagnosis).toBe('Original diagnosis');
  });

  it('forbids a CAREGIVER from editing clinical info', async () => {
    const clinicianToken = await createClinicianToken('+966500000124', 'password123');
    const minor = await registerActivateAndLogin('+966500000125', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000126', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minor.userId,
        fullName: 'Guarded Minor',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: 'CLINICAL-INFO-3',
        guardianUserId: guardian.userId,
      });
    const profileId = createResponse.body.id;

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${guardian.token}`)
      .send({ clinicalInfo: { initialDiagnosis: 'Should not be allowed' } });

    expect(updateResponse.status).toBe(403);
  });

  it('still lets a CAREGIVER update basic fields without clinicalInfo', async () => {
    const clinicianToken = await createClinicianToken('+966500000127', 'password123');
    const minor = await registerActivateAndLogin('+966500000128', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000129', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minor.userId,
        fullName: 'Guarded Minor Two',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: 'CLINICAL-INFO-4',
        guardianUserId: guardian.userId,
      });
    const profileId = createResponse.body.id;

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${guardian.token}`)
      .send({ address: 'Jeddah, Saudi Arabia' });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.address).toBe('Jeddah, Saudi Arabia');
  });
});
