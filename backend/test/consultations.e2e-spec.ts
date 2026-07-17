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

describe('Consultations (e2e)', () => {
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
    const token = await registerAndLogin(app, prisma, mobile, null);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
    const profile = await prisma.patientProfile.create({
      data: { userId, fullName: 'Consultation Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `CONSULT-${Date.now()}-${Math.random()}` },
    });
    return { token, profile };
  }

  it('lets a patient request their one free consultation, choosing video or voice', async () => {
    const { token, profile } = await setupPatient('+966500006000');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VOICE', reasonNote: 'Need help with hand-sync technique' })
      .expect(201);

    expect(res.body.type).toBe('VOICE');
    expect(res.body.status).toBe('REQUESTED');
  });

  it('rejects a second consultation request while one is still active', async () => {
    const { token, profile } = await setupPatient('+966500006010');

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VOICE', reasonNote: 'y' })
      .expect(409);
  });

  it('allows a new request after the previous consultation was cancelled, but not after it was completed', async () => {
    const { token, profile } = await setupPatient('+966500006020');
    const clinicianToken = await registerAndLogin(app, prisma, '+966500006021', 'CLINICIAN');

    const first = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${first.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VOICE', reasonNote: 'y' })
      .expect(201);

    const second = await prisma.consultation.findFirst({ where: { patientProfileId: profile.id, type: 'VOICE' } });
    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${second!.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'COMPLETED', outcomeNotes: 'Discussed technique, patient understands now' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'z' })
      .expect(409);
  });

  it('lets a clinician update scheduling details and the external meeting link', async () => {
    const { token, profile } = await setupPatient('+966500006030');
    const clinicianToken = await registerAndLogin(app, prisma, '+966500006031', 'CLINICIAN');

    const created = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${created.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), externalMeetingLink: 'https://meet.example.com/abc' })
      .expect(200);

    expect(updated.body.status).toBe('SCHEDULED');
    expect(updated.body.externalMeetingLink).toBe('https://meet.example.com/abc');
  });

  it('rejects a further update once the consultation has been completed', async () => {
    const { token, profile } = await setupPatient('+966500006040');
    const clinicianToken = await registerAndLogin(app, prisma, '+966500006041', 'CLINICIAN');

    const created = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${created.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'COMPLETED', outcomeNotes: 'Discussed technique, patient understands now' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${created.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'SCHEDULED' })
      .expect(409);
  });

  it('rejects a further update once the consultation has been cancelled', async () => {
    const { token, profile } = await setupPatient('+966500006050');
    const clinicianToken = await registerAndLogin(app, prisma, '+966500006051', 'CLINICIAN');

    const created = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VOICE', reasonNote: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${created.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${created.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'SCHEDULED' })
      .expect(409);
  });

  it("logs who viewed a patient's consultation list (a PHI-marked GET)", async () => {
    const { token, profile } = await setupPatient('+966500006060');

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VOICE', reasonNote: 'Need help with hand-sync technique' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const logs = await prisma.auditLog.findMany({
      where: { action: `GET /api/v1/patients/${profile.id}/consultations` },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(profile.userId);
    expect(logs[0].entityId).toBe(profile.id);
    expect(logs[0].entity).toBe('consultations');
  });
});
