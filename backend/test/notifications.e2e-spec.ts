import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(app: INestApplication, prisma: PrismaService, mobile: string): Promise<{ token: string; userId: string }> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
  return { token: login.body.token, userId };
}

describe('Notifications (e2e)', () => {
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

  it('lists only the current user\'s notifications, newest first', async () => {
    const { token, userId } = await registerAndLogin(app, prisma, '+966500006000');
    const { userId: otherUserId } = await registerAndLogin(app, prisma, '+966500006001');

    await prisma.notification.create({
      data: { recipientUserId: userId, type: 'SPECIALIST_DECISION_ISSUED', title: 'older', body: 'b' },
    });
    const newer = await prisma.notification.create({
      data: { recipientUserId: userId, type: 'SPECIALIST_DECISION_ISSUED', title: 'newer', body: 'b' },
    });
    await prisma.notification.create({
      data: { recipientUserId: otherUserId, type: 'SPECIALIST_DECISION_ISSUED', title: 'not mine', body: 'b' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.map((n: any) => n.title)).toEqual(['newer', 'older']);
    expect(res.body[0].id).toBe(newer.id);
  });

  it('marks a notification as read', async () => {
    const { token, userId } = await registerAndLogin(app, prisma, '+966500006010');
    const notification = await prisma.notification.create({
      data: { recipientUserId: userId, type: 'SPECIALIST_DECISION_ISSUED', title: 't', body: 'b' },
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.readAt).not.toBeNull();
  });

  it('rejects marking someone else\'s notification as read', async () => {
    const { token } = await registerAndLogin(app, prisma, '+966500006020');
    const { userId: otherUserId } = await registerAndLogin(app, prisma, '+966500006021');
    const notification = await prisma.notification.create({
      data: { recipientUserId: otherUserId, type: 'SPECIALIST_DECISION_ISSUED', title: 't', body: 'b' },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
