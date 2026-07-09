import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reports + Complaints: full smoke test', () => {
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

  it('walks a complaint from submission through status update, the complaints report, and the staff-performance report', async () => {
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Smoke Test Clinician',
      mobile: '+966500001400',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001400', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500001400' }, data: { role: 'CLINICIAN' } });
    const clinicianUserId = clinicianRegister.body.userId;

    const adminRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Smoke Test Admin',
      mobile: '+966500001401',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001401', code: adminRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500001401' }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500001401', password: 'password123' });
    const adminToken = adminLogin.body.token;

    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Smoke Test Patient',
      mobile: '+966500001402',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001402', code: patientRegister.body.devOtpCode });
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500001402', password: 'password123' });
    const patientToken = patientLogin.body.token;

    const complaintResponse = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        type: 'COMPLAINT',
        subject: 'Smoke test complaint',
        description: 'End-to-end smoke test complaint.',
        relatedClinicianUserId: clinicianUserId,
      });
    expect(complaintResponse.status).toBe(201);

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/complaints')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);

    const statusResponse = await request(app.getHttpServer())
      .patch(`/api/v1/complaints/${complaintResponse.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REVIEWED' });
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.status).toBe('REVIEWED');

    const complaintsReportResponse = await request(app.getHttpServer())
      .get('/api/v1/reports/complaints')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(complaintsReportResponse.status).toBe(200);
    expect(complaintsReportResponse.body[0].status).toBe('REVIEWED');

    const performanceResponse = await request(app.getHttpServer())
      .get('/api/v1/reports/staff-performance')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(performanceResponse.status).toBe(200);
    const clinicianSummary = performanceResponse.body.find(
      (s: { clinicianUserId: string }) => s.clinicianUserId === clinicianUserId,
    );
    expect(clinicianSummary.complaintsAgainst).toBe(1);

    const operationalStatusResponse = await request(app.getHttpServer())
      .get('/api/v1/reports/operational-status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(operationalStatusResponse.status).toBe(200);
    expect(operationalStatusResponse.body.usersByRole.PATIENT).toBe(1);
  });

  it('operational status report groups training cycles by the new 13-state LevelCycleStatus, not the old 4-state SessionStatus', async () => {
    const adminRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Ops Report Admin',
      mobile: '+966500001410',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001410', code: adminRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500001410' }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500001410', password: 'password123' });
    const adminToken = adminLogin.body.token;
    const adminUserId = adminRegister.body.userId;

    const patientUserRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Ops Report Patient',
      mobile: '+966500001411',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001411', code: patientUserRegister.body.devOtpCode });
    const patientUserId = patientUserRegister.body.userId;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Ops Report Patient Profile',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'OPS-REPORT-TEST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: adminUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: adminUserId,
        assessmentId: assessment.id,
        goals: 'g',
        reviewDate: new Date(),
      },
    });
    const level = await prisma.level.create({ data: { name: 'Ops Report Level', order: 1 } });
    const levelVersion = await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: levelVersion.id,
        cycleNumber: 1,
        status: 'ACTIVE_LEVEL_TRAINING',
      },
    });
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: levelVersion.id,
        cycleNumber: 2,
        status: 'WAITING_FOR_SPECIALIST',
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/operational-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.trainingCyclesByStatus).toHaveProperty('ACTIVE_LEVEL_TRAINING');
    expect(res.body.trainingCyclesByStatus).toHaveProperty('WAITING_FOR_SPECIALIST');
    expect(res.body.trainingCyclesByStatus).not.toHaveProperty('IN_TRAINING'); // the old enum value must be gone
  });

  it('staff performance report counts TRANSITION and LEVEL_REPEAT decisions on SpeechSample, not PatientSession', async () => {
    const adminRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Staff Report Admin',
      mobile: '+966500001420',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001420', code: adminRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500001420' }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500001420', password: 'password123' });
    const adminToken = adminLogin.body.token;

    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Staff Report Clinician',
      mobile: '+966500001421',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001421', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500001421' }, data: { role: 'CLINICIAN' } });
    const clinicianUserId = clinicianRegister.body.userId;

    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Staff Report Patient',
      mobile: '+966500001422',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001422', code: patientRegister.body.devOtpCode });
    const patientUserId = patientRegister.body.userId;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Staff Report Patient Profile',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'STAFF-REPORT-TEST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Staff Report Level', order: 1 } });
    const levelVersion = await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const transitionCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: levelVersion.id,
        cycleNumber: 1,
        status: 'NEXT_LEVEL_APPROVED',
      },
    });
    await prisma.speechSample.create({
      data: {
        trainingCycleId: transitionCycle.id,
        submittedAt: new Date(),
        reviewedByUserId: clinicianUserId,
        decision: 'TRANSITION',
        reviewedAt: new Date(),
      },
    });

    const repeatCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: levelVersion.id,
        cycleNumber: 2,
        status: 'LEVEL_REPEAT_DECIDED',
      },
    });
    await prisma.speechSample.create({
      data: {
        trainingCycleId: repeatCycle.id,
        submittedAt: new Date(),
        reviewedByUserId: clinicianUserId,
        decision: 'LEVEL_REPEAT',
        reviewedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/staff-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const entry = res.body.find((s: { clinicianUserId: string }) => s.clinicianUserId === clinicianUserId);
    expect(entry.reviewsApproved).toBe(1);
    expect(entry.reviewsRepeatRequired).toBe(1);
  });
});
