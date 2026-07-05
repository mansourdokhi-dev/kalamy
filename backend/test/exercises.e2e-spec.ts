import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Exercise schema smoke test', () => {
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

  it('can create and read an Exercise row', async () => {
    const clinician = await prisma.user.create({
      data: {
        fullName: 'Schema Test Clinician',
        mobile: '+966500000200',
        passwordHash: 'irrelevant-for-this-test',
        role: 'CLINICIAN',
        status: 'ACTIVE',
      },
    });

    const exercise = await prisma.exercise.create({
      data: {
        title: 'Diaphragmatic Breathing',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'Breathe in slowly through the nose for 4 counts.',
        durationMinutes: 5,
        createdByUserId: clinician.id,
      },
    });

    const found = await prisma.exercise.findUnique({ where: { id: exercise.id } });
    expect(found?.title).toBe('Diaphragmatic Breathing');
    expect(found?.status).toBe('ACTIVE');
  });
});

describe('Exercises: create, list, get', () => {
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

  async function createClinicianToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'CLINICIAN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lets a CLINICIAN create an exercise', async () => {
    const token = await createClinicianToken('+966500000210', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Easy Onset Practice',
        category: 'Fluency Shaping',
        phaseLevel: 2,
        instructions: 'Start phonation gently, without tension.',
        durationMinutes: 10,
      });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe('Easy Onset Practice');
    expect(response.body.status).toBe('ACTIVE');
  });

  it('rejects a PATIENT trying to create an exercise', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile: '+966500000211',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000211', code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000211', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${loginResponse.body.token}`)
      .send({
        title: 'Should Not Be Created',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });

    expect(response.status).toBe(403);
  });

  it('filters exercises by phase', async () => {
    const token = await createClinicianToken('+966500000212', 'password123');

    await request(app.getHttpServer()).post('/api/v1/exercises').set('Authorization', `Bearer ${token}`).send({
      title: 'Phase 1 Exercise',
      category: 'Breathing',
      phaseLevel: 1,
      instructions: 'N/A',
      durationMinutes: 5,
    });
    await request(app.getHttpServer()).post('/api/v1/exercises').set('Authorization', `Bearer ${token}`).send({
      title: 'Phase 3 Exercise',
      category: 'Fluency Shaping',
      phaseLevel: 3,
      instructions: 'N/A',
      durationMinutes: 5,
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/exercises?phase=1')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].title).toBe('Phase 1 Exercise');
  });

  it('gets a single exercise by id', async () => {
    const token = await createClinicianToken('+966500000213', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Retrievable Exercise',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/exercises/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Retrievable Exercise');
  });

  it('returns 404 for a nonexistent exercise', async () => {
    const token = await createClinicianToken('+966500000214', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/exercises/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });
});
