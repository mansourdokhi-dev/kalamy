import { INestApplication } from '@nestjs/common';
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
