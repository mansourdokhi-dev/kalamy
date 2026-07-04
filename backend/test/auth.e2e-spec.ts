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
