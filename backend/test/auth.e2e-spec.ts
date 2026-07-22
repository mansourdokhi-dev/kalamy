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

  it('records the consent timestamp when the user accepts the terms (SRS Part5 §5)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Consenting User',
        mobile: '+966500000015',
        password: 'password123',
        role: 'PATIENT',
        acceptedTerms: true,
      })
      .expect(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500000015' } });
    expect(user.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it('leaves the consent timestamp null when terms are not accepted', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Non Consenting User',
        mobile: '+966500000016',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500000016' } });
    expect(user.termsAcceptedAt).toBeNull();
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

  it('rejects registration with a duplicate email with a clean 409 (not a 500)', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'First User',
      mobile: '+966500000021',
      email: 'shared@example.com',
      password: 'password123',
      role: 'PATIENT',
    });

    const response = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Second User',
      mobile: '+966500000022',
      email: 'shared@example.com',
      password: 'password456',
      role: 'PATIENT',
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

  it('locks the account after 5 concurrent failed attempts without under-counting', async () => {
    await registerAndActivate('+966500000025', 'password123');

    // Fire the failed attempts truly in parallel (not sequentially) so a
    // read-then-write implementation would race on the same
    // failedLoginAttempts value and could under-count instead of locking.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ mobile: '+966500000025', password: 'wrong-password' }),
      ),
    );

    const user = await prisma.user.findUnique({ where: { mobile: '+966500000025' } });
    expect(user?.lockedUntil).not.toBeNull();
    expect(user!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000025', password: 'password123' });

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

  it('gives the same response for an unregistered mobile as for a registered one with no OTP issued yet (no enumeration)', async () => {
    await registerAndActivate('+966500000041', 'some-password1');

    const unregisteredResponse = await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({
      mobile: '+966500000098',
      code: '000000',
      newPassword: 'whatever-password1',
    });

    const noOtpIssuedResponse = await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({
      mobile: '+966500000041',
      code: '000000',
      newPassword: 'whatever-password1',
    });

    expect(unregisteredResponse.status).toBe(noOtpIssuedResponse.status);
    expect(unregisteredResponse.body.message).toBe(noOtpIssuedResponse.body.message);
  });

  it('gives the same response for an unregistered mobile as for a registered one with a real OTP issued and a wrong code submitted (no enumeration)', async () => {
    // This is the scenario the previous fix missed: forgot-password actually
    // issues a real OTP for a registered number, so otpService.verify's
    // failure reason for a wrong code (INCORRECT_CODE) differs from the
    // no-OTP-exists case (NOT_FOUND) — if that reason ever leaks into the
    // client-facing message, an attacker can call forgot-password then
    // reset-password with a throwaway code and read the reason back to learn
    // whether the number is registered, even though forgot-password's own
    // response never reveals it directly.
    await registerAndActivate('+966500000042', 'some-password1');
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ mobile: '+966500000042' });

    const unregisteredResponse = await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({
      mobile: '+966500000097',
      code: '000000',
      newPassword: 'whatever-password1',
    });

    const wrongCodeAfterRealOtpResponse = await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({
      mobile: '+966500000042',
      code: '000000',
      newPassword: 'whatever-password1',
    });

    expect(unregisteredResponse.status).toBe(wrongCodeAfterRealOtpResponse.status);
    expect(unregisteredResponse.body.message).toBe(wrongCodeAfterRealOtpResponse.body.message);
  });
});

describe('Auth: mustChangePassword + change-password', () => {
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

  it('returns mustChangePassword: false on login for a normally-registered user', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Normal Patient',
      mobile: '+966500002100',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500002100', code: registerResponse.body.devOtpCode });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002100', password: 'password123' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.mustChangePassword).toBe(false);
  });

  it('returns mustChangePassword: true on login for a user with the flag set, and clears it via change-password', async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('temp-pass-123', 10);
    const user = await prisma.user.create({
      data: {
        fullName: 'Flagged User',
        mobile: '+966500002101',
        passwordHash,
        role: 'CLINICIAN',
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002101', password: 'temp-pass-123' });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.mustChangePassword).toBe(true);
    const token = loginResponse.body.token;

    const wrongCurrentResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong-password', newPassword: 'new-password-456' });
    expect(wrongCurrentResponse.status).toBe(401);

    const changeResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'temp-pass-123', newPassword: 'new-password-456' });
    expect(changeResponse.status).toBe(200);

    const reloginOldPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002101', password: 'temp-pass-123' });
    expect(reloginOldPassword.status).toBe(401);

    const reloginNewPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002101', password: 'new-password-456' });
    expect(reloginNewPassword.status).toBe(200);
    expect(reloginNewPassword.body.mustChangePassword).toBe(false);

    void user;
  });

  it('revokes all other active sessions when the password is changed', async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('current-pass-123', 10);
    await prisma.user.create({
      data: {
        fullName: 'Multi Session User',
        mobile: '+966500002150',
        passwordHash,
        role: 'CLINICIAN',
        status: 'ACTIVE',
      },
    });

    // Two independent logins → two active session tokens (e.g. a stolen token
    // in an attacker's hands plus the legitimate user's own).
    const firstLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002150', password: 'current-pass-123' });
    const attackerToken = firstLogin.body.token;
    const secondLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002150', password: 'current-pass-123' });
    const ownerToken = secondLogin.body.token;

    // Both tokens work before the change.
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${attackerToken}`).expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ currentPassword: 'current-pass-123', newPassword: 'brand-new-pass-456' })
      .expect(200);

    // The other session (attacker's) must no longer authenticate.
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${attackerToken}`).expect(401);
  });
});

describe('Auth: GET /me', () => {
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

  it('returns the current user\'s own basic profile', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Me Endpoint Patient',
      mobile: '+966500000930',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000930', code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000930', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: registerResponse.body.userId,
      fullName: 'Me Endpoint Patient',
      mobile: '+966500000930',
      role: 'PATIENT',
      mustChangePassword: false,
    });
  });

  it('reflects mustChangePassword: true for a staff account created with that flag set', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Me Endpoint Clinician',
      mobile: '+966500000931',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000931', code: registerResponse.body.devOtpCode });
    await prisma.user.update({
      where: { mobile: '+966500000931' },
      data: { role: 'CLINICIAN', mustChangePassword: true },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000931', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('CLINICIAN');
    expect(response.body.mustChangePassword).toBe(true);
  });

  it('rejects a request with no bearer token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
  });
});
