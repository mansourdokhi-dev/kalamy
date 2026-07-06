import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('SessionTemplate schema smoke test', () => {
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

  it('can create and read a SessionTemplate row', async () => {
    const template = await prisma.sessionTemplate.create({
      data: {
        sessionNumber: 1,
        category: 1,
        trainingDurationDays: 3,
        instructions: 'Extend a single vowel sound for 5 seconds while opening and closing your hand.',
      },
    });

    const found = await prisma.sessionTemplate.findUnique({ where: { id: template.id } });
    expect(found?.sessionNumber).toBe(1);
    expect(found?.trainingDurationDays).toBe(3);
  });
});

describe('Session Templates: create, list, get, update', () => {
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

  it('lets a CLINICIAN create a session template', async () => {
    const token = await createClinicianToken('+966500000600', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionNumber: 1,
        category: 1,
        trainingDurationDays: 3,
        instructions: 'Extend a vowel sound for 5 seconds while opening and closing your hand.',
      });

    expect(response.status).toBe(201);
    expect(response.body.sessionNumber).toBe(1);
  });

  it('rejects a PATIENT trying to create a session template', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile: '+966500000601',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000601', code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000601', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${loginResponse.body.token}`)
      .send({
        sessionNumber: 2,
        category: 1,
        trainingDurationDays: 3,
        instructions: 'Should not be created.',
      });

    expect(response.status).toBe(403);
  });

  it('lists session templates ordered by sessionNumber', async () => {
    const token = await createClinicianToken('+966500000602', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${token}`).send({
      sessionNumber: 2,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 2 instructions.',
    });
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${token}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/session-templates')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.map((t: { sessionNumber: number }) => t.sessionNumber)).toEqual([1, 2]);
  });

  it('gets a single session template by id', async () => {
    const token = await createClinicianToken('+966500000603', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionNumber: 5,
        category: 2,
        trainingDurationDays: 4,
        instructions: 'Retrievable template.',
      });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/session-templates/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.instructions).toBe('Retrievable template.');
  });

  it('lets a CLINICIAN update a session template', async () => {
    const token = await createClinicianToken('+966500000604', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionNumber: 10,
        category: 4,
        trainingDurationDays: 3,
        instructions: 'Original instructions.',
      });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/session-templates/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ instructions: 'Updated instructions.' });

    expect(response.status).toBe(200);
    expect(response.body.instructions).toBe('Updated instructions.');
  });
});
