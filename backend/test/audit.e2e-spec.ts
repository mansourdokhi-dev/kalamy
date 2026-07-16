import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Audit logging', () => {
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

  it('does not log a GET request that is not marked as a PHI read', async () => {
    await request(app.getHttpServer()).get('/health');
    const count = await prisma.auditLog.count();
    expect(count).toBe(0);
  });

  it('logs a registration as a mutating request', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Audit Test User',
      mobile: '+966500000050',
      password: 'password123',
      role: 'PATIENT',
    });

    const logs = await prisma.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('POST /api/v1/auth/register');
    expect(logs[0].entity).toBe('auth');
  });

  async function registerAndLogin(mobile: string, role: 'PATIENT' | 'CLINICIAN'): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'PHI Read Test User',
      mobile,
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role === 'CLINICIAN') {
      await prisma.user.update({ where: { mobile }, data: { role: 'CLINICIAN' } });
    }
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile, password: 'password123' });
    return loginResponse.body.token;
  }

  it('logs who viewed a patient clinical profile (a PHI-marked GET)', async () => {
    const clinicianToken = await registerAndLogin('+966500000051', 'CLINICIAN');
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500000051' } });
    const patientUser = await prisma.user.create({
      data: { fullName: 'Patient', mobile: '+966500000052', passwordHash: 'x', role: 'PATIENT', status: 'ACTIVE' },
    });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'AUDIT-1' },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    const logs = await prisma.auditLog.findMany({ where: { action: `GET /api/v1/patients/${profile.id}` } });
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(clinicianUser.id);
    expect(logs[0].entityId).toBe(profile.id);
    expect(logs[0].entity).toBe('patients');
    // Deliberately lightweight for reads: no response body captured (would
    // mean storing the patient's full clinical record a second time).
    expect(logs[0].after).toBeNull();
  });
});
