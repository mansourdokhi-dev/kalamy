import { INestApplication } from '@nestjs/common';
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
