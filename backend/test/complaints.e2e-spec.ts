import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Complaint schema smoke test', () => {
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

  it('can create and read a Complaint row', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Complaint Schema Patient',
      mobile: '+966500000900',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000900', code: registerResponse.body.devOtpCode });

    const complaint = await prisma.complaint.create({
      data: {
        submittedByUserId: registerResponse.body.userId,
        type: 'COMPLAINT',
        subject: 'Late clinician review',
        description: 'My session review took over a week.',
      },
    });

    const found = await prisma.complaint.findUnique({ where: { id: complaint.id } });
    expect(found?.status).toBe('OPEN');
    expect(found?.subject).toBe('Late clinician review');
  });
});

describe('Complaints: submit, list, get', () => {
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

  async function createUserToken(
    mobile: string,
    password: string,
    role: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN',
  ): Promise<{ token: string; userId: string }> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Complaint Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return { token: loginResponse.body.token, userId: registerResponse.body.userId };
  }

  it('lets a PATIENT submit a complaint', async () => {
    const { token } = await createUserToken('+966500000901', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'COMPLAINT', subject: 'Slow response', description: 'The clinician took 10 days to respond.' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('OPEN');
    expect(response.body.type).toBe('COMPLAINT');
  });

  it('rejects a CLINICIAN submitting a complaint', async () => {
    const { token } = await createUserToken('+966500000902', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'SUGGESTION', subject: 'Add dark mode', description: 'Would help night use.' });

    expect(response.status).toBe(403);
  });

  it('404s when relatedClinicianUserId does not exist', async () => {
    const { token } = await createUserToken('+966500000903', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'COMPLAINT',
        subject: 'Unresponsive clinician',
        description: 'No answer in two weeks.',
        relatedClinicianUserId: '00000000-0000-0000-0000-000000000000',
      });

    expect(response.status).toBe(404);
  });

  it('lets an ADMIN list and filter complaints by status', async () => {
    const { token: adminToken } = await createUserToken('+966500000904', 'password123', 'ADMIN');
    const { token: patientToken } = await createUserToken('+966500000905', 'password123', 'PATIENT');
    await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ type: 'COMPLAINT', subject: 'Issue A', description: 'Description A' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/complaints?status=OPEN')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].subject).toBe('Issue A');
  });

  it('rejects a PATIENT listing all complaints', async () => {
    const { token } = await createUserToken('+966500000906', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer()).get('/api/v1/complaints').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('lets the original submitter view their own complaint', async () => {
    const { token } = await createUserToken('+966500000907', 'password123', 'PATIENT');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'COMPLAINT', subject: 'Issue B', description: 'Description B' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/complaints/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.subject).toBe('Issue B');
  });

  it("rejects an unrelated PATIENT viewing someone else's complaint", async () => {
    const { token: submitterToken } = await createUserToken('+966500000908', 'password123', 'PATIENT');
    const { token: otherToken } = await createUserToken('+966500000909', 'password123', 'PATIENT');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${submitterToken}`)
      .send({ type: 'COMPLAINT', subject: 'Issue C', description: 'Description C' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/complaints/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
  });
});
