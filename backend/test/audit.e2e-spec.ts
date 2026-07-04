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

  it('does not log a GET request', async () => {
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
});
