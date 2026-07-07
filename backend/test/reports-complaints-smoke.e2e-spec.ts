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
});
