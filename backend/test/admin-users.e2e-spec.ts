import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('User schema: mustChangePassword + supervisorUserId', () => {
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

  it('defaults mustChangePassword to false and supervisorUserId to null, and supports assigning a supervisor', async () => {
    const clinician = await prisma.user.create({
      data: {
        fullName: 'Schema Test Clinician',
        mobile: '+966500002000',
        passwordHash: 'x',
        role: 'CLINICIAN',
        status: 'ACTIVE',
      },
    });
    expect(clinician.mustChangePassword).toBe(false);
    expect(clinician.supervisorUserId).toBeNull();

    const supervisor = await prisma.user.create({
      data: {
        fullName: 'Schema Test Supervisor',
        mobile: '+966500002001',
        passwordHash: 'x',
        role: 'SUPERVISOR',
        status: 'ACTIVE',
      },
    });

    const updated = await prisma.user.update({
      where: { id: clinician.id },
      data: { supervisorUserId: supervisor.id },
    });
    expect(updated.supervisorUserId).toBe(supervisor.id);
  });
});
