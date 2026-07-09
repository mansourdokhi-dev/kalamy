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

describe('Treatment Engine — Levels (e2e)', () => {
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

  it('lets a clinician create a level and publish a version, then a patient can view it', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500000900', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500000901', null);

    const levelRes = await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'المستوى الأول', order: 1 })
      .expect(201);

    const versionRes = await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        versionNumber: 1,
        behavioralTechnique: 'إطالة صوت واحد منتهٍ بحرف علة',
        trainingListJson: JSON.stringify(['حا', 'جا', 'ثا']),
        samplePartTemplateJson: JSON.stringify([{ partType: 'مقطع', label: 'مقطع 1', order: 1, required: true }]),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions/${versionRes.body.id}/publish`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/levels')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(listRes.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'المستوى الأول', order: 1 })]),
    );
  });

  it('rejects a patient trying to create a level', async () => {
    const patientToken = await registerAndLogin(app, prisma, '+966500000902', null);
    await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ name: 'x', order: 99 })
      .expect(403);
  });

  it('rejects malformed JSON in trainingListJson', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500000903', 'CLINICIAN');
    const levelRes = await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'مستوى اختبار', order: 2 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: 'not valid json',
        samplePartTemplateJson: JSON.stringify([{ partType: 'مقطع', label: 'مقطع 1', order: 1, required: true }]),
      })
      .expect(400);
  });

  it('lets a patient fetch the active version of a published level, and 409s for an unpublished one', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500000910', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500000911', null);

    const levelRes = await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'مستوى النشط', order: 3 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/levels/${levelRes.body.id}/versions/active`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);

    const versionRes = await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        versionNumber: 1,
        behavioralTechnique: 'تقنية الإطالة',
        trainingListJson: JSON.stringify(['حا']),
        samplePartTemplateJson: JSON.stringify([{ partType: 'مقطع', label: 'مقطع 1', order: 1, required: true }]),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions/${versionRes.body.id}/publish`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    const activeRes = await request(app.getHttpServer())
      .get(`/api/v1/levels/${levelRes.body.id}/versions/active`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(activeRes.body.id).toBe(versionRes.body.id);
    expect(activeRes.body.behavioralTechnique).toBe('تقنية الإطالة');
  });
});
