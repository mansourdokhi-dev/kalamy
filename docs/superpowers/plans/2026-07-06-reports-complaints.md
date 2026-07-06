# Reports + Complaints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal Complaints feature (patients/caregivers submit, staff triage) and 7 on-demand Reports (2 patient-scoped, 5 admin-only) to the Kalamy backend, per `docs/superpowers/specs/2026-07-06-reports-complaints-design.md`.

**Architecture:** Two new NestJS feature modules — `ComplaintsModule` (standalone CRUD over a new `Complaint` model) and `ReportsModule` (a pure read layer querying existing tables directly via `PrismaService`, reusing the existing `PatientAccessService` for the 2 patient-scoped reports). No new cross-cutting infrastructure; RBAC guards, session guard, and the audit interceptor are already global.

**Tech Stack:** NestJS 11 (TypeScript), PostgreSQL 16 via Prisma 6.19.3, nestjs-zod/Zod for validation, Jest + Supertest for e2e tests against a real Postgres (Docker).

## Global Constraints

- No hard deletes — `Complaint` rows are never deleted, only their `status` changes.
- No PDF generation or file storage for any report — every report is a JSON response computed on demand from existing tables.
- No report versioning/approval workflow — reports are always-fresh computed views, not stored documents.
- Every patient-scoped endpoint must call `PatientAccessService.assertCanAccess(actor, profile)` before returning data, exactly as done in `ProgressService`/`AssessmentsService`/`TreatmentPlansService`.
- Every new controller uses `@UseGuards(SessionGuard, PermissionsGuard)` at the class level and `@RequirePermission(Permission.X)` per route, matching every existing controller in `backend/src/modules/`.
- Every module that uses `SessionGuard` in its controllers must import `AuthModule` (which exports `SessionGuard`).
- DTOs are Zod schemas wrapped with `createZodDto`, matching every existing DTO in `backend/src/modules/*/dto/`.
- e2e tests run against a real Postgres via `createTestApp()`/`resetDatabase()` from `backend/test/utils/test-app.ts` — never mocked.

---

## File Structure

- `backend/prisma/schema.prisma` — add `ComplaintType`, `ComplaintStatus` enums, `Complaint` model, and two new `User` relations.
- `backend/test/utils/test-app.ts` — add `prisma.complaint.deleteMany()` to `resetDatabase`.
- `backend/src/common/rbac/permissions.ts` — add 5 new `Permission` values and extend `ROLE_PERMISSIONS`.
- `backend/src/common/rbac/permissions.spec.ts` — add coverage for the new permissions.
- `backend/src/modules/complaints/complaints.module.ts` — wires `ComplaintsController` + `ComplaintsService`.
- `backend/src/modules/complaints/complaints.service.ts` — `create`, `listAll`, `findById`, `updateStatus`.
- `backend/src/modules/complaints/complaints.controller.ts` — `POST /`, `GET /`, `GET /:id`, `PATCH /:id/status`.
- `backend/src/modules/complaints/dto/create-complaint.dto.ts`, `dto/update-complaint-status.dto.ts`.
- `backend/test/complaints.e2e-spec.ts` — schema smoke test (Task 1), CRUD tests (Task 3), status-update tests (Task 4).
- `backend/src/modules/reports/reports.module.ts` — wires `ReportsController` + `ReportsService`.
- `backend/src/modules/reports/reports.service.ts` — one method per report.
- `backend/src/modules/reports/reports.controller.ts` — one `GET` route per report.
- `backend/test/reports-patient-scoped.e2e-spec.ts` — Task 5 tests (assessment results, medical).
- `backend/test/reports-admin.e2e-spec.ts` — Task 6/7/8 tests (operational status, registered users, service modifications, staff performance, complaints report).
- `backend/test/reports-complaints-smoke.e2e-spec.ts` — Task 9 full walkthrough.
- `backend/src/app.module.ts` — register `ComplaintsModule`, `ReportsModule`.
- `backend/src/main.ts` — update Swagger description.

---

### Task 1: Prisma schema for Complaint

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/test/utils/test-app.ts`
- Create: `backend/test/complaints.e2e-spec.ts`

**Interfaces:**
- Produces: `Complaint` Prisma model (`id`, `submittedByUserId`, `relatedClinicianUserId`, `type: ComplaintType`, `subject`, `description`, `status: ComplaintStatus`, `createdAt`, `updatedAt`), `ComplaintType` (`COMPLAINT | SUGGESTION`), `ComplaintStatus` (`OPEN | REVIEWED | RESOLVED`).

- [ ] **Step 1: Add enums and the Complaint model to the schema**

Append to `backend/prisma/schema.prisma` (after the `SessionStatus` enum, before `model User`):

```prisma
enum ComplaintType {
  COMPLAINT
  SUGGESTION
}

enum ComplaintStatus {
  OPEN
  REVIEWED
  RESOLVED
}
```

Add these two relation lines inside `model User { ... }`, in the relations block alongside `reviewedPatientSessions`:

```prisma
  complaintsSubmitted     Complaint[] @relation("ComplaintSubmitter")
  complaintsAboutMe       Complaint[] @relation("ComplaintRelatedClinician")
