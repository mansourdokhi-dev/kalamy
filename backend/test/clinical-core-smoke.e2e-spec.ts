import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Smoke test: full clinical journey from assessment to a plan with exercises', () => {
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

  it('walks a patient from an approved assessment to an active plan with linked exercises', async () => {
    // 1. Seed a clinician
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Dr. Layla Al-Qahtani',
      mobile: '+966500000500',
      password: 'clinician-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000500', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500000500' }, data: { role: 'CLINICIAN' } });
    const clinicianLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000500', password: 'clinician-pass1' });
    const clinicianToken = clinicianLogin.body.token;

    // 2. Register an adult patient and create their clinical profile
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Fahad Al-Dossari',
      mobile: '+966500000501',
      password: 'patient-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000501', code: patientRegister.body.devOtpCode });
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000501', password: 'patient-pass1' });
    const patientToken = patientLogin.body.token;

    const profileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'Fahad Al-Dossari',
        gender: 'MALE',
        dateOfBirth: '1988-04-12',
        nationalId: 'SMOKE-CLINICAL-1',
      });
    const profileId = profileResponse.body.id;

    // 3. Create, score, and approve an initial assessment
    const assessmentResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });
    await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/assessments/${assessmentResponse.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ ssi4Frequency: 14, ssi4Duration: 3, ssi4PhysicalConcomitants: 2, ssi4Total: 19 });
    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentResponse.body.id}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MODERATE' });
    expect(approveResponse.status).toBe(201);

    // 4. Create a treatment plan from the approved assessment
    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId: assessmentResponse.body.id, goals: 'Establish baseline fluency skills', reviewDate: '2026-09-01' });
    expect(planResponse.status).toBe(201);
    expect(planResponse.body.phase).toBe('PHASE_1');

    // 5. Create a Phase 1 exercise and link it to the plan
    const exerciseResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        title: 'Diaphragmatic Breathing',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'Breathe in slowly through the nose for 4 counts, out for 6.',
        durationMinutes: 5,
      });
    const linkResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ exerciseId: exerciseResponse.body.id, frequencyPerWeek: 5, sequence: 1 });
    expect(linkResponse.status).toBe(201);

    // 6. The patient can view their own active plan and its linked exercises
    const activePlanView = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/treatment-plans/active`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(activePlanView.status).toBe(200);
    expect(activePlanView.body.id).toBe(planResponse.body.id);

    const exercisesView = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(exercisesView.status).toBe(200);
    expect(exercisesView.body[0].exercise.title).toBe('Diaphragmatic Breathing');

    // 7. Record a phase transition and confirm both the plan and the history are updated
    const transitionResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans/${planResponse.body.id}/phase-transition`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ toPhase: 'PHASE_2', rationale: 'Patient demonstrated consistent breath control' });
    expect(transitionResponse.status).toBe(201);
    expect(transitionResponse.body.phase).toBe('PHASE_2');

    // 8. Every mutating step was audit-logged
    const auditActions = (await prisma.auditLog.findMany()).map((log) => log.action);
    expect(auditActions).toEqual(
      expect.arrayContaining([
        'POST /api/v1/patients',
        expect.stringContaining('/assessments'),
        expect.stringContaining('/treatment-plans'),
        'POST /api/v1/exercises',
      ]),
    );
  });
});
