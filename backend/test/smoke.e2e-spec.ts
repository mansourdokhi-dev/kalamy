import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Smoke test: full patient onboarding journey', () => {
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

  it('walks a minor patient from registration to a viewable, guardian-linked profile', async () => {
    // 1. Register the clinician's account directly (self-registration is PATIENT/CAREGIVER only)
    // by seeding it, then verifying the rest of the journey through the real API.
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Dr. Sara Al-Harbi',
      mobile: '+966500000200',
      password: 'clinician-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000200', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500000200' }, data: { role: 'CLINICIAN' } });
    const clinicianLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000200', password: 'clinician-pass1' });
    const clinicianToken = clinicianLogin.body.token;

    // 2. Register the guardian
    const guardianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Mohammed Al-Otaibi',
      mobile: '+966500000201',
      password: 'guardian-pass1',
      role: 'CAREGIVER',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000201', code: guardianRegister.body.devOtpCode });
    const guardianId = guardianRegister.body.userId;

    // 3. Register the minor patient
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Sultan Al-Otaibi',
      mobile: '+966500000202',
      password: 'patient-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000202', code: patientRegister.body.devOtpCode });
    const patientId = patientRegister.body.userId;
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000202', password: 'patient-pass1' });
    const patientToken = patientLogin.body.token;

    // 4. Clinician creates the patient's clinical profile, linking the guardian atomically (minor)
    const createProfile = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientId,
        fullName: 'Sultan Al-Otaibi',
        gender: 'MALE',
        dateOfBirth: '2016-03-10',
        nationalId: 'SMOKE-TEST-NID-1',
        guardianUserId: guardianId,
        clinicalInfo: {
          referralReason: 'Parental concern about stuttering onset at age 4',
          initialDiagnosis: 'Suspected developmental stuttering',
        },
      });
    expect(createProfile.status).toBe(201);
    const profileId = createProfile.body.id;

    // 5. The patient can view their own profile
    const patientView = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(patientView.status).toBe(200);
    expect(patientView.body.clinicalInfo.initialDiagnosis).toBe('Suspected developmental stuttering');

    // 6. The clinician can find the patient via search
    const search = await request(app.getHttpServer())
      .get('/api/v1/patients?q=Sultan')
      .set('Authorization', `Bearer ${clinicianToken}`);
    expect(search.status).toBe(200);
    expect(search.body.some((p: { id: string }) => p.id === profileId)).toBe(true);

    // 7. Every mutating step along the way was audit-logged
    const auditActions = (await prisma.auditLog.findMany()).map((log) => log.action);
    expect(auditActions).toEqual(
      expect.arrayContaining([
        'POST /api/v1/auth/register',
        'POST /api/v1/auth/verify',
        'POST /api/v1/patients',
      ]),
    );
  });
});
