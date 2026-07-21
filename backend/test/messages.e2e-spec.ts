import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { waitForAuditLogs } from './utils/audit';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(
  app: INestApplication,
  prisma: PrismaService,
  mobile: string,
  role: 'CLINICIAN' | 'ADMIN' | 'SUPERVISOR' | null,
): Promise<{ token: string; userId: string }> {
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
  const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
  return { token: login.body.token, userId };
}

describe('Patient messages (e2e)', () => {
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

  async function setupPatient(mobile: string) {
    const { token, userId } = await registerAndLogin(app, prisma, mobile, null);
    const profile = await prisma.patientProfile.create({
      data: { userId, fullName: 'Messages Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `MSG-${Date.now()}-${Math.random()}` },
    });
    return { token, userId, profile };
  }

  it('lets a patient and their clinician exchange messages in one thread', async () => {
    const { token, profile } = await setupPatient('+966500007000');
    const { token: clinicianToken } = await registerAndLogin(app, prisma, '+966500007001', 'CLINICIAN');

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'مرحبًا، عندي سؤال عن التمرين' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ body: 'أهلًا، تفضل بسؤالك' })
      .expect(201);

    const thread = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    expect(thread.body).toHaveLength(2);
    expect(thread.body[0].body).toBe('مرحبًا، عندي سؤال عن التمرين');
    expect(thread.body[1].body).toBe('أهلًا، تفضل بسؤالك');
  });

  it("marks the other party's messages read when the thread is opened", async () => {
    const { token, profile } = await setupPatient('+966500007010');
    const { token: clinicianToken } = await registerAndLogin(app, prisma, '+966500007011', 'CLINICIAN');

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'رسالة من المريض' })
      .expect(201);
    expect(sent.body.readAt).toBeNull();

    // Clinician opens the thread -> the patient's message becomes read.
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    // Patient re-opens and sees their own message now marked read.
    const patientView = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patientView.body[0].readAt).not.toBeNull();
  });

  it("rejects a patient reading another patient's thread", async () => {
    const { profile } = await setupPatient('+966500007020');
    const { token: otherToken } = await registerAndLogin(app, prisma, '+966500007021', null);

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  it('rejects an empty message body', async () => {
    const { token, profile } = await setupPatient('+966500007030');

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: '   ' })
      .expect(400);
  });

  it('logs who viewed a patient message thread (a PHI-marked GET)', async () => {
    const { token, profile, userId } = await setupPatient('+966500007040');

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const logs = await waitForAuditLogs(prisma, {
      action: `GET /api/v1/patients/${profile.id}/messages`,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(userId);
    expect(logs[0].entityId).toBe(profile.id);
    expect(logs[0].entity).toBe('messages');
  });
});
