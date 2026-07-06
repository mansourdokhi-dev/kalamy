import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Treatment Plans: create, list, get active', () => {
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

  async function setUpPatientWithApprovedAssessment(clinicianToken: string, patientMobile: string, nationalId: string) {
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Plan Test Patient',
      mobile: patientMobile,
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: patientMobile, code: patientRegister.body.devOtpCode });
    const profileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'Plan Test Patient',
        gender: 'MALE',
        dateOfBirth: '1990-01-01',
        nationalId,
      });
    const assessmentResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/assessments/${assessmentResponse.body.id}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MODERATE' });
    return {
      profileId: profileResponse.body.id,
      assessmentId: assessmentResponse.body.id,
      patientMobile,
      patientUserId: patientRegister.body.userId,
    };
  }

  it('lets a CLINICIAN create a treatment plan from an approved assessment', async () => {
    const clinicianToken = await createClinicianToken('+966500000400', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000401',
      'PLAN-TEST-1',
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'Reduce stuttering frequency in daily conversation', reviewDate: '2026-08-01' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.phase).toBe('PHASE_1');
  });

  it('rejects creating a plan from an unapproved (draft) assessment', async () => {
    const clinicianToken = await createClinicianToken('+966500000402', 'password123');
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Draft Plan Patient',
      mobile: '+966500000403',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000403', code: patientRegister.body.devOtpCode });
    const profileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'Draft Plan Patient',
        gender: 'MALE',
        dateOfBirth: '1990-01-01',
        nationalId: 'PLAN-TEST-2',
      });
    const draftAssessment = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId: draftAssessment.body.id, goals: 'Should not be allowed', reviewDate: '2026-08-01' });

    expect(response.status).toBe(400);
  });

  it('deactivates the prior plan when a new plan is created for the same patient', async () => {
    const clinicianToken = await createClinicianToken('+966500000404', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000405',
      'PLAN-TEST-3',
    );
    const firstPlanResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'First plan', reviewDate: '2026-08-01' });

    const secondAssessment = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'PERIODIC' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${secondAssessment.body.id}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MILD' });
    const secondPlanResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId: secondAssessment.body.id, goals: 'Second plan', reviewDate: '2026-09-01' });

    expect(secondPlanResponse.status).toBe(201);
    expect(secondPlanResponse.body.status).toBe('ACTIVE');

    const activeResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/treatment-plans/active`)
      .set('Authorization', `Bearer ${clinicianToken}`);
    expect(activeResponse.body.id).toBe(secondPlanResponse.body.id);

    const listResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`);
    const firstPlanInList = listResponse.body.find((p: { id: string }) => p.id === firstPlanResponse.body.id);
    expect(firstPlanInList.status).toBe('INACTIVE');
  });

  it('rejects a PATIENT trying to create a treatment plan', async () => {
    const clinicianToken = await createClinicianToken('+966500000406', 'password123');
    const { profileId, assessmentId, patientMobile } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000407',
      'PLAN-TEST-4',
    );
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: patientMobile, password: 'password123' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${patientLogin.body.token}`)
      .send({ assessmentId, goals: 'Should not be allowed', reviewDate: '2026-08-01' });

    expect(response.status).toBe(403);
  });

  it('lets a CLINICIAN update plan goals and review date', async () => {
    const clinicianToken = await createClinicianToken('+966500000410', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000411',
      'PLAN-UPD-1',
    );
    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'Original goal', reviewDate: '2026-08-01' });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ goals: 'Updated goal' });

    expect(response.status).toBe(200);
    expect(response.body.goals).toBe('Updated goal');
  });

  it('records a clinician-driven phase transition and updates the plan phase', async () => {
    const clinicianToken = await createClinicianToken('+966500000412', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000413',
      'PLAN-UPD-2',
    );
    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'Goal', reviewDate: '2026-08-01' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/phase-transition`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ toPhase: 'PHASE_2', rationale: 'Patient met Phase 1 success indicators' });

    expect(response.status).toBe(201);
    expect(response.body.phase).toBe('PHASE_2');
  });

  it('rejects a PATIENT trying to record a phase transition', async () => {
    const clinicianToken = await createClinicianToken('+966500000414', 'password123');
    const { profileId, assessmentId, patientMobile } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000415',
      'PLAN-UPD-3',
    );
    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'Goal', reviewDate: '2026-08-01' });
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: patientMobile, password: 'password123' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/phase-transition`)
      .set('Authorization', `Bearer ${patientLogin.body.token}`)
      .send({ toPhase: 'PHASE_2' });

    expect(response.status).toBe(403);
  });

  it('links an exercise to a treatment plan', async () => {
    const clinicianToken = await createClinicianToken('+966500000420', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000421',
      'PLAN-EX-1',
    );
    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'Goal', reviewDate: '2026-08-01' });
    const exerciseResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        title: 'Linked Exercise',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ exerciseId: exerciseResponse.body.id, frequencyPerWeek: 3, sequence: 1 });

    expect(response.status).toBe(201);
    expect(response.body.frequencyPerWeek).toBe(3);
  });

  it('lists exercises linked to a treatment plan', async () => {
    const clinicianToken = await createClinicianToken('+966500000422', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000423',
      'PLAN-EX-2',
    );
    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'Goal', reviewDate: '2026-08-01' });
    const exerciseResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        title: 'Listed Exercise',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ exerciseId: exerciseResponse.body.id, frequencyPerWeek: 2, sequence: 1 });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].exercise.title).toBe('Listed Exercise');
  });

  it('rejects linking the same exercise to a plan twice', async () => {
    const clinicianToken = await createClinicianToken('+966500000424', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000425',
      'PLAN-EX-3',
    );
    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'Goal', reviewDate: '2026-08-01' });
    const exerciseResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        title: 'Duplicate-Link Exercise',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ exerciseId: exerciseResponse.body.id, frequencyPerWeek: 2, sequence: 1 });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ exerciseId: exerciseResponse.body.id, frequencyPerWeek: 4, sequence: 2 });

    expect(response.status).toBe(409);
  });

  it('unlinks an exercise from a treatment plan', async () => {
    const clinicianToken = await createClinicianToken('+966500000426', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithApprovedAssessment(
      clinicianToken,
      '+966500000427',
      'PLAN-EX-4',
    );
    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId, goals: 'Goal', reviewDate: '2026-08-01' });
    const exerciseResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        title: 'Unlink-Me Exercise',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ exerciseId: exerciseResponse.body.id, frequencyPerWeek: 2, sequence: 1 });

    const response = await request(app.getHttpServer())
      .delete(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises/${exerciseResponse.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);

    const listResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${clinicianToken}`);
    expect(listResponse.body).toHaveLength(0);
  });
});
