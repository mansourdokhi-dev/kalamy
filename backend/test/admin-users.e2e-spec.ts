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
