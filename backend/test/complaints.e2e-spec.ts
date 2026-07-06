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
