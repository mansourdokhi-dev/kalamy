import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Supervision: assign, reassign, unassign', () => {
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

  async function createAdminToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Admin User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'ADMIN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  async function createStaff(adminToken: string, mobile: string, role: 'CLINICIAN' | 'SUPERVISOR'): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: `Staff ${mobile}`, mobile, password: 'password123', role });
    return response.body.id;
  }

  it('lets an ADMIN assign a supervisor to a clinician', async () => {
    const adminToken = await createAdminToken('+966500002400', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002401', 'CLINICIAN');
    const supervisorId = await createStaff(adminToken, '+966500002402', 'SUPERVISOR');

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: supervisorId });

    expect(response.status).toBe(200);
    expect(response.body.supervisorUserId).toBe(supervisorId);
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('lets an ADMIN reassign a clinician to a different supervisor', async () => {
    const adminToken = await createAdminToken('+966500002403', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002404', 'CLINICIAN');
    const firstSupervisorId = await createStaff(adminToken, '+966500002405', 'SUPERVISOR');
    const secondSupervisorId = await createStaff(adminToken, '+966500002406', 'SUPERVISOR');
    await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: firstSupervisorId });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: secondSupervisorId });

    expect(response.status).toBe(200);
    expect(response.body.supervisorUserId).toBe(secondSupervisorId);
  });

  it('lets an ADMIN unassign a supervisor by sending null', async () => {
    const adminToken = await createAdminToken('+966500002407', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002408', 'CLINICIAN');
    const supervisorId = await createStaff(adminToken, '+966500002409', 'SUPERVISOR');
    await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: supervisorId });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: null });

    expect(response.status).toBe(200);
    expect(response.body.supervisorUserId).toBeNull();
  });

  it('400s when the target user is not a CLINICIAN', async () => {
    const adminToken = await createAdminToken('+966500002410', 'password123');
    const supervisorId = await createStaff(adminToken, '+966500002411', 'SUPERVISOR');
    const otherSupervisorId = await createStaff(adminToken, '+966500002412', 'SUPERVISOR');

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${supervisorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: otherSupervisorId });

    expect(response.status).toBe(400);
  });

  it('400s when supervisorUserId does not reference a SUPERVISOR', async () => {
    const adminToken = await createAdminToken('+966500002413', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002414', 'CLINICIAN');
    const otherClinicianId = await createStaff(adminToken, '+966500002415', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: otherClinicianId });

    expect(response.status).toBe(400);
  });

  it('rejects a non-ADMIN assigning a supervisor', async () => {
    const adminToken = await createAdminToken('+966500002416', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002417', 'CLINICIAN');
    const supervisorId = await createStaff(adminToken, '+966500002418', 'SUPERVISOR');
    const supervisorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002418', password: 'password123' });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${supervisorLogin.body.token}`)
      .send({ supervisorUserId: supervisorId });

    expect(response.status).toBe(403);
  });
});
