import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Database connectivity', () => {
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

  it('can create and read a User row', async () => {
    const user = await prisma.user.create({
      data: {
        fullName: 'Test User',
        mobile: '+966500000001',
        passwordHash: 'irrelevant-for-this-test',
        role: 'PATIENT',
      },
    });

    const found = await prisma.user.findUnique({ where: { id: user.id } });
    expect(found?.mobile).toBe('+966500000001');
  });
});
