import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Administration: full smoke test', () => {
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

  it('walks an admin creating a clinician and supervisor, assigning supervision, and the clinician changing their forced password', async () => {
    const adminRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Smoke Admin',
      mobile: '+966500002600',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500002600', code: adminRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500002600' }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002600', password: 'password123' });
    const adminToken = adminLogin.body.token;

    const clinicianCreate = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Smoke Clinician', mobile: '+966500002601', password: 'temp-initial1', role: 'CLINICIAN' });
    expect(clinicianCreate.status).toBe(201);
    expect(clinicianCreate.body.mustChangePassword).toBe(true);

    const supervisorCreate = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Smoke Supervisor', mobile: '+966500002602', password: 'temp-initial2', role: 'SUPERVISOR' });
    expect(supervisorCreate.status).toBe(201);

    const assignResponse = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianCreate.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: supervisorCreate.body.id });
    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.supervisorUserId).toBe(supervisorCreate.body.id);

    const supervisorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002602', password: 'temp-initial2' });
    const clinicianListResponse = await request(app.getHttpServer())
      .get(`/api/v1/admin/supervision/${supervisorCreate.body.id}/clinicians`)
      .set('Authorization', `Bearer ${supervisorLogin.body.token}`);
    expect(clinicianListResponse.status).toBe(200);
    expect(clinicianListResponse.body).toHaveLength(1);
    expect(clinicianListResponse.body[0].id).toBe(clinicianCreate.body.id);

    const clinicianLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002601', password: 'temp-initial1' });
    expect(clinicianLogin.body.mustChangePassword).toBe(true);

    const changePasswordResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${clinicianLogin.body.token}`)
      .send({ currentPassword: 'temp-initial1', newPassword: 'permanent-pass1' });
    expect(changePasswordResponse.status).toBe(200);

    const relogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002601', password: 'permanent-pass1' });
    expect(relogin.status).toBe(200);
    expect(relogin.body.mustChangePassword).toBe(false);

    const disableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${clinicianCreate.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DISABLED' });
    expect(disableResponse.status).toBe(200);

    const blockedLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002601', password: 'permanent-pass1' });
    expect(blockedLogin.status).toBe(401);
  });
});
