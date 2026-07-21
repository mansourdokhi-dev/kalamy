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

describe('Questionnaires (e2e)', () => {
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
      data: { userId, fullName: 'Questionnaire Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `QST-${Date.now()}-${Math.random()}` },
    });
    return { token, userId, profile };
  }

  const templateBody = {
    title: 'استبيان المتابعة الأسبوعي',
    description: 'يملؤه المريض أسبوعيًا',
    questions: [
      { text: 'كيف تقيّم طلاقتك هذا الأسبوع؟', type: 'SCALE' as const },
      { text: 'هل واجهت مواقف صعبة؟', type: 'SINGLE_CHOICE' as const, options: ['نعم', 'لا'] },
      { text: 'ملاحظات إضافية', type: 'TEXT' as const, required: false },
    ],
  };

  it('lets a clinician create a template and a patient list + answer it', async () => {
    const { token, profile } = await setupPatient('+966500008000');
    const { token: clinicianToken } = await registerAndLogin(app, prisma, '+966500008001', 'CLINICIAN');

    const created = await request(app.getHttpServer())
      .post('/api/v1/questionnaire-templates')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send(templateBody)
      .expect(201);
    expect(created.body.questions).toHaveLength(3);
    expect(created.body.questions[0].order).toBe(0);

    // Patient sees the active template.
    const templates = await request(app.getHttpServer())
      .get('/api/v1/questionnaire-templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(templates.body).toHaveLength(1);
    const template = templates.body[0];

    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/questionnaire-responses`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        templateId: template.id,
        answers: [
          { questionId: template.questions[0].id, value: '7' },
          { questionId: template.questions[1].id, value: 'نعم' },
        ],
      })
      .expect(201);
    expect(submitted.body.answers).toHaveLength(2);

    // Clinician reads the patient's responses.
    const responses = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/questionnaire-responses`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);
    expect(responses.body).toHaveLength(1);
    expect(responses.body[0].template.title).toBe('استبيان المتابعة الأسبوعي');
  });

  it('rejects a response missing a required answer', async () => {
    const { token, profile } = await setupPatient('+966500008010');
    const { token: clinicianToken } = await registerAndLogin(app, prisma, '+966500008011', 'CLINICIAN');

    const created = await request(app.getHttpServer())
      .post('/api/v1/questionnaire-templates')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send(templateBody)
      .expect(201);

    // Answer only the optional TEXT question, skip the two required ones.
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/questionnaire-responses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ templateId: created.body.id, answers: [{ questionId: created.body.questions[2].id, value: 'x' }] })
      .expect(400);
  });

  it('rejects answering a deactivated template', async () => {
    const { token, profile } = await setupPatient('+966500008020');
    const { token: clinicianToken } = await registerAndLogin(app, prisma, '+966500008021', 'CLINICIAN');

    const created = await request(app.getHttpServer())
      .post('/api/v1/questionnaire-templates')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send(templateBody)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/questionnaire-templates/${created.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ isActive: false })
      .expect(200);

    // Patient no longer sees it in the active list.
    const templates = await request(app.getHttpServer())
      .get('/api/v1/questionnaire-templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(templates.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/questionnaire-responses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ templateId: created.body.id, answers: [{ questionId: created.body.questions[0].id, value: '5' }, { questionId: created.body.questions[1].id, value: 'لا' }] })
      .expect(400);
  });

  it('forbids a patient from creating a template', async () => {
    const { token } = await setupPatient('+966500008030');

    await request(app.getHttpServer())
      .post('/api/v1/questionnaire-templates')
      .set('Authorization', `Bearer ${token}`)
      .send(templateBody)
      .expect(403);
  });

  it('logs who viewed a patient questionnaire responses (a PHI-marked GET)', async () => {
    const { token, profile, userId } = await setupPatient('+966500008040');

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/questionnaire-responses`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const logs = await waitForAuditLogs(prisma, {
      action: `GET /api/v1/patients/${profile.id}/questionnaire-responses`,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(userId);
    expect(logs[0].entityId).toBe(profile.id);
    expect(logs[0].entity).toBe('questionnaires');
  });
});
