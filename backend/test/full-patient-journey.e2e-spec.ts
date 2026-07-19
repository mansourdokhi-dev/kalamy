import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

// End-to-end walk of the whole gated patient pipeline, driven through the real
// HTTP API exactly as the apps would: registration → OTP verify → login →
// clinical profile → assessment (score + approve) → treatment plan → level
// setup → 72h training cycle → daily training → speech-sample recording +
// submission → specialist TRANSITION review → final medical report.
//
// The one shortcut is fast-forwarding the cycle's status to SAMPLE_ELIGIBLE via
// Prisma instead of letting 72 hours of real calendar time elapse — the same
// technique every treatment-engine e2e spec uses, since the gate is wall-clock
// based and cannot be advanced through the API.
describe('Full patient journey (e2e): registration → final report', () => {
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

  const http = () => app.getHttpServer();

  it('carries one patient from account creation all the way to a generated medical report', async () => {
    // ── Stage 1: clinician account (register → verify → promote → login) ──────
    const clinicianReg = await request(http())
      .post('/api/v1/auth/register')
      .send({ fullName: 'د. ليلى القحطاني', mobile: '+966555000001', password: 'clinician-pass1', role: 'PATIENT' })
      .expect(201);
    await request(http()).post('/api/v1/auth/verify').send({ mobile: '+966555000001', code: clinicianReg.body.devOtpCode }).expect(201);
    await prisma.user.update({ where: { mobile: '+966555000001' }, data: { role: 'CLINICIAN' } });
    const clinicianToken = (await request(http()).post('/api/v1/auth/login').send({ mobile: '+966555000001', password: 'clinician-pass1' }).expect(200)).body.token;
    const clinicianAuth = { Authorization: `Bearer ${clinicianToken}` };

    // ── Stage 2: patient registers with consent, verifies OTP, logs in ────────
    const patientReg = await request(http())
      .post('/api/v1/auth/register')
      .send({ fullName: 'فهد الدوسري', mobile: '+966555000002', password: 'patient-pass1', role: 'PATIENT', acceptedTerms: true })
      .expect(201);
    await request(http()).post('/api/v1/auth/verify').send({ mobile: '+966555000002', code: patientReg.body.devOtpCode }).expect(201);
    const patientToken = (await request(http()).post('/api/v1/auth/login').send({ mobile: '+966555000002', password: 'patient-pass1' }).expect(200)).body.token;
    const patientAuth = { Authorization: `Bearer ${patientToken}` };

    // consent was recorded at registration
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966555000002' } });
    expect(patientUser.termsAcceptedAt).not.toBeNull();

    // ── Stage 3: clinician creates the clinical profile ───────────────────────
    const profile = (await request(http())
      .post('/api/v1/patients')
      .set(clinicianAuth)
      .send({ userId: patientReg.body.userId, fullName: 'فهد الدوسري', gender: 'MALE', dateOfBirth: '1990-05-20', nationalId: 'JOURNEY-1' })
      .expect(201)).body;
    const pid = profile.id;

    // ── Stage 4: initial assessment — create, score (SSI-4), approve ──────────
    const assessment = (await request(http())
      .post(`/api/v1/patients/${pid}/assessments`)
      .set(clinicianAuth)
      .send({ type: 'INITIAL' })
      .expect(201)).body;
    await request(http())
      .put(`/api/v1/patients/${pid}/assessments/${assessment.id}`)
      .set(clinicianAuth)
      .send({ ssi4Frequency: 14, ssi4Duration: 3, ssi4PhysicalConcomitants: 2, ssi4Total: 19 })
      .expect(200);
    await request(http())
      .post(`/api/v1/patients/${pid}/assessments/${assessment.id}/approve`)
      .set(clinicianAuth)
      .send({ severityCategory: 'MODERATE' })
      .expect(201);

    // ── Stage 5: treatment plan from the approved assessment ──────────────────
    const plan = (await request(http())
      .post(`/api/v1/patients/${pid}/treatment-plans`)
      .set(clinicianAuth)
      .send({ assessmentId: assessment.id, goals: 'إرساء مهارات الطلاقة الأساسية', reviewDate: '2026-09-01' })
      .expect(201)).body;
    expect(plan.phase).toBe('PHASE_1');

    // ── Stage 6: clinician configures a level with a published version ────────
    const level = (await request(http())
      .post('/api/v1/levels')
      .set(clinicianAuth)
      .send({ name: 'المستوى 1', order: 1 })
      .expect(201)).body;
    const version = (await request(http())
      .post(`/api/v1/levels/${level.id}/versions`)
      .set(clinicianAuth)
      .send({
        versionNumber: 1,
        behavioralTechnique: 'الإطالة',
        trainingListJson: JSON.stringify(['حا', 'با']),
        samplePartTemplateJson: JSON.stringify([
          { partType: 'مقطع', label: 'مقطع 1', order: 1, required: true },
          { partType: 'كلمة', label: 'كلمة 1', order: 2, required: true },
        ]),
      })
      .expect(201)).body;
    await request(http()).post(`/api/v1/levels/${level.id}/versions/${version.id}/publish`).set(clinicianAuth).expect(200);

    // ── Stage 7: patient starts the 72h cycle and watches the human model ─────
    const cycle = (await request(http())
      .post(`/api/v1/patients/${pid}/cycles/start`)
      .set(patientAuth)
      .send({ treatmentPlanId: plan.id })
      .expect(201)).body;
    expect(cycle.levelId).toBe(level.id);
    await request(http()).post(`/api/v1/patients/${pid}/cycles/current/watch-human-model`).set(patientAuth).expect(201);

    // ── Stage 8: patient does a daily training session and logs progress ──────
    await request(http()).post(`/api/v1/patients/${pid}/cycles/current/training-sessions`).set(patientAuth).expect(201);
    await request(http())
      .patch(`/api/v1/patients/${pid}/cycles/current/training-sessions/current/progress`)
      .set(patientAuth)
      .send({ unitsCompleted: 40 })
      .expect(200);

    // fast-forward past the 72h gate (wall-clock; can't be advanced via API)
    await prisma.trainingCycle72h.update({ where: { id: cycle.id }, data: { status: 'SAMPLE_ELIGIBLE' } });

    // ── Stage 9: speech sample — open session, record attempts, submit ────────
    await request(http()).post(`/api/v1/patients/${pid}/cycles/current/sample-session`).set(patientAuth).expect(201);
    const attempt1 = (await request(http())
      .post(`/api/v1/patients/${pid}/cycles/current/sample-session/attempts`)
      .set(patientAuth)
      .send({ recordingUrl: 'attempt-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800, durationSeconds: 12 })
      .expect(201)).body;
    const attempt2 = (await request(http())
      .post(`/api/v1/patients/${pid}/cycles/current/sample-session/attempts`)
      .set(patientAuth)
      .send({ recordingUrl: 'attempt-2.mp4', mimeType: 'video/mp4', fileSizeBytes: 307200, durationSeconds: 18 })
      .expect(201)).body;
    const submit = (await request(http())
      .post(`/api/v1/patients/${pid}/cycles/current/sample-session/submit`)
      .set(patientAuth)
      .send({
        parts: [
          { partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: attempt1.id },
          { partType: 'كلمة', label: 'كلمة 1', order: 2, sourceAttemptId: attempt2.id },
        ],
        selfSeverityCurrent: 5,
        selfSeverityExpectedNext: 6,
        camperdownPerformanceRating: 7,
        clientOpinionScore: 6,
      })
      .expect(201)).body;
    expect(submit.parts).toHaveLength(2);

    // cycle now awaits the specialist
    const waiting = (await request(http()).get(`/api/v1/patients/${pid}/cycles/current`).set(patientAuth).expect(200)).body;
    expect(waiting.status).toBe('WAITING_FOR_SPECIALIST');

    // ── Stage 10: specialist reviews the sample and approves TRANSITION ───────
    const review = (await request(http())
      .post(`/api/v1/patients/${pid}/cycles/current/review`)
      .set(clinicianAuth)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'أداء جيد، جاهز للانتقال' })
      .expect(201)).body;
    expect(review.decision).toBe('TRANSITION');

    // ── Stage 11: final reports are generated from the accumulated record ─────
    const assessmentReport = (await request(http())
      .get(`/api/v1/reports/patients/${pid}/assessment-results`)
      .set(clinicianAuth)
      .expect(200)).body;
    expect(assessmentReport).toBeDefined();

    const medical = (await request(http())
      .get(`/api/v1/reports/patients/${pid}/medical`)
      .set(clinicianAuth)
      .expect(200)).body;

    // the report reflects the whole journey
    expect(medical.patientFullName).toBe('فهد الدوسري');
    expect(medical.latestApprovedAssessment.severityCategory).toBe('MODERATE');
    expect(medical.activeTreatmentPlan.goals).toBe('إرساء مهارات الطلاقة الأساسية');

    // ── the pipeline left a complete audit trail ─────────────────────────────
    const actions = (await prisma.auditLog.findMany()).map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'POST /api/v1/patients',
        expect.stringContaining('/assessments'),
        expect.stringContaining('/treatment-plans'),
        expect.stringContaining('/cycles/current/review'),
      ]),
    );
  });
});
