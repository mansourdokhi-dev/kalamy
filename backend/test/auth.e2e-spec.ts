import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth: register + verify', () => {
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

  it('registers a new patient and returns the OTP in dev mode', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Fatimah Al-Otaibi',
      mobile: '+966500000010',
      password: 'password123',
      role: 'PATIENT',
    });

    expect(response.status).toBe(201);
    expect(response.body.userId).toBeDefined();
    expect(response.body.devOtpCode).toMatch(/^\d{6}$/);

    const user = await prisma.user.findUnique({ where: { mobile: '+966500000010' } });
    expect(user?.status).toBe('PENDING_VERIFICATION');
  });

  it('rejects registration with a duplicate mobile number', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'First User',
      mobile: '+966500000011',
      password: 'password123',
      role: 'PATIENT',
    });

    const response = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Second User',
      mobile: '+966500000011',
      password: 'password456',
      role: 'CAREGIVER',
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('rejects registration with a role other than PATIENT or CAREGIVER', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Sneaky Admin',
      mobile: '+966500000012',
      password: 'password123',
      role: 'ADMIN',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('activates the user when the correct OTP is submitted', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Fatimah Al-Otaibi',
      mobile: '+966500000013',
      password: 'password123',
      role: 'PATIENT',
    });
    const code = registerResponse.body.devOtpCode;

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000013', code });

    expect(verifyResponse.status).toBe(201);
    expect(verifyResponse.body).toEqual({ verified: true });

    const user = await prisma.user.findUnique({ where: { mobile: '+966500000013' } });
    expect(user?.status).toBe('ACTIVE');
  });

  it('rejects an incorrect OTP', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Fatimah Al-Otaibi',
      mobile: '+966500000014',
      password: 'password123',
      role: 'PATIENT',
    });

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000014', code: '000000' });

    expect(verifyResponse.status).toBe(401);
  });
});

describe('Auth: login', () => {
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

  async function registerAndActivate(mobile: string, password: string) {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
  }

  it('logs in with correct credentials and returns a session token', async () => {
    await registerAndActivate('+966500000020', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000020', password: 'password123' });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');
    expect(response.body.token.length).toBeGreaterThan(20);

    const sessionCount = await prisma.session.count();
    expect(sessionCount).toBe(1);
  });

  it('rejects an incorrect password without revealing the reason precisely', async () => {
    await registerAndActivate('+966500000021', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000021', password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('locks the account after 5 failed attempts', async () => {
    await registerAndActivate('+966500000022', 'password123');

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ mobile: '+966500000022', password: 'wrong-password' });
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000022', password: 'password123' });

    expect(response.status).toBe(429);
    expect(response.body.message).toMatch(/locked/i);
  });

  it('rejects login for a user who has not verified OTP yet', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unverified User',
      mobile: '+966500000023',
      password: 'password123',
      role: 'PATIENT',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000023', password: 'password123' });

    expect(response.status).toBe(401);
  });
});

describe('Auth: session lifecycle', () => {
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

  async function registerActivateAndLogin(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('rejects requests with no bearer token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/sessions');
    expect(response.status).toBe(401);
  });

  it('lists the active session after login', async () => {
    const token = await registerActivateAndLogin('+966500000030', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('revokes a session so it can no longer authenticate', async () => {
    const token = await registerActivateAndLogin('+966500000031', 'password123');
    const sessionsResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    const sessionId = sessionsResponse.body[0].id;

    const revokeResponse = await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revokeResponse.status).toBe(204);

    const afterRevoke = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(afterRevoke.status).toBe(401);
  });

  it('logs out and invalidates the current session', async () => {
    const token = await registerActivateAndLogin('+966500000032', 'password123');

    const logoutResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logoutResponse.status).toBe(204);

    const afterLogout = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
  });

  it('does not allow one user to revoke another user session', async () => {
    const tokenA = await registerActivateAndLogin('+966500000033', 'password123');
    const tokenB = await registerActivateAndLogin('+966500000034', 'password123');

    const sessionsBResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${tokenB}`);
    const sessionIdB = sessionsBResponse.body[0].id;

    const revokeResponse = await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${sessionIdB}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(revokeResponse.status).toBe(404);

    const stillValid = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(stillValid.status).toBe(200);
    expect(stillValid.body).toHaveLength(1);
  });
});

describe('Auth: password reset', () => {
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

  async function registerAndActivate(mobile: string, password: string) {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
  }

  it('does not reveal whether a mobile number is registered', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ mobile: '+966500000099' });

    expect(response.status).toBe(200);
    expect(response.body.devOtpCode).toBeUndefined();
  });

  it('resets the password with a valid OTP and invalidates existing sessions', async () => {
    await registerAndActivate('+966500000040', 'old-password1');
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000040', password: 'old-password1' });
    const oldToken = loginResponse.body.token;

    const forgotResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ mobile: '+966500000040' });
    const code = forgotResponse.body.devOtpCode;

    const resetResponse = await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({
      mobile: '+966500000040',
      code,
      newPassword: 'new-password2',
    });
    expect(resetResponse.status).toBe(200);

    const oldSessionCheck = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(oldSessionCheck.status).toBe(401);

    const loginWithNewPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000040', password: 'new-password2' });
    expect(loginWithNewPassword.status).toBe(200);
  });
});
