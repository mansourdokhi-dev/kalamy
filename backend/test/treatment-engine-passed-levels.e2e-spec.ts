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

describe('Treatment Engine — Review Previous Levels (e2e)', () => {
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

  it('lists only levels passed via a TRANSITION decision, excluding repeats and unreached levels', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003001', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003000' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003001' } })).id,
        fullName: 'Passed Levels Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });

    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const level1Version = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const level2 = await prisma.level.create({ data: { name: 'Level 2', order: 2 } });
    const level2Version = await prisma.levelVersion.create({
      data: { levelId: level2.id, versionNumber: 1, behavioralTechnique: 'y', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await prisma.level.create({ data: { name: 'Level 3', order: 3 } });

    // Level 1: passed
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level1.id, levelVersionId: level1Version.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date('2026-01-01'),
      },
    });
    // Level 2: repeated once (not passed), then currently active (not passed either)
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level2.id, levelVersionId: level2Version.id,
        cycleNumber: 1, status: 'LEVEL_REPEAT_DECIDED', closedAt: new Date('2026-01-05'),
      },
    });
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level2.id, levelVersionId: level2Version.id,
        cycleNumber: 2, status: 'ACTIVE_LEVEL_TRAINING',
      },
    });
    // Level 3: never touched

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/passed`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      levelId: level1.id,
      levelName: 'Level 1',
      order: 1,
      levelVersionId: level1Version.id,
    });
  });

  it('dedupes a level passed twice (e.g. across two independent paths) to its most recently passed cycle', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003002', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003003', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003002' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003003' } })).id,
        fullName: 'Dedupe Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-2',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const planA = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const planB = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g2', reviewDate: new Date() },
    });

    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const olderVersion = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'old-path', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const newerVersion = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 2, behavioralTechnique: 'new-path', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    // Older path passed Level 1 first
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: planA.id, levelId: level1.id, levelVersionId: olderVersion.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date('2026-01-01'),
      },
    });
    // Newer path (post-restart) passed Level 1 again, later
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: planB.id, levelId: level1.id, levelVersionId: newerVersion.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date('2026-02-01'),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/passed`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].levelVersionId).toBe(newerVersion.id);
  });

  it('rejects a different patient from listing another patient\'s passed levels', async () => {
    const patientAToken = await registerAndLogin(app, prisma, '+966500003005', null);
    await registerAndLogin(app, prisma, '+966500003006', null);

    const patientBProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003006' } })).id,
        fullName: 'Patient B',
        gender: 'FEMALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-3',
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientBProfile.id}/levels/passed`)
      .set('Authorization', `Bearer ${patientAToken}`)
      .expect(403);
  });

  it("returns the exact LevelVersion the patient's own passed cycle used, not the level's current active version", async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003007', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003008', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003007' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003008' } })).id,
        fullName: 'Review Content Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-4',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });

    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const trainedVersion = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'technique-patient-trained-on', trainingListJson: '["item-a"]', samplePartTemplateJson: '[]', publishedAt: new Date('2026-01-01') },
    });
    // A newer, currently-active version was published after this patient passed the level.
    await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 2, behavioralTechnique: 'technique-updated-later', trainingListJson: '["item-b"]', samplePartTemplateJson: '[]', publishedAt: new Date('2026-02-01') },
    });

    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level1.id, levelVersionId: trainedVersion.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date('2026-01-15'),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/${level1.id}/review`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.id).toBe(trainedVersion.id);
    expect(res.body.behavioralTechnique).toBe('technique-patient-trained-on');
  });

  it('returns 404 when reviewing a level the patient has not passed', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003009', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003010', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003009' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003010' } })).id,
        fullName: 'Never Passed Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-5',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/${level1.id}/review`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(404);
  });

  it("allows a CLINICIAN to review any patient's passed level", async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003011', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003011' } })).id;
    await registerAndLogin(app, prisma, '+966500003012', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003012' } })).id,
        fullName: 'Staff View Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-6',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level1.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/${level1.id}/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);
  });
});
