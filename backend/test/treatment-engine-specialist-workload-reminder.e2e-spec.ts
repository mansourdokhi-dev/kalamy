import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { SpecialistWorkloadReminderSweepService } from '../src/modules/treatment-engine/specialist-workload-reminder-sweep.service';

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

async function createSubmittedSampleCycle(prisma: PrismaService, patientProfileId: string, treatmentPlanId: string) {
  const level = await prisma.level.create({ data: { name: `Level ${Date.now()}`, order: Math.floor(Math.random() * 100000) } });
  const levelVersion = await prisma.levelVersion.create({
    data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
  });
  const cycle = await prisma.trainingCycle72h.create({
    data: { patientProfileId, treatmentPlanId, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
  });
  const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
  return { cycle, sample };
}

describe('Specialist Workload Reminder sweep (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweepService: SpecialistWorkloadReminderSweepService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sweepService = app.get(SpecialistWorkloadReminderSweepService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function setupReservedSample(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Workload Reminder Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `WORKLOAD-${Date.now()}-${Math.random()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    return { clinicianToken, clinicianUserId, patientToken, patientProfile, cycleId: cycle.id, sampleId: sample.id };
  }

  it('sends a reminder once the review-decision deadline is within its 24h lead window', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006000', '+966500006001');
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 18 * 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('تذكير: مراجعة عينة متأخرة');
    const updatedSample = await prisma.speechSample.findUniqueOrThrow({ where: { id: sampleId } });
    expect(updatedSample.deadlineReminderSentAt).not.toBeNull();
  });

  it('does not send a reminder before the 24h lead window opens', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006002', '+966500006003');
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 40 * 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a reminder once the review-decision deadline has already passed', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006004', '+966500006005');
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() - 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a second reminder on a repeated sweep for the same active deadline', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006006', '+966500006007');
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 18 * 60 * 60 * 1000) } });

    await sweepService.runSweep();
    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(1);
  });

  it('sends an intervention-worded reminder once the 7-day intervention deadline is within its 24h lead window', async () => {
    const { clinicianToken, clinicianUserId, cycleId, sampleId } = await setupReservedSample('+966500006008', '+966500006009');
    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycleId}/intervention`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ interventionType: 'VIDEO_MEETING', reasonNote: 'Need to observe the patient directly' })
      .expect(201);
    await prisma.speechSample.update({ where: { id: sampleId }, data: { interventionDeadlineAt: new Date(Date.now() + 18 * 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('تذكير: تدخل مباشر متأخر');
  });

  it('re-arms and reminds the new specialist after a transfer, even if the old specialist was already reminded', async () => {
    const { clinicianUserId: clinicianAUserId, cycleId, sampleId } = await setupReservedSample('+966500006010', '+966500006011');
    const supervisorToken = await registerAndLogin(app, prisma, '+966500006012', 'SUPERVISOR');
    await registerAndLogin(app, prisma, '+966500006013', 'CLINICIAN');
    const clinicianBUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500006013' } })).id;
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 18 * 60 * 60 * 1000) } });

    await sweepService.runSweep();
    let notifications = await prisma.notification.findMany({ where: { type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipientUserId).toBe(clinicianAUserId);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycleId}/transfer`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ toUserId: clinicianBUserId, reason: 'Clinician A is on leave' })
      .expect(201);

    await sweepService.runSweep();
    notifications = await prisma.notification.findMany({ where: { type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(2);
    expect(notifications.some((n) => n.recipientUserId === clinicianBUserId)).toBe(true);
  });

  it('does not send a reminder for an unreserved sample (the §103/24h-escalation path stays untouched)', async () => {
    await registerAndLogin(app, prisma, '+966500006015', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500006015' } })).id;
    await registerAndLogin(app, prisma, '+966500006014', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500006014' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Unreserved Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `UNRESERVED-${Date.now()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id);

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('uses an admin-configured review lead time instead of the hardcoded default', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006016', '+966500006017');
    // 30h remaining on the 48h deadline — outside the hardcoded 24h default's lead window, so a
    // sweep against the default sends nothing yet.
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 30 * 60 * 60 * 1000) } });

    await sweepService.runSweep();
    const notificationsBefore = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notificationsBefore).toHaveLength(0);

    // Widen the lead time to 36h (still under the 48h window cap) — the same 30h-remaining
    // deadline now falls inside the window, without moving the deadline itself.
    const adminToken = await registerAndLogin(app, prisma, '+966500006018', 'ADMIN');
    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/SPECIALIST_WORKLOAD_REVIEW_LEAD_MS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 36 * 60 * 60 * 1000 })
      .expect(200);

    await sweepService.runSweep();

    const notificationsAfter = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notificationsAfter).toHaveLength(1);
  });
});
