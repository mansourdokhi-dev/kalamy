import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(
  app: INestApplication,
  prisma: PrismaService,
  mobile: string,
  role: 'CLINICIAN' | 'ADMIN' | 'SUPERVISOR' | null,
): Promise<string> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  if (role) {
    await prisma.user.update({ where: { mobile }, data: { role } });
  }
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  return login.body.token;
}

describe('Notification settings — admin endpoints (e2e)', () => {
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

  it('lists all four settings with defaults for an admin', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500008000', 'ADMIN');

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/notification-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveLength(4);
    expect(res.body).toEqual(
      expect.arrayContaining([{ key: 'CONSULTATION_REMINDER_HOUR_BEFORE_MS', valueMs: 60 * 60 * 1000 }]),
    );
  });

  it('persists an update and reflects it on a subsequent GET', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500008001', 'ADMIN');

    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_HOUR_BEFORE_MS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 30 * 60 * 1000 })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/notification-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual(expect.arrayContaining([{ key: 'CONSULTATION_REMINDER_HOUR_BEFORE_MS', valueMs: 30 * 60 * 1000 }]));
  });

  it('rejects an update for a key not in the allow-list', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500008002', 'ADMIN');

    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/NOT_A_REAL_SETTING')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 1000 })
      .expect(400);
  });

  it('rejects an hour-before/day-before combination that would violate the non-overlap invariant', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500008003', 'ADMIN');

    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_HOUR_BEFORE_MS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 24 * 60 * 60 * 1000 })
      .expect(400);
  });

  it('rejects a clinician (not an admin) from reading or writing settings', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500008004', 'CLINICIAN');

    await request(app.getHttpServer())
      .get('/api/v1/admin/notification-settings')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_HOUR_BEFORE_MS')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ valueMs: 1000 })
      .expect(403);
  });

  it('rejects a supervisor (not an admin) from managing settings', async () => {
    const supervisorToken = await registerAndLogin(app, prisma, '+966500008005', 'SUPERVISOR');

    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_HOUR_BEFORE_MS')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ valueMs: 1000 })
      .expect(403);
  });
});