```

Append this model at the end of `schema.prisma`, after `model PatientSession`:

```prisma
model Complaint {
  id                     String          @id @default(uuid())
  submittedByUserId      String
  submittedByUser        User            @relation("ComplaintSubmitter", fields: [submittedByUserId], references: [id])
  relatedClinicianUserId String?
  relatedClinicianUser   User?           @relation("ComplaintRelatedClinician", fields: [relatedClinicianUserId], references: [id])
  type                   ComplaintType
  subject                String
  description            String
  status                 ComplaintStatus @default(OPEN)
  createdAt              DateTime        @default(now())
  updatedAt              DateTime        @updatedAt

  @@index([status])
  @@index([relatedClinicianUserId])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run (from `backend/`):
```bash
npx prisma migrate dev --name add_complaints
```
Expected: a new folder under `backend/prisma/migrations/` containing the SQL, applied to the local dev database without error.

- [ ] **Step 3: Add Complaint cleanup to the shared test reset helper**

In `backend/test/utils/test-app.ts`, add `prisma.complaint.deleteMany(),` as the first line inside the `resetDatabase` transaction array (before `prisma.auditLog.deleteMany(),`):

```typescript
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.complaint.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.patientSession.deleteMany(),
    prisma.sessionTemplate.deleteMany(),
    prisma.planExercise.deleteMany(),
    prisma.phaseTransition.deleteMany(),
    prisma.treatmentPlan.deleteMany(),
    prisma.assessment.deleteMany(),
    prisma.exercise.deleteMany(),
    prisma.patientClinicalInfo.deleteMany(),
    prisma.patientProfile.deleteMany(),
    prisma.guardianLink.deleteMany(),
    prisma.session.deleteMany(),
    prisma.otpCode.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
```

- [ ] **Step 4: Write the schema smoke test**

Create `backend/test/complaints.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Complaint schema smoke test', () => {
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

  it('can create and read a Complaint row', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Complaint Schema Patient',
      mobile: '+966500000900',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000900', code: registerResponse.body.devOtpCode });

    const complaint = await prisma.complaint.create({
      data: {
        submittedByUserId: registerResponse.body.userId,
        type: 'COMPLAINT',
        subject: 'Late clinician review',
        description: 'My session review took over a week.',
      },
    });

    const found = await prisma.complaint.findUnique({ where: { id: complaint.id } });
    expect(found?.status).toBe('OPEN');
    expect(found?.subject).toBe('Late clinician review');
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:e2e -- complaints.e2e-spec.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/test/utils/test-app.ts backend/test/complaints.e2e-spec.ts
git commit -m "feat: add Complaint model to schema"
```

---

### Task 2: RBAC permission extension for reports and complaints

**Files:**
- Modify: `backend/src/common/rbac/permissions.ts`
- Modify: `backend/src/common/rbac/permissions.spec.ts`

**Interfaces:**
- Consumes: `Permission` enum, `ROLE_PERMISSIONS` map, `hasPermission(role, permission)` from `backend/src/common/rbac/permissions.ts` (Task 1's schema is unrelated to this task).
- Produces: `Permission.SUBMIT_COMPLAINT`, `Permission.VIEW_COMPLAINT`, `Permission.MANAGE_COMPLAINTS`, `Permission.VIEW_PATIENT_REPORTS`, `Permission.VIEW_ADMIN_REPORTS`.

- [ ] **Step 1: Write failing permission tests**

Append to `backend/src/common/rbac/permissions.spec.ts`:

```typescript
describe('hasPermission — reports and complaints', () => {
  it('allows a PATIENT to submit a complaint', () => {
    expect(hasPermission('PATIENT', Permission.SUBMIT_COMPLAINT)).toBe(true);
  });

  it('does not allow a CLINICIAN to submit a complaint', () => {
    expect(hasPermission('CLINICIAN', Permission.SUBMIT_COMPLAINT)).toBe(false);
  });

  it('allows an ADMIN to manage complaints', () => {
    expect(hasPermission('ADMIN', Permission.MANAGE_COMPLAINTS)).toBe(true);
  });

  it('does not allow a CLINICIAN to manage complaints', () => {
    expect(hasPermission('CLINICIAN', Permission.MANAGE_COMPLAINTS)).toBe(false);
  });

  it('allows a CAREGIVER to view patient reports (ownership enforced elsewhere)', () => {
    expect(hasPermission('CAREGIVER', Permission.VIEW_PATIENT_REPORTS)).toBe(true);
  });

  it('allows a SUPERVISOR to view admin reports', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_ADMIN_REPORTS)).toBe(true);
  });

  it('does not allow a PATIENT to view admin reports', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_ADMIN_REPORTS)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- permissions.spec.ts`
Expected: FAIL with `Permission.SUBMIT_COMPLAINT` (and others) undefined / TypeScript compile error.

- [ ] **Step 3: Extend the Permission enum**

In `backend/src/common/rbac/permissions.ts`, add to the end of the `Permission` enum (after `VIEW_PROGRESS = 'VIEW_PROGRESS',`):

```typescript
  SUBMIT_COMPLAINT = 'SUBMIT_COMPLAINT',
  VIEW_COMPLAINT = 'VIEW_COMPLAINT',
  MANAGE_COMPLAINTS = 'MANAGE_COMPLAINTS',
  VIEW_PATIENT_REPORTS = 'VIEW_PATIENT_REPORTS',
  VIEW_ADMIN_REPORTS = 'VIEW_ADMIN_REPORTS',
```

- [ ] **Step 4: Extend ROLE_PERMISSIONS**

In the same file, add these lines to the end of each role's array (immediately before the closing `],`):

`PATIENT` — add:
```typescript
    Permission.SUBMIT_COMPLAINT,
    Permission.VIEW_COMPLAINT,
    Permission.VIEW_PATIENT_REPORTS,
```

`CAREGIVER` — add:
```typescript
    Permission.SUBMIT_COMPLAINT,
    Permission.VIEW_COMPLAINT,
    Permission.VIEW_PATIENT_REPORTS,
```

`CLINICIAN` — add:
```typescript
    Permission.VIEW_COMPLAINT,
    Permission.VIEW_PATIENT_REPORTS,
```

`SUPERVISOR` — add:
```typescript
    Permission.VIEW_COMPLAINT,
    Permission.MANAGE_COMPLAINTS,
    Permission.VIEW_PATIENT_REPORTS,
    Permission.VIEW_ADMIN_REPORTS,
```

`ADMIN` — add:
```typescript
    Permission.VIEW_COMPLAINT,
    Permission.MANAGE_COMPLAINTS,
    Permission.VIEW_PATIENT_REPORTS,
    Permission.VIEW_ADMIN_REPORTS,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- permissions.spec.ts`
Expected: PASS (all tests, including pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/rbac/permissions.ts backend/src/common/rbac/permissions.spec.ts
git commit -m "feat: add RBAC permissions for reports and complaints"
```

---

### Task 3: Complaints — submit, list/filter, get one

**Files:**
- Create: `backend/src/modules/complaints/dto/create-complaint.dto.ts`
- Create: `backend/src/modules/complaints/complaints.service.ts`
- Create: `backend/src/modules/complaints/complaints.controller.ts`
- Create: `backend/src/modules/complaints/complaints.module.ts`
- Modify: `backend/test/complaints.e2e-spec.ts`

**Interfaces:**
- Consumes: `Permission.SUBMIT_COMPLAINT`, `Permission.MANAGE_COMPLAINTS`, `Permission.VIEW_COMPLAINT` (Task 2); `SessionGuard`, `AuthenticatedUser`, `CurrentUser`, `PermissionsGuard`, `RequirePermission` (existing common infra); `Complaint` Prisma model (Task 1).
- Produces: `ComplaintsService.create(dto, actor)`, `ComplaintsService.listAll(filters)`, `ComplaintsService.findById(id, actor)` — all return/throw as documented below. `ComplaintsModule` exporting `ComplaintsService` for later reuse if needed.

- [ ] **Step 1: Write the DTO**

Create `backend/src/modules/complaints/dto/create-complaint.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateComplaintSchema = z.object({
  type: z.enum(['COMPLAINT', 'SUGGESTION']),
  subject: z.string().min(1),
  description: z.string().min(1),
  relatedClinicianUserId: z.uuid().optional(),
});

export class CreateComplaintDto extends createZodDto(CreateComplaintSchema) {}
```

- [ ] **Step 2: Write failing e2e tests**

Append a new describe block to `backend/test/complaints.e2e-spec.ts` (after the existing `Complaint schema smoke test` block):

```typescript
describe('Complaints: submit, list, get', () => {
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

  async function createUserToken(
    mobile: string,
    password: string,
    role: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN',
  ): Promise<{ token: string; userId: string }> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Complaint Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return { token: loginResponse.body.token, userId: registerResponse.body.userId };
  }

  it('lets a PATIENT submit a complaint', async () => {
    const { token } = await createUserToken('+966500000901', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'COMPLAINT', subject: 'Slow response', description: 'The clinician took 10 days to respond.' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('OPEN');
    expect(response.body.type).toBe('COMPLAINT');
  });

  it('rejects a CLINICIAN submitting a complaint', async () => {
    const { token } = await createUserToken('+966500000902', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'SUGGESTION', subject: 'Add dark mode', description: 'Would help night use.' });

    expect(response.status).toBe(403);
  });

  it('404s when relatedClinicianUserId does not exist', async () => {
    const { token } = await createUserToken('+966500000903', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'COMPLAINT',
        subject: 'Unresponsive clinician',
        description: 'No answer in two weeks.',
        relatedClinicianUserId: '00000000-0000-0000-0000-000000000000',
      });

    expect(response.status).toBe(404);
  });

  it('lets an ADMIN list and filter complaints by status', async () => {
    const { token: adminToken } = await createUserToken('+966500000904', 'password123', 'ADMIN');
    const { token: patientToken } = await createUserToken('+966500000905', 'password123', 'PATIENT');
    await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ type: 'COMPLAINT', subject: 'Issue A', description: 'Description A' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/complaints?status=OPEN')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].subject).toBe('Issue A');
  });

  it('rejects a PATIENT listing all complaints', async () => {
    const { token } = await createUserToken('+966500000906', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer()).get('/api/v1/complaints').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('lets the original submitter view their own complaint', async () => {
    const { token } = await createUserToken('+966500000907', 'password123', 'PATIENT');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'COMPLAINT', subject: 'Issue B', description: 'Description B' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/complaints/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.subject).toBe('Issue B');
  });

  it("rejects an unrelated PATIENT viewing someone else's complaint", async () => {
    const { token: submitterToken } = await createUserToken('+966500000908', 'password123', 'PATIENT');
    const { token: otherToken } = await createUserToken('+966500000909', 'password123', 'PATIENT');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${submitterToken}`)
      .send({ type: 'COMPLAINT', subject: 'Issue C', description: 'Description C' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/complaints/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:e2e -- complaints.e2e-spec.ts`
Expected: FAIL — routes don't exist yet (404s where 201/200/403 expected).

- [ ] **Step 4: Implement the service**

Create `backend/src/modules/complaints/complaints.service.ts`:

```typescript
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Complaint } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { CreateComplaintDto } from './dto/create-complaint.dto';

export interface ComplaintFilters {
  status?: 'OPEN' | 'REVIEWED' | 'RESOLVED';
  relatedClinicianUserId?: string;
}

@Injectable()
export class ComplaintsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateComplaintDto, actor: AuthenticatedUser): Promise<Complaint> {
    if (dto.relatedClinicianUserId) {
      const clinician = await this.prisma.user.findUnique({ where: { id: dto.relatedClinicianUserId } });
      if (!clinician) {
        throw new NotFoundException('Related clinician not found');
      }
    }
    return this.prisma.complaint.create({
      data: {
        submittedByUserId: actor.id,
        relatedClinicianUserId: dto.relatedClinicianUserId,
        type: dto.type,
        subject: dto.subject,
        description: dto.description,
      },
    });
  }

  async listAll(filters: ComplaintFilters): Promise<Complaint[]> {
    return this.prisma.complaint.findMany({
      where: {
        status: filters.status,
        relatedClinicianUserId: filters.relatedClinicianUserId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, actor: AuthenticatedUser): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findUnique({ where: { id } });
    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }
    if (actor.role === 'ADMIN' || actor.role === 'SUPERVISOR') {
      return complaint;
    }
    if (complaint.submittedByUserId === actor.id) {
      return complaint;
    }
    throw new ForbiddenException("Cannot view another user's complaint");
  }
}
```

- [ ] **Step 5: Implement the controller**

Create `backend/src/modules/complaints/complaints.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ComplaintsService } from './complaints.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/complaints')
@UseGuards(SessionGuard, PermissionsGuard)
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Post()
  @RequirePermission(Permission.SUBMIT_COMPLAINT)
  create(@Body() dto: CreateComplaintDto, @CurrentUser() user: AuthenticatedUser) {
    return this.complaintsService.create(dto, user);
  }

  @Get()
  @RequirePermission(Permission.MANAGE_COMPLAINTS)
  list(
    @Query('status') status?: 'OPEN' | 'REVIEWED' | 'RESOLVED',
    @Query('relatedClinicianUserId') relatedClinicianUserId?: string,
  ) {
    return this.complaintsService.listAll({ status, relatedClinicianUserId });
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_COMPLAINT)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.complaintsService.findById(id, user);
  }
}
```

- [ ] **Step 6: Wire the module**

Create `backend/src/modules/complaints/complaints.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
```

- [ ] **Step 7: Register the module in AppModule**

In `backend/src/app.module.ts`, add the import:

```typescript
import { ComplaintsModule } from './modules/complaints/complaints.module';
```

And add `ComplaintsModule` to the `imports` array (after `ProgressModule`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test:e2e -- complaints.e2e-spec.ts`
Expected: PASS (all tests in the file, schema smoke test + new CRUD tests).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/complaints backend/src/app.module.ts backend/test/complaints.e2e-spec.ts
git commit -m "feat: add complaint submission, listing, and single-complaint retrieval"
```

---

### Task 4: Complaints — update status

**Files:**
- Create: `backend/src/modules/complaints/dto/update-complaint-status.dto.ts`
- Modify: `backend/src/modules/complaints/complaints.service.ts`
- Modify: `backend/src/modules/complaints/complaints.controller.ts`
- Modify: `backend/test/complaints.e2e-spec.ts`

**Interfaces:**
- Consumes: `ComplaintsService`, `ComplaintsController` (Task 3).
- Produces: `ComplaintsService.updateStatus(id, dto)`.

- [ ] **Step 1: Write the DTO**

Create `backend/src/modules/complaints/dto/update-complaint-status.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateComplaintStatusSchema = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'RESOLVED']),
});

export class UpdateComplaintStatusDto extends createZodDto(UpdateComplaintStatusSchema) {}
```

- [ ] **Step 2: Write failing e2e tests**

Append a new describe block to `backend/test/complaints.e2e-spec.ts`:

```typescript
describe('Complaints: update status', () => {
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

  async function createUserToken(mobile: string, password: string, role: 'PATIENT' | 'ADMIN'): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Complaint Status Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lets an ADMIN move a complaint from OPEN to RESOLVED', async () => {
    const adminToken = await createUserToken('+966500000910', 'password123', 'ADMIN');
    const patientToken = await createUserToken('+966500000911', 'password123', 'PATIENT');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ type: 'COMPLAINT', subject: 'Issue D', description: 'Description D' });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/complaints/${createResponse.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('RESOLVED');
  });

  it('rejects a PATIENT updating complaint status', async () => {
    const patientToken = await createUserToken('+966500000912', 'password123', 'PATIENT');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ type: 'COMPLAINT', subject: 'Issue E', description: 'Description E' });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/complaints/${createResponse.body.id}/status`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ status: 'REVIEWED' });

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:e2e -- complaints.e2e-spec.ts`
Expected: FAIL — `PATCH /:id/status` route doesn't exist yet (404).

- [ ] **Step 4: Add the service method**

In `backend/src/modules/complaints/complaints.service.ts`, add the import `UpdateComplaintStatusDto` and this method inside the `ComplaintsService` class (after `findById`):

```typescript
  async updateStatus(id: string, dto: UpdateComplaintStatusDto): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findUnique({ where: { id } });
    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }
    return this.prisma.complaint.update({ where: { id }, data: { status: dto.status } });
  }
```

Add the import at the top of the file:
```typescript
import { UpdateComplaintStatusDto } from './dto/update-complaint-status.dto';
```

- [ ] **Step 5: Add the controller route**

In `backend/src/modules/complaints/complaints.controller.ts`, change the `@nestjs/common` import line to include `Patch`:

```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
```

Add the import:
```typescript
import { UpdateComplaintStatusDto } from './dto/update-complaint-status.dto';
```

Add this method inside `ComplaintsController` (after `findOne`):

```typescript
  @Patch(':id/status')
  @RequirePermission(Permission.MANAGE_COMPLAINTS)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateComplaintStatusDto) {
    return this.complaintsService.updateStatus(id, dto);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:e2e -- complaints.e2e-spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/complaints backend/test/complaints.e2e-spec.ts
git commit -m "feat: add complaint status update for staff"
```

---

### Task 5: Reports — Assessment Results Report + Medical Report

**Files:**
- Create: `backend/src/modules/reports/reports.service.ts`
- Create: `backend/src/modules/reports/reports.controller.ts`
- Create: `backend/src/modules/reports/reports.module.ts`
- Create: `backend/test/reports-patient-scoped.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PatientAccessService.assertCanAccess(actor, profile)` (existing, from `backend/src/common/patient-access/patient-access.service.ts`); `Permission.VIEW_PATIENT_REPORTS` (Task 2); `Assessment`, `PatientClinicalInfo`, `TreatmentPlan`, `PatientProfile` Prisma models (existing).
- Produces: `ReportsService.getAssessmentResultsReport(patientProfileId, actor)`, `ReportsService.getMedicalReport(patientProfileId, actor)`, exported types `AssessmentResultsReport`, `MedicalReport`. `ReportsModule` (imported by `AppModule`), extended by Tasks 6-8 with more methods/routes on the same files.

- [ ] **Step 1: Write failing e2e tests**

Create `backend/test/reports-patient-scoped.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reports: patient-scoped (assessment results, medical)', () => {
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

  async function setUpPatientWithApprovedAssessmentAndPlan(clinicianToken: string, patientMobile: string, nationalId: string) {
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Reports Test Patient',
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
        fullName: 'Reports Test Patient',
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
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId: assessmentResponse.body.id, goals: 'Complete the 30-session program', reviewDate: '2026-12-01' });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: patientMobile, password: 'password123' });
    return { profileId: profileResponse.body.id, patientToken: loginResponse.body.token };
  }

  it('returns the assessment results report for the patient who owns it', async () => {
    const clinicianToken = await createClinicianToken('+966500001000', 'password123');
    const { profileId, patientToken } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001001', 'REP-TEST-1');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/assessment-results`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.assessments).toHaveLength(1);
    expect(response.body.assessments[0].severityCategory).toBe('MODERATE');
    expect(response.body.assessments[0].status).toBe('APPROVED');
  });

  it("rejects an unrelated PATIENT viewing another patient's assessment results report", async () => {
    const clinicianToken = await createClinicianToken('+966500001002', 'password123');
    const { profileId } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001003', 'REP-TEST-2');
    const otherRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500001004',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001004', code: otherRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500001004', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/assessment-results`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });

  it('returns the medical report combining clinical info, latest approved assessment, and active plan', async () => {
    const clinicianToken = await createClinicianToken('+966500001005', 'password123');
    const { profileId, patientToken } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001006', 'REP-TEST-3');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/medical`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.patientFullName).toBe('Reports Test Patient');
    expect(response.body.latestApprovedAssessment.severityCategory).toBe('MODERATE');
    expect(response.body.activeTreatmentPlan.goals).toBe('Complete the 30-session program');
    expect(response.body.clinicalInfo).toBeNull();
  });

  it('lets a CLINICIAN view the medical report for any patient', async () => {
    const clinicianToken = await createClinicianToken('+966500001007', 'password123');
    const { profileId } = await setUpPatientWithApprovedAssessmentAndPlan(clinicianToken, '+966500001008', 'REP-TEST-4');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/patients/${profileId}/medical`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body.activeTreatmentPlan).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- reports-patient-scoped.e2e-spec.ts`
Expected: FAIL — `/api/v1/reports/...` routes don't exist yet (404).

- [ ] **Step 3: Implement the service**

Create `backend/src/modules/reports/reports.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export interface AssessmentResultsReport {
  patientProfileId: string;
  assessments: Array<{
    id: string;
    type: string;
    status: string;
    ssi4Frequency: number | null;
    ssi4Duration: number | null;
    ssi4PhysicalConcomitants: number | null;
    ssi4Total: number | null;
    severityCategory: string | null;
    approvedAt: Date | null;
    createdAt: Date;
  }>;
}

export interface MedicalReport {
  patientProfileId: string;
  patientFullName: string;
  clinicalInfo: {
    referralReason: string | null;
    initialDiagnosis: string | null;
    medicalHistory: string | null;
    medications: string | null;
    allergies: string | null;
    familyHistory: string | null;
  } | null;
  latestApprovedAssessment: {
    id: string;
    type: string;
    severityCategory: string | null;
    ssi4Total: number | null;
    approvedAt: Date | null;
  } | null;
  activeTreatmentPlan: {
    id: string;
    phase: string;
    goals: string;
    reviewDate: Date;
  } | null;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async getAssessmentResultsReport(patientProfileId: string, actor: AuthenticatedUser): Promise<AssessmentResultsReport> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const assessments = await this.prisma.assessment.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      patientProfileId,
      assessments: assessments.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        ssi4Frequency: a.ssi4Frequency,
        ssi4Duration: a.ssi4Duration,
        ssi4PhysicalConcomitants: a.ssi4PhysicalConcomitants,
        ssi4Total: a.ssi4Total,
        severityCategory: a.severityCategory,
        approvedAt: a.approvedAt,
        createdAt: a.createdAt,
      })),
    };
  }

  async getMedicalReport(patientProfileId: string, actor: AuthenticatedUser): Promise<MedicalReport> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const clinicalInfo = await this.prisma.patientClinicalInfo.findUnique({ where: { patientProfileId } });
    const latestApprovedAssessment = await this.prisma.assessment.findFirst({
      where: { patientProfileId, status: 'APPROVED' },
      orderBy: { approvedAt: 'desc' },
    });
    const activePlan = await this.prisma.treatmentPlan.findFirst({
      where: { patientProfileId, status: 'ACTIVE' },
    });

    return {
      patientProfileId,
      patientFullName: profile.fullName,
      clinicalInfo: clinicalInfo
        ? {
            referralReason: clinicalInfo.referralReason,
            initialDiagnosis: clinicalInfo.initialDiagnosis,
            medicalHistory: clinicalInfo.medicalHistory,
            medications: clinicalInfo.medications,
            allergies: clinicalInfo.allergies,
            familyHistory: clinicalInfo.familyHistory,
          }
        : null,
      latestApprovedAssessment: latestApprovedAssessment
        ? {
            id: latestApprovedAssessment.id,
            type: latestApprovedAssessment.type,
            severityCategory: latestApprovedAssessment.severityCategory,
            ssi4Total: latestApprovedAssessment.ssi4Total,
            approvedAt: latestApprovedAssessment.approvedAt,
          }
        : null,
      activeTreatmentPlan: activePlan
        ? {
            id: activePlan.id,
            phase: activePlan.phase,
            goals: activePlan.goals,
            reviewDate: activePlan.reviewDate,
          }
        : null,
    };
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
```

- [ ] **Step 4: Implement the controller**

Create `backend/src/modules/reports/reports.controller.ts`:

```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/reports')
@UseGuards(SessionGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('patients/:patientId/assessment-results')
  @RequirePermission(Permission.VIEW_PATIENT_REPORTS)
  getAssessmentResultsReport(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getAssessmentResultsReport(patientId, user);
  }

  @Get('patients/:patientId/medical')
  @RequirePermission(Permission.VIEW_PATIENT_REPORTS)
  getMedicalReport(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getMedicalReport(patientId, user);
  }
}
```

- [ ] **Step 5: Wire the module**

Create `backend/src/modules/reports/reports.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';

@Module({
  imports: [AuthModule, PatientAccessModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
```

- [ ] **Step 6: Register the module in AppModule**

In `backend/src/app.module.ts`, add the import:

```typescript
import { ReportsModule } from './modules/reports/reports.module';
```

And add `ReportsModule` to the `imports` array (after `ComplaintsModule`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:e2e -- reports-patient-scoped.e2e-spec.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/reports backend/src/app.module.ts backend/test/reports-patient-scoped.e2e-spec.ts
git commit -m "feat: add assessment results and medical patient reports"
```

---

### Task 6: Reports — Portal Operational Status + Registered Users

**Files:**
- Modify: `backend/src/modules/reports/reports.service.ts`
- Modify: `backend/src/modules/reports/reports.controller.ts`
- Create: `backend/test/reports-admin.e2e-spec.ts`

**Interfaces:**
- Consumes: `Permission.VIEW_ADMIN_REPORTS` (Task 2); `User`, `PatientProfile`, `TreatmentPlan`, `PatientSession`, `SessionTemplate` Prisma models (existing).
- Produces: `ReportsService.getOperationalStatusReport()`, `ReportsService.getRegisteredUsersReport()`, exported types `OperationalStatusReport`, `RegisteredUserSummary`.

- [ ] **Step 1: Write failing e2e tests**

Create `backend/test/reports-admin.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reports: operational status and registered users', () => {
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

  async function createUserToken(
    mobile: string,
    password: string,
    role: 'PATIENT' | 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN',
  ): Promise<{ token: string; userId: string }> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Reports Admin Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return { token: loginResponse.body.token, userId: registerResponse.body.userId };
  }

  it('returns zero-filled counts across all roles and statuses', async () => {
    const { token: adminToken } = await createUserToken('+966500001100', 'password123', 'ADMIN');
    await createUserToken('+966500001101', 'password123', 'CLINICIAN');
    await createUserToken('+966500001102', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/operational-status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.usersByRole.ADMIN).toBe(1);
    expect(response.body.usersByRole.CLINICIAN).toBe(1);
    expect(response.body.usersByRole.PATIENT).toBe(2);
    expect(response.body.usersByRole.CAREGIVER).toBe(0);
    expect(response.body.patientProfilesByStatus.ACTIVE).toBe(0);
    expect(response.body.patientSessionsByStatus.IN_TRAINING).toBe(0);
  });

  it('rejects a CLINICIAN viewing the operational status report', async () => {
    const { token } = await createUserToken('+966500001103', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/operational-status')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('lists registered users with a case-progress summary for patients', async () => {
    const { token: adminToken } = await createUserToken('+966500001104', 'password123', 'ADMIN');
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Registered Users Test Patient',
      mobile: '+966500001105',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500001105', code: patientRegister.body.devOtpCode });

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/registered-users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const patientSummary = response.body.find((u: { id: string }) => u.id === patientRegister.body.userId);
    expect(patientSummary.caseProgressSummary).toBe('Not started');
  });

  it('rejects a CLINICIAN listing registered users', async () => {
    const { token } = await createUserToken('+966500001106', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/registered-users')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- reports-admin.e2e-spec.ts`
Expected: FAIL — routes don't exist yet (404).

- [ ] **Step 3: Add the service methods**

In `backend/src/modules/reports/reports.service.ts`, add these two interfaces after `MedicalReport`:

```typescript
export interface OperationalStatusReport {
  usersByRole: Record<string, number>;
  patientProfilesByStatus: Record<string, number>;
  treatmentPlansByStatus: Record<string, number>;
  patientSessionsByStatus: Record<string, number>;
}

export interface RegisteredUserSummary {
  id: string;
  fullName: string;
  mobile: string;
  role: string;
  status: string;
  createdAt: Date;
  caseProgressSummary: string | null;
}
```

Add these two methods and one private helper inside the `ReportsService` class (after `getMedicalReport`):

```typescript
  async getOperationalStatusReport(): Promise<OperationalStatusReport> {
    const [usersByRoleRaw, profilesByStatusRaw, plansByStatusRaw, sessionsByStatusRaw] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.patientProfile.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.treatmentPlan.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.patientSession.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return {
      usersByRole: this.zeroFillCounts(['PATIENT', 'CAREGIVER', 'CLINICIAN', 'SUPERVISOR', 'ADMIN'], usersByRoleRaw, 'role'),
      patientProfilesByStatus: this.zeroFillCounts(['ACTIVE', 'DISABLED'], profilesByStatusRaw, 'status'),
      treatmentPlansByStatus: this.zeroFillCounts(['ACTIVE', 'INACTIVE'], plansByStatusRaw, 'status'),
      patientSessionsByStatus: this.zeroFillCounts(
        ['IN_TRAINING', 'SUBMITTED', 'APPROVED', 'REPEAT_REQUIRED'],
        sessionsByStatusRaw,
        'status',
      ),
    };
  }

  async getRegisteredUsersReport(): Promise<RegisteredUserSummary[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { patientProfile: true },
    });

    const summaries: RegisteredUserSummary[] = [];
    for (const user of users) {
      let caseProgressSummary: string | null = null;
      if (user.patientProfile) {
        const latestSession = await this.prisma.patientSession.findFirst({
          where: { patientProfileId: user.patientProfile.id },
          orderBy: { createdAt: 'desc' },
          include: { sessionTemplate: true },
        });
        caseProgressSummary = latestSession
          ? `Session ${latestSession.sessionTemplate.sessionNumber} (${latestSession.status})`
          : 'Not started';
      }
      summaries.push({
        id: user.id,
        fullName: user.fullName,
        mobile: user.mobile,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        caseProgressSummary,
      });
    }
    return summaries;
  }

  private zeroFillCounts<K extends string>(
    allKeys: K[],
    rows: Array<Record<string, unknown> & { _count: { _all: number } }>,
    keyField: string,
  ): Record<K, number> {
    const result = Object.fromEntries(allKeys.map((key) => [key, 0])) as Record<K, number>;
    for (const row of rows) {
      const key = row[keyField] as K;
      result[key] = row._count._all;
    }
    return result;
  }
```

- [ ] **Step 4: Add the controller routes**

In `backend/src/modules/reports/reports.controller.ts`, add these methods inside `ReportsController` (after `getMedicalReport`):

```typescript
  @Get('operational-status')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getOperationalStatusReport() {
    return this.reportsService.getOperationalStatusReport();
  }

  @Get('registered-users')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getRegisteredUsersReport() {
    return this.reportsService.getRegisteredUsersReport();
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- reports-admin.e2e-spec.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reports backend/test/reports-admin.e2e-spec.ts
git commit -m "feat: add operational status and registered users admin reports"
```

---

### Task 7: Reports — Service Modification Log

**Files:**
- Modify: `backend/src/modules/reports/reports.service.ts`
- Modify: `backend/src/modules/reports/reports.controller.ts`
- Modify: `backend/test/reports-admin.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuditLog` Prisma model (existing, populated automatically by the global `AuditInterceptor`).
- Produces: `ReportsService.getServiceModificationLogReport(filters)`, exported type `ServiceModificationLogEntry`.

- [ ] **Step 1: Write failing e2e tests**

Append to `backend/test/reports-admin.e2e-spec.ts`:

```typescript
describe('Reports: service modification log', () => {
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

  async function createUserToken(mobile: string, password: string, role: 'PATIENT' | 'CLINICIAN' | 'ADMIN'): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Service Log Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lists a mutating request performed by a known actor', async () => {
    const adminToken = await createUserToken('+966500001200', 'password123', 'ADMIN');
    const clinicianToken = await createUserToken('+966500001201', 'password123', 'CLINICIAN');
    await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ title: 'Log Test Exercise', category: 'Breathing', phaseLevel: 1, instructions: 'Breathe.', durationMinutes: 5 });

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/service-modifications')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const exerciseLog = response.body.find((entry: { entity: string }) => entry.entity === 'exercises');
    expect(exerciseLog).toBeDefined();
    expect(exerciseLog.actorRole).toBe('CLINICIAN');
  });

  it('filters by date range', async () => {
    const adminToken = await createUserToken('+966500001202', 'password123', 'ADMIN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/service-modifications?from=2099-01-01&to=2099-12-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('rejects a CLINICIAN viewing the service modification log', async () => {
    const token = await createUserToken('+966500001203', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/service-modifications')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- reports-admin.e2e-spec.ts`
Expected: FAIL — `service-modifications` route doesn't exist yet (404).

- [ ] **Step 3: Add the service method**

In `backend/src/modules/reports/reports.service.ts`, add this interface after `RegisteredUserSummary`:

```typescript
export interface ServiceModificationLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorFullName: string | null;
  actorRole: string | null;
  createdAt: Date;
}
```

Add this method inside `ReportsService` (after `getRegisteredUsersReport`):

```typescript
  async getServiceModificationLogReport(filters: { from?: Date; to?: Date }): Promise<ServiceModificationLogEntry[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        createdAt: {
          gte: filters.from,
          lte: filters.to,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      actorFullName: log.user?.fullName ?? null,
      actorRole: log.user?.role ?? null,
      createdAt: log.createdAt,
    }));
  }
```

- [ ] **Step 4: Add the controller route**

In `backend/src/modules/reports/reports.controller.ts`, change the `@nestjs/common` import line to include `Query`:

```typescript
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
```

Add this method inside `ReportsController` (after `getRegisteredUsersReport`):

```typescript
  @Get('service-modifications')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getServiceModificationLogReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getServiceModificationLogReport({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- reports-admin.e2e-spec.ts`
Expected: PASS (all 7 tests in the file so far).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reports backend/test/reports-admin.e2e-spec.ts
git commit -m "feat: add service modification log admin report"
```

---

### Task 8: Reports — Staff Performance + Complaints Report

**Files:**
- Modify: `backend/src/modules/reports/reports.service.ts`
- Modify: `backend/src/modules/reports/reports.controller.ts`
- Modify: `backend/test/reports-admin.e2e-spec.ts`

**Interfaces:**
- Consumes: `Complaint` Prisma model (Task 1); `Assessment`, `PatientSession` Prisma models (existing).
- Produces: `ReportsService.getStaffPerformanceReport()`, `ReportsService.getComplaintsReport(filters)`, exported types `StaffPerformanceSummary`, `ComplaintReportFilters`.

- [ ] **Step 1: Write failing e2e tests**

Append to `backend/test/reports-admin.e2e-spec.ts`:

```typescript
describe('Reports: staff performance and complaints', () => {
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

  async function createUserToken(
    mobile: string,
    password: string,
    role: 'PATIENT' | 'CLINICIAN' | 'ADMIN',
  ): Promise<{ token: string; userId: string }> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Staff Performance Test User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    if (role !== 'PATIENT') {
      await prisma.user.update({ where: { mobile }, data: { role } });
    }
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return { token: loginResponse.body.token, userId: registerResponse.body.userId };
  }

  it('counts a complaint against the named clinician in both reports', async () => {
    const { token: adminToken } = await createUserToken('+966500001300', 'password123', 'ADMIN');
    const { userId: clinicianUserId } = await createUserToken('+966500001301', 'password123', 'CLINICIAN');
    const { token: patientToken } = await createUserToken('+966500001302', 'password123', 'PATIENT');
    await request(app.getHttpServer())
      .post('/api/v1/complaints')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        type: 'COMPLAINT',
        subject: 'Slow review',
        description: 'Took too long.',
        relatedClinicianUserId: clinicianUserId,
      });

    const performanceResponse = await request(app.getHttpServer())
      .get('/api/v1/reports/staff-performance')
      .set('Authorization', `Bearer ${adminToken}`);
    const complaintsResponse = await request(app.getHttpServer())
      .get(`/api/v1/reports/complaints?relatedClinicianUserId=${clinicianUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(performanceResponse.status).toBe(200);
    const clinicianSummary = performanceResponse.body.find(
      (s: { clinicianUserId: string }) => s.clinicianUserId === clinicianUserId,
    );
    expect(clinicianSummary.complaintsAgainst).toBe(1);

    expect(complaintsResponse.status).toBe(200);
    expect(complaintsResponse.body).toHaveLength(1);
    expect(complaintsResponse.body[0].subject).toBe('Slow review');
  });

  it('rejects a CLINICIAN viewing the staff performance report', async () => {
    const { token } = await createUserToken('+966500001303', 'password123', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/staff-performance')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- reports-admin.e2e-spec.ts`
Expected: FAIL — `staff-performance` and `complaints` (under `/reports`) routes don't exist yet (404).

- [ ] **Step 3: Add the service methods**

In `backend/src/modules/reports/reports.service.ts`, add these interfaces after `ServiceModificationLogEntry`:

```typescript
export interface StaffPerformanceSummary {
  clinicianUserId: string;
  fullName: string;
  role: string;
  patientsHandled: number;
  reviewsApproved: number;
  reviewsRepeatRequired: number;
  complaintsAgainst: number;
}

export interface ComplaintReportFilters {
  status?: 'OPEN' | 'REVIEWED' | 'RESOLVED';
  relatedClinicianUserId?: string;
}
```

Add these two methods inside `ReportsService` (after `getServiceModificationLogReport`):

```typescript
  async getStaffPerformanceReport(): Promise<StaffPerformanceSummary[]> {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: ['CLINICIAN', 'SUPERVISOR'] } },
      orderBy: { createdAt: 'asc' },
    });

    const summaries: StaffPerformanceSummary[] = [];
    for (const member of staff) {
      const patientsHandled = await this.prisma.assessment.findMany({
        where: { clinicianUserId: member.id },
        distinct: ['patientProfileId'],
        select: { patientProfileId: true },
      });
      const reviewsApproved = await this.prisma.patientSession.count({
        where: { clinicianUserId: member.id, status: 'APPROVED' },
      });
      const reviewsRepeatRequired = await this.prisma.patientSession.count({
        where: { clinicianUserId: member.id, status: 'REPEAT_REQUIRED' },
      });
      const complaintsAgainst = await this.prisma.complaint.count({
        where: { relatedClinicianUserId: member.id },
      });

      summaries.push({
        clinicianUserId: member.id,
        fullName: member.fullName,
        role: member.role,
        patientsHandled: patientsHandled.length,
        reviewsApproved,
        reviewsRepeatRequired,
        complaintsAgainst,
      });
    }
    return summaries;
  }

  async getComplaintsReport(filters: ComplaintReportFilters) {
    return this.prisma.complaint.findMany({
      where: {
        status: filters.status,
        relatedClinicianUserId: filters.relatedClinicianUserId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
```

- [ ] **Step 4: Add the controller routes**

In `backend/src/modules/reports/reports.controller.ts`, add these methods inside `ReportsController` (after `getServiceModificationLogReport`):

```typescript
  @Get('staff-performance')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getStaffPerformanceReport() {
    return this.reportsService.getStaffPerformanceReport();
  }

  @Get('complaints')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getComplaintsReport(
    @Query('status') status?: 'OPEN' | 'REVIEWED' | 'RESOLVED',
    @Query('relatedClinicianUserId') relatedClinicianUserId?: string,
  ) {
    return this.reportsService.getComplaintsReport({ status, relatedClinicianUserId });
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- reports-admin.e2e-spec.ts`
Expected: PASS (all 9 tests in the file).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reports backend/test/reports-admin.e2e-spec.ts
git commit -m "feat: add staff performance and complaints admin reports"
```

---

### Task 9: Swagger update and full smoke test

**Files:**
- Modify: `backend/src/main.ts`
- Create: `backend/test/reports-complaints-smoke.e2e-spec.ts`

**Interfaces:**
- Consumes: every endpoint added in Tasks 3-8.

- [ ] **Step 1: Update the Swagger description**

In `backend/src/main.ts`, change:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Sessions, and Progress modules')
```

to:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Sessions, Progress, Reports, and Complaints modules')
```

- [ ] **Step 2: Write the full smoke test**

Create `backend/test/reports-complaints-smoke.e2e-spec.ts`:

```typescript
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
```

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS — every e2e spec file, including all pre-existing ones, passes with 0 failures.

- [ ] **Step 4: Run the unit test suite**

Run: `npm test`
Expected: PASS — every unit spec file passes with 0 failures.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main.ts backend/test/reports-complaints-smoke.e2e-spec.ts
git commit -m "feat: update Swagger description and add Reports+Complaints smoke test"
```

---

## Self-Review Notes

- **Spec coverage:** All 7 in-scope reports (Task 5: #1-2, Task 6: #3-4, Task 7: #5, Task 8: #6-7) and the Complaints feature (Tasks 3-4) are covered. RBAC extension (Task 2) and schema (Task 1) precede their consumers. Swagger + full-suite smoke test (Task 9) closes out the module, matching the pattern of every prior sub-project's final task.
- **Placeholder scan:** No TBD/TODO; every step has runnable code and exact commands.
- **Type consistency:** `ComplaintFilters`/`ComplaintReportFilters` share the same shape (`status`, `relatedClinicianUserId`) by design — kept as two named types because they belong to two different services per the spec's architecture decision (no cross-module service imports). `AuthenticatedUser`, `PrismaService`, `PatientAccessService` imports match their existing exported paths verified against the current codebase.
