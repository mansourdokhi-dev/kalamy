import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('User schema: mustChangePassword + supervisorUserId', () => {
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

  it('defaults mustChangePassword to false and supervisorUserId to null, and supports assigning a supervisor', async () => {
    const clinician = await prisma.user.create({
      data: {
        fullName: 'Schema Test Clinician',
        mobile: '+966500002000',
        passwordHash: 'x',
        role: 'CLINICIAN',
        status: 'ACTIVE',
      },
    });
    expect(clinician.mustChangePassword).toBe(false);
    expect(clinician.supervisorUserId).toBeNull();

    const supervisor = await prisma.user.create({
      data: {
        fullName: 'Schema Test Supervisor',
        mobile: '+966500002001',
        passwordHash: 'x',
        role: 'SUPERVISOR',
        status: 'ACTIVE',
      },
    });

    const updated = await prisma.user.update({
      where: { id: clinician.id },
      data: { supervisorUserId: supervisor.id },
    });
    expect(updated.supervisorUserId).toBe(supervisor.id);
  });
});

describe('Admin Users: staff account creation', () => {
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

  async function createAdminToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Admin User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'ADMIN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lets an ADMIN create a CLINICIAN account with mustChangePassword set', async () => {
    const adminToken = await createAdminToken('+966500002200', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'New Clinician',
        mobile: '+966500002201',
        password: 'initial-pass1',
        role: 'CLINICIAN',
      });

    expect(response.status).toBe(201);
    expect(response.body.role).toBe('CLINICIAN');
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.mustChangePassword).toBe(true);
    expect(response.body.passwordHash).toBeUndefined();

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002201', password: 'initial-pass1' });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.mustChangePassword).toBe(true);
  });

  it('rejects a non-ADMIN creating a staff account', async () => {
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile: '+966500002202',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500002202', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500002202' }, data: { role: 'CLINICIAN' } });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002202', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${loginResponse.body.token}`)
      .send({ fullName: 'Blocked', mobile: '+966500002203', password: 'password123', role: 'CLINICIAN' });

    expect(response.status).toBe(403);
  });

  it('409s when the mobile number is already registered', async () => {
    const adminToken = await createAdminToken('+966500002204', 'password123');
    await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'First', mobile: '+966500002205', password: 'password123', role: 'CLINICIAN' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Duplicate', mobile: '+966500002205', password: 'password123', role: 'SUPERVISOR' });

    expect(response.status).toBe(409);
  });
});

describe('Admin Users: list, view, enable/disable', () => {
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

  async function createAdminToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Admin User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'ADMIN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lets an ADMIN list and filter users by role', async () => {
    const adminToken = await createAdminToken('+966500002300', 'password123');
    await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'A Clinician', mobile: '+966500002301', password: 'password123', role: 'CLINICIAN' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users?role=CLINICIAN')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].mobile).toBe('+966500002301');
    expect(response.body[0].passwordHash).toBeUndefined();
  });

  it('lets an ADMIN view a single user by id', async () => {
    const adminToken = await createAdminToken('+966500002302', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'View Me', mobile: '+966500002303', password: 'password123', role: 'SUPERVISOR' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/users/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.fullName).toBe('View Me');
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('404s when viewing a nonexistent user', async () => {
    const adminToken = await createAdminToken('+966500002304', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('lets an ADMIN disable and re-enable a user account', async () => {
    const adminToken = await createAdminToken('+966500002305', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'To Disable', mobile: '+966500002306', password: 'password123', role: 'CLINICIAN' });

    const disableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${createResponse.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DISABLED' });
    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body.status).toBe('DISABLED');
    expect(disableResponse.body.passwordHash).toBeUndefined();

    const loginAttempt = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002306', password: 'password123' });
    expect(loginAttempt.status).toBe(401);

    const enableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${createResponse.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });
    expect(enableResponse.status).toBe(200);
    expect(enableResponse.body.status).toBe('ACTIVE');
  });

  it('revokes an already-issued session token immediately when the account is disabled', async () => {
    const adminToken = await createAdminToken('+966500002307', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'To Disable While Logged In', mobile: '+966500002308', password: 'password123', role: 'CLINICIAN' });

    // The target user logs in BEFORE being disabled, so their token is already
    // issued and would otherwise remain valid for the full session TTL.
    const targetLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002308', password: 'password123' });
    const targetToken = targetLogin.body.token;

    const meBeforeDisable = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${targetToken}`);
    expect(meBeforeDisable.status).toBe(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${createResponse.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DISABLED' })
      .expect(200);

    const meAfterDisable = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${targetToken}`);
    expect(meAfterDisable.status).toBe(401);
  });

  it('rejects a non-ADMIN listing users', async () => {
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile: '+966500002307',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500002307', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500002307' }, data: { role: 'CLINICIAN' } });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002307', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(403);
  });
});
