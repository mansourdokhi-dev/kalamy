# Staff Web App — Clinical Workflow (Sub-project 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Patient Detail Hub (`/patients/:id`) to `staff-web/` covering patient profile view/edit (including clinical info), assessment creation/approval, and treatment plan management, backed by two small backend additions (clinical-info edit, slimmed search response) and one new backend endpoint (caregiver lookup by mobile).

**Architecture:** Extends the existing `staff-web/` Vite+React+Mantine app from sub-project 1. A single new route renders three sections (Profile, Assessments, Treatment Plan) sharing one patient record loaded by a new `PatientDetailProvider`. Backend changes are additive to the existing `patients` module; the `assessments` and `treatment-plans` modules need no backend changes — only new frontend API clients consuming their existing endpoints.

**Tech Stack:** NestJS + Prisma + Zod (backend, unchanged), Vite + React + TypeScript + Mantine + React Router + Vitest + React Testing Library (frontend, unchanged). No new libraries.

## Global Constraints

- Backend DTOs use `nestjs-zod`'s `createZodDto` pattern exactly as existing DTOs do (see `backend/src/modules/patients/dto/*.ts`).
- Every backend endpoint is guarded by `@UseGuards(SessionGuard, PermissionsGuard)` at the controller level and `@RequirePermission(Permission.X)` per method — never add an endpoint without both.
- Frontend: all user-facing strings go in `staff-web/src/copy/ar.ts` — no inline strings in components.
- Frontend: every task's code must pass `npx tsc -b --noEmit` (run from `staff-web/`) and `npm run build` in addition to `npm test` — Vitest does not type-check (the sub-project-1 lesson: 4 of 8 tasks in that sub-project had real compile errors that `npm test` alone missed).
- Frontend forms follow the existing plain-`useState`-per-field pattern (see `staff-web/src/pages/ChangePasswordPage.tsx`) — this codebase does not use the `@mantine/form` hook even though it's installed as a dependency; don't introduce it.
- Frontend API-client modules (thin `apiRequest` wrappers, e.g. `staff-web/src/api/patients.ts`) have no dedicated unit test file in this codebase — they're exercised indirectly through the component tests that `vi.mock()` them. Follow this convention: don't write standalone tests for `assessments.ts`/`treatment-plans.ts`/`exercises.ts`.
- Backend e2e tests live in `backend/test/*.e2e-spec.ts`, run against a real Postgres via `npm run test:e2e -- <pattern>` (e.g. `npm run test:e2e -- patients`). Each `describe` block in this codebase re-declares its own local `loginAs`/`registerActivateAndLogin`/`createClinicianToken` helpers rather than sharing a utils file — match this, don't refactor it.
- Supervisor has view-only access to patients/assessments/treatment-plans in the current `Permission`/`ROLE_PERMISSIONS` system (`backend/src/common/rbac/permissions.ts`) — Clinician and Admin are equivalent for everything in this plan. All write UI must be hidden (not just disabled) for Supervisor.

---

### Task 1: Backend — patient clinical-info edit

**Files:**
- Modify: `backend/src/modules/patients/dto/update-patient.dto.ts`
- Modify: `backend/src/modules/patients/patients.service.ts` (only the `update` method, lines 112-128)
- Test: `backend/test/patients.e2e-spec.ts` (new `describe` block, appended at end of file)

**Interfaces:**
- Consumes: existing `PatientsService.update(id, dto, actor)` signature, `AuthenticatedUser` (has `.role`), `Role` enum from `@prisma/client`.
- Produces: `UpdatePatientDto` gains an optional `clinicalInfo` object with the same 6 fields as `CreatePatientDto.clinicalInfo` (`referralReason`, `initialDiagnosis`, `medicalHistory`, `medications`, `allergies`, `familyHistory`, all optional strings). `PatientsService.update()` upserts `PatientClinicalInfo` when `dto.clinicalInfo` is present, but throws `ForbiddenException` if the caller's role is not `CLINICIAN` or `ADMIN` and `dto.clinicalInfo` is present (CAREGIVER already has `EDIT_PATIENT_PROFILE` for the basic fields — this keeps clinical-data edits restricted to clinical staff). Later tasks' frontend `updatePatient()` calls this endpoint with a `clinicalInfo` object.

- [ ] **Step 1: Write the failing e2e tests**

Append to `backend/test/patients.e2e-spec.ts` (after the closing `});` of the `'Patients: disable and search'` block, i.e. at the very end of the file):

```typescript
describe('Patients: edit clinical info', () => {
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

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
  }

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER') {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test User',
      mobile,
      password,
      role,
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

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
    return loginAs(mobile, password);
  }

  it('lets a CLINICIAN add clinical info to a patient who has none yet', async () => {
    const clinicianToken = await createClinicianToken('+966500000120', 'password123');
    const patient = await registerActivateAndLogin('+966500000121', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'No Clinical Info Yet',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'CLINICAL-INFO-1',
      });
    const profileId = createResponse.body.id;
    expect(createResponse.body.clinicalInfo).toBeNull();

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ clinicalInfo: { initialDiagnosis: 'Moderate stutter', allergies: 'None known' } });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.clinicalInfo.initialDiagnosis).toBe('Moderate stutter');
    expect(updateResponse.body.clinicalInfo.allergies).toBe('None known');
  });

  it('updates only the provided clinical-info fields without clearing the others', async () => {
    const clinicianToken = await createClinicianToken('+966500000122', 'password123');
    const patient = await registerActivateAndLogin('+966500000123', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Has Clinical Info',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'CLINICAL-INFO-2',
        clinicalInfo: { initialDiagnosis: 'Original diagnosis', medications: 'Original meds' },
      });
    const profileId = createResponse.body.id;

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ clinicalInfo: { medications: 'Updated meds' } });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.clinicalInfo.medications).toBe('Updated meds');
    expect(updateResponse.body.clinicalInfo.initialDiagnosis).toBe('Original diagnosis');
  });

  it('forbids a CAREGIVER from editing clinical info', async () => {
    const clinicianToken = await createClinicianToken('+966500000124', 'password123');
    const minor = await registerActivateAndLogin('+966500000125', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000126', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minor.userId,
        fullName: 'Guarded Minor',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: 'CLINICAL-INFO-3',
        guardianUserId: guardian.userId,
      });
    const profileId = createResponse.body.id;

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${guardian.token}`)
      .send({ clinicalInfo: { initialDiagnosis: 'Should not be allowed' } });

    expect(updateResponse.status).toBe(403);
  });

  it('still lets a CAREGIVER update basic fields without clinicalInfo', async () => {
    const clinicianToken = await createClinicianToken('+966500000127', 'password123');
    const minor = await registerActivateAndLogin('+966500000128', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000129', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minor.userId,
        fullName: 'Guarded Minor Two',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: 'CLINICAL-INFO-4',
        guardianUserId: guardian.userId,
      });
    const profileId = createResponse.body.id;

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${guardian.token}`)
      .send({ address: 'Jeddah, Saudi Arabia' });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.address).toBe('Jeddah, Saudi Arabia');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- patients`
Expected: the 4 new tests in `'Patients: edit clinical info'` FAIL — the first two because `clinicalInfo` in the request body is silently dropped by the current `UpdatePatientDto`/`update()` (response won't have the new values), the third because there's no 403 check yet (it currently returns 200), the fourth should already pass (no code change needed for it, it's a regression guard).

- [ ] **Step 3: Extend the DTO**

Replace the full contents of `backend/src/modules/patients/dto/update-patient.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdatePatientSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  address: z.string().optional(),
  referralSource: z.string().optional(),
  clinicalInfo: z
    .object({
      referralReason: z.string().optional(),
      initialDiagnosis: z.string().optional(),
      medicalHistory: z.string().optional(),
      medications: z.string().optional(),
      allergies: z.string().optional(),
      familyHistory: z.string().optional(),
    })
    .optional(),
});

export class UpdatePatientDto extends createZodDto(UpdatePatientSchema) {}
```

- [ ] **Step 4: Update the service**

In `backend/src/modules/patients/patients.service.ts`, add `ForbiddenException` and `Role` to imports (line 1-2 currently `import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';` and `import { GuardianLink, PatientProfile, Role } from '@prisma/client';` — both `ForbiddenException` and `Role` are already imported, no import changes needed).

Replace the `update` method (lines 112-128):

```typescript
  async update(id: string, dto: UpdatePatientDto, actor: AuthenticatedUser): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    await this.assertCanAccess(actor, profile);

    if (dto.clinicalInfo && actor.role !== Role.CLINICIAN && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('Only clinical staff can edit clinical information');
    }

    return this.prisma.patientProfile.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        address: dto.address,
        referralSource: dto.referralSource,
        clinicalInfo: dto.clinicalInfo
          ? {
              upsert: {
                create: dto.clinicalInfo,
                update: dto.clinicalInfo,
              },
            }
          : undefined,
      },
      include: { clinicalInfo: true },
    });
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- patients`
Expected: PASS (all tests in the file, including the 4 new ones and every pre-existing test — confirm no regressions).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/patients/dto/update-patient.dto.ts backend/src/modules/patients/patients.service.ts backend/test/patients.e2e-spec.ts
git commit -m "feat: let clinical staff edit a patient's clinical info"
```

---

### Task 2: Backend — slim patient search response

**Files:**
- Modify: `backend/src/modules/patients/patients.service.ts` (only the `search` method, lines 190-200, plus one new import)
- Test: `backend/test/patients.e2e-spec.ts` (add one test inside the existing `'Patients: disable and search'` block)

**Interfaces:**
- Consumes: existing `search(query)` call site in `patients.controller.ts` (`@Get()` handler) — no controller change needed, only the return shape narrows.
- Produces: `PatientsService.search()` now returns `Promise<PatientSearchResult[]>` (`{ id, fullName, nationalId, gender, dateOfBirth, status }`, no `clinicalInfo`) instead of full `PatientProfile[]`. This already matches the shape the frontend's existing `PatientSearchResult` type (`staff-web/src/api/patients.ts`) expects — no frontend change needed for this task.

- [ ] **Step 1: Write the failing test**

In `backend/test/patients.e2e-spec.ts`, inside the `'Patients: disable and search'` describe block, add this test right after the existing `'lets a clinician search patients by name'` test (before `'rejects a PATIENT trying to search'`):

```typescript
  it('does not include clinical info in search results', async () => {
    const clinicianToken = await createClinicianToken('+966500000117', 'password123');
    const patient = await registerActivateAndLogin('+966500000118', 'password123', 'PATIENT');

    await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Findable Clinical Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'SEARCH-CLINICAL-1',
        clinicalInfo: { initialDiagnosis: 'Should not leak into search results' },
      });

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients?q=Findable Clinical')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].fullName).toBe('Findable Clinical Patient');
    expect(response.body[0].clinicalInfo).toBeUndefined();
    expect(Object.keys(response.body[0]).sort()).toEqual(
      ['dateOfBirth', 'gender', 'id', 'nationalId', 'status'].sort(),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- patients`
Expected: FAIL — `response.body[0]` currently has extra keys (`userId`, `address`, `referralSource`, `createdAt`, `updatedAt`, `clinicalInfo`) beyond the 5 expected, so the `Object.keys` equality check fails.

- [ ] **Step 3: Add the response type and slim the query**

In `backend/src/modules/patients/patients.service.ts`, add this import at the top (alongside the existing `@prisma/client` import, which becomes `import { Gender, GuardianLink, PatientProfile, PatientProfileStatus, Role } from '@prisma/client';`):

Add this interface near the top of the file, after the imports:

```typescript
export interface PatientSearchResult {
  id: string;
  fullName: string;
  nationalId: string;
  gender: Gender;
  dateOfBirth: Date;
  status: PatientProfileStatus;
}
```

Replace the `search` method (lines 190-200):

```typescript
  async search(query: string | undefined): Promise<PatientSearchResult[]> {
    return this.prisma.patientProfile.findMany({
      where: query
        ? {
            OR: [{ fullName: { contains: query, mode: 'insensitive' } }, { nationalId: { contains: query } }],
          }
        : undefined,
      select: {
        id: true,
        fullName: true,
        nationalId: true,
        gender: true,
        dateOfBirth: true,
        status: true,
      },
      take: 50,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- patients`
Expected: PASS (all tests, including the new one and the full pre-existing suite).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/patients/patients.service.ts backend/test/patients.e2e-spec.ts
git commit -m "fix: stop leaking clinical info in patient search results"
```

---

### Task 3: Backend — caregiver lookup by mobile number

**Files:**
- Modify: `backend/src/modules/patients/patients.controller.ts` (add one route)
- Modify: `backend/src/modules/patients/patients.service.ts` (add one method, plus `BadRequestException` import already present)
- Test: `backend/test/patients.e2e-spec.ts` (new `describe` block, appended after Task 1's block)

**Interfaces:**
- Consumes: `this.prisma.user` (existing `PrismaService`), `Role.CAREGIVER` enum value.
- Produces: `GET /api/v1/patients/lookup-caregiver?mobile=<mobile>` (permission: `LINK_GUARDIAN`) returning `{ userId: string; fullName: string }`, 404 if no user with that mobile exists or the user isn't a `CAREGIVER`. This exists because the existing `POST /:id/guardian` endpoint requires a `guardianUserId` (UUID) that staff have no way to obtain — they only know a caregiver's phone number. The frontend's Link Guardian form (Task 6) calls this first to resolve a mobile number to a `userId`, then submits the actual link.

- [ ] **Step 1: Write the failing e2e tests**

Append to `backend/test/patients.e2e-spec.ts`, after the `'Patients: edit clinical info'` block added in Task 1 (i.e. now the new end of file):

```typescript
describe('Patients: lookup caregiver by mobile', () => {
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

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
  }

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER') {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Caregiver Lookup Target',
      mobile,
      password,
      role,
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

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
    return loginAs(mobile, password);
  }

  it('resolves a caregiver mobile number to their userId and name', async () => {
    const clinicianToken = await createClinicianToken('+966500000130', 'password123');
    const caregiver = await registerActivateAndLogin('+966500000131', 'password123', 'CAREGIVER');

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/lookup-caregiver?mobile=+966500000131')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: caregiver.userId, fullName: 'Caregiver Lookup Target' });
  });

  it('returns 404 when no user has that mobile number', async () => {
    const clinicianToken = await createClinicianToken('+966500000132', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/lookup-caregiver?mobile=+966500000199')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(404);
  });

  it('returns 404 when the mobile number belongs to a non-caregiver', async () => {
    const clinicianToken = await createClinicianToken('+966500000133', 'password123');
    await registerActivateAndLogin('+966500000134', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/lookup-caregiver?mobile=+966500000134')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(404);
  });

  it('rejects a PATIENT trying to look up a caregiver', async () => {
    const patient = await registerActivateAndLogin('+966500000135', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/lookup-caregiver?mobile=+966500000131')
      .set('Authorization', `Bearer ${patient.token}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- patients`
Expected: FAIL with 404s on all of them — the route doesn't exist yet, so Nest's default 404 handler responds (or, if `:id` swallows `lookup-caregiver` as an id — it will, since `@Get(':id')` is registered before any new route unless placed correctly — verify the failure is a 404/500 either way, confirming the route isn't wired yet).

- [ ] **Step 3: Add the service method**

In `backend/src/modules/patients/patients.service.ts`, add this method (place it near `linkGuardian`, e.g. right before it):

```typescript
  async lookupCaregiverByMobile(mobile: string | undefined): Promise<{ userId: string; fullName: string }> {
    if (!mobile) {
      throw new BadRequestException('mobile query parameter is required');
    }
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user || user.role !== Role.CAREGIVER) {
      throw new NotFoundException('No caregiver found with this mobile number');
    }
    return { userId: user.id, fullName: user.fullName };
  }
```

- [ ] **Step 4: Add the controller route**

In `backend/src/modules/patients/patients.controller.ts`, add the route right after `@Get('me')` and before `@Get(':id')` (literal routes must be declared before the `:id` parameter route, matching how `me` is already ordered):

```typescript
  @Get('lookup-caregiver')
  @RequirePermission(Permission.LINK_GUARDIAN)
  lookupCaregiver(@Query('mobile') mobile?: string) {
    return this.patientsService.lookupCaregiverByMobile(mobile);
  }
```

The full method order in the controller should now be: `create`, `findMine` (`@Get('me')`), `lookupCaregiver` (`@Get('lookup-caregiver')`), `findOne` (`@Get(':id')`), `update`, `linkGuardian`, `search` (`@Get()`), `updateStatus`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- patients`
Expected: PASS (all tests, including the 4 new ones and the full pre-existing suite — this also re-confirms Task 1's and Task 2's tests still pass together in the same file).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/patients/patients.controller.ts backend/src/modules/patients/patients.service.ts backend/test/patients.e2e-spec.ts
git commit -m "feat: add caregiver lookup by mobile number for guardian linking"
```

---

### Task 4: Frontend — permissions helper + assessments/treatment-plans/exercises/patients API clients

**Files:**
- Create: `staff-web/src/auth/permissions.ts`
- Test: `staff-web/src/auth/permissions.test.ts`
- Modify: `staff-web/src/api/patients.ts` (add types and functions)
- Create: `staff-web/src/api/assessments.ts`
- Create: `staff-web/src/api/treatment-plans.ts`
- Create: `staff-web/src/api/exercises.ts`

**Interfaces:**
- Consumes: `StaffRole` type from `staff-web/src/api/auth.ts`; `apiRequest`/`ApiError` from `staff-web/src/api/client.ts`.
- Produces: `canEditClinicalData(role: StaffRole): boolean` (true for `CLINICIAN`/`ADMIN`, false for `SUPERVISOR`) — used by every write-capable section in Tasks 6-8. `patients.ts` gains `PatientProfile`, `ClinicalInfo`, `getPatient(id)`, `updatePatient(id, input)`, `updatePatientStatus(id, status)`, `lookupCaregiver(mobile)`, `linkGuardian(patientId, input)`. `assessments.ts` exports `Assessment`, `AssessmentType`, `AssessmentStatus`, `SeverityCategory`, `BaselineComparison`, `createAssessment`, `listAssessments`, `getAssessment`, `updateAssessment`, `approveAssessment`, `getBaselineComparison`. `treatment-plans.ts` exports `TreatmentPlan`, `TreatmentPhase`, `PlanStatus`, `PlanExercise`, `createTreatmentPlan`, `listTreatmentPlans`, `getActiveTreatmentPlan`, `updateTreatmentPlan`, `transitionPhase`, `linkExercise`, `listPlanExercises`, `unlinkExercise`. `exercises.ts` exports `Exercise`, `listExercises()`. All of these are consumed by Tasks 5-8.

- [ ] **Step 1: Write the failing test for the permissions helper**

Create `staff-web/src/auth/permissions.test.ts`:

```typescript
import { canEditClinicalData } from './permissions';

describe('canEditClinicalData', () => {
  it('returns true for CLINICIAN', () => {
    expect(canEditClinicalData('CLINICIAN')).toBe(true);
  });

  it('returns true for ADMIN', () => {
    expect(canEditClinicalData('ADMIN')).toBe(true);
  });

  it('returns false for SUPERVISOR', () => {
    expect(canEditClinicalData('SUPERVISOR')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/auth/permissions.test.ts`
Expected: FAIL with "Cannot find module './permissions'".

- [ ] **Step 3: Implement the permissions helper**

Create `staff-web/src/auth/permissions.ts`:

```typescript
import type { StaffRole } from '../api/auth';

export function canEditClinicalData(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'ADMIN';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/auth/permissions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Extend the patients API client**

Append to `staff-web/src/api/patients.ts` (keep the existing `Gender`, `PatientProfileStatus`, `PatientSearchResult`, `searchPatients` exactly as they are):

```typescript
export interface ClinicalInfo {
  referralReason?: string;
  initialDiagnosis?: string;
  medicalHistory?: string;
  medications?: string;
  allergies?: string;
  familyHistory?: string;
}

export interface PatientProfile {
  id: string;
  userId: string;
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  nationalId: string;
  address?: string;
  referralSource?: string;
  status: PatientProfileStatus;
  clinicalInfo: ClinicalInfo | null;
}

export function getPatient(id: string): Promise<PatientProfile> {
  return apiRequest(`/api/v1/patients/${id}`, { auth: true });
}

export interface UpdatePatientInput {
  fullName?: string;
  address?: string;
  referralSource?: string;
  clinicalInfo?: ClinicalInfo;
}

export function updatePatient(id: string, input: UpdatePatientInput): Promise<PatientProfile> {
  return apiRequest(`/api/v1/patients/${id}`, { method: 'PUT', body: input, auth: true });
}

export function updatePatientStatus(id: string, status: PatientProfileStatus): Promise<PatientProfile> {
  return apiRequest(`/api/v1/patients/${id}/status`, { method: 'PATCH', body: { status }, auth: true });
}

export interface CaregiverLookupResult {
  userId: string;
  fullName: string;
}

export function lookupCaregiver(mobile: string): Promise<CaregiverLookupResult> {
  return apiRequest(`/api/v1/patients/lookup-caregiver?mobile=${encodeURIComponent(mobile)}`, { auth: true });
}

export function linkGuardian(patientId: string, input: { guardianUserId: string; relationship: string }): Promise<void> {
  return apiRequest(`/api/v1/patients/${patientId}/guardian`, { method: 'POST', body: input, auth: true });
}
```

- [ ] **Step 6: Create the assessments API client**

Create `staff-web/src/api/assessments.ts`:

```typescript
import { apiRequest } from './client';

export type AssessmentType = 'INITIAL' | 'PERIODIC' | 'FINAL';
export type AssessmentStatus = 'DRAFT' | 'APPROVED';
export type SeverityCategory = 'MILD' | 'MODERATE' | 'SEVERE' | 'VERY_SEVERE';

export interface Assessment {
  id: string;
  patientProfileId: string;
  clinicianUserId: string;
  type: AssessmentType;
  status: AssessmentStatus;
  medicalHistory?: string;
  difficultSituations?: string;
  anxietyLevel?: string;
  initialGoals?: string;
  clinicianNotes?: string;
  ssi4Frequency?: number;
  ssi4Duration?: number;
  ssi4PhysicalConcomitants?: number;
  ssi4Total?: number;
  severityCategory?: SeverityCategory;
  approvedAt?: string;
  createdAt: string;
}

export interface BaselineComparison {
  current: Assessment;
  baseline: Assessment | null;
  delta: {
    ssi4FrequencyDelta: number;
    ssi4DurationDelta: number;
    ssi4PhysicalConcomitantsDelta: number;
    ssi4TotalDelta: number;
  } | null;
}

export function createAssessment(patientId: string, type: AssessmentType): Promise<Assessment> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments`, { method: 'POST', body: { type }, auth: true });
}

export function listAssessments(patientId: string): Promise<Assessment[]> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments`, { auth: true });
}

export function getAssessment(patientId: string, id: string): Promise<Assessment> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments/${id}`, { auth: true });
}

export interface UpdateAssessmentInput {
  medicalHistory?: string;
  difficultSituations?: string;
  anxietyLevel?: string;
  initialGoals?: string;
  clinicianNotes?: string;
  ssi4Frequency?: number;
  ssi4Duration?: number;
  ssi4PhysicalConcomitants?: number;
  ssi4Total?: number;
}

export function updateAssessment(patientId: string, id: string, input: UpdateAssessmentInput): Promise<Assessment> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments/${id}`, { method: 'PUT', body: input, auth: true });
}

export function approveAssessment(patientId: string, id: string, severityCategory: SeverityCategory): Promise<Assessment> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments/${id}/approve`, {
    method: 'POST',
    body: { severityCategory },
    auth: true,
  });
}

export function getBaselineComparison(patientId: string, id: string): Promise<BaselineComparison> {
  return apiRequest(`/api/v1/patients/${patientId}/assessments/${id}/baseline-comparison`, { auth: true });
}
```

- [ ] **Step 7: Create the treatment-plans API client**

Create `staff-web/src/api/treatment-plans.ts`:

```typescript
import { apiRequest } from './client';

export type TreatmentPhase = 'PHASE_1' | 'PHASE_2' | 'PHASE_3' | 'PHASE_4' | 'PHASE_5';
export type PlanStatus = 'ACTIVE' | 'INACTIVE';

export interface TreatmentPlan {
  id: string;
  patientProfileId: string;
  clinicianUserId: string;
  assessmentId: string;
  phase: TreatmentPhase;
  goals: string;
  reviewDate: string;
  status: PlanStatus;
  createdAt: string;
}

export function createTreatmentPlan(
  patientId: string,
  input: { assessmentId: string; goals: string; reviewDate: string },
): Promise<TreatmentPlan> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans`, { method: 'POST', body: input, auth: true });
}

export function listTreatmentPlans(patientId: string): Promise<TreatmentPlan[]> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans`, { auth: true });
}

export function getActiveTreatmentPlan(patientId: string): Promise<TreatmentPlan> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/active`, { auth: true });
}

export function updateTreatmentPlan(
  patientId: string,
  id: string,
  input: { goals?: string; reviewDate?: string },
): Promise<TreatmentPlan> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${id}`, { method: 'PUT', body: input, auth: true });
}

export function transitionPhase(
  patientId: string,
  id: string,
  input: { toPhase: TreatmentPhase; rationale?: string },
): Promise<TreatmentPlan> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${id}/phase-transition`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export interface PlanExercise {
  id: string;
  exerciseId: string;
  frequencyPerWeek: number;
  sequence: number;
  exercise: {
    id: string;
    title: string;
    category: string;
    phaseLevel: number;
    durationMinutes: number;
  };
}

export function linkExercise(
  patientId: string,
  planId: string,
  input: { exerciseId: string; frequencyPerWeek: number; sequence: number },
): Promise<PlanExercise> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${planId}/exercises`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function listPlanExercises(patientId: string, planId: string): Promise<PlanExercise[]> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${planId}/exercises`, { auth: true });
}

export function unlinkExercise(patientId: string, planId: string, exerciseId: string): Promise<void> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${planId}/exercises/${exerciseId}`, {
    method: 'DELETE',
    auth: true,
  });
}
```

- [ ] **Step 8: Create the exercises API client**

Create `staff-web/src/api/exercises.ts`:

```typescript
import { apiRequest } from './client';

export interface Exercise {
  id: string;
  title: string;
  category: string;
  phaseLevel: number;
  instructions: string;
  durationMinutes: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export function listExercises(): Promise<Exercise[]> {
  return apiRequest('/api/v1/exercises', { auth: true });
}
```

- [ ] **Step 9: Type-check and build**

Run: `npx tsc -b --noEmit` (from `staff-web/`)
Expected: no errors.
Run: `npm run build` (from `staff-web/`)
Expected: builds successfully.

- [ ] **Step 10: Commit**

```bash
git add staff-web/src/auth/permissions.ts staff-web/src/auth/permissions.test.ts staff-web/src/api/patients.ts staff-web/src/api/assessments.ts staff-web/src/api/treatment-plans.ts staff-web/src/api/exercises.ts
git commit -m "feat: add permissions helper and API clients for assessments/treatment-plans/exercises"
```

---

### Task 5: Frontend — PatientDetailProvider, PatientDetailPage shell, and routing

**Files:**
- Create: `staff-web/src/patients/PatientDetailContext.tsx`
- Test: `staff-web/src/patients/PatientDetailContext.test.tsx`
- Create: `staff-web/src/pages/PatientDetailPage.tsx`
- Test: `staff-web/src/pages/PatientDetailPage.test.tsx`
- Modify: `staff-web/src/App.tsx` (add route)
- Modify: `staff-web/src/pages/PatientsPage.tsx` (make rows clickable)
- Test: `staff-web/src/pages/PatientsPage.test.tsx` (add navigation test)
- Modify: `staff-web/src/copy/ar.ts` (add `patientDetail` namespace — only the keys this task needs; Tasks 6-8 add more)

**Interfaces:**
- Consumes: `getPatient` from Task 4's `patients.ts`; `useParams`/`useNavigate` from `react-router-dom`; `RequireAuth`, `AppShell` from sub-project 1.
- Produces: `PatientDetailProvider({ patientId, children })` + `usePatientDetail(): { patient: PatientProfile | null; loading: boolean; error: string | null; refresh: () => Promise<void> }` — consumed by Tasks 6-8's sections. `PatientDetailPage` is the component mounted at route `/patients/:id`, rendering the three sections (Tasks 6-8 will replace inline placeholders with the real sections one at a time — this task creates the page with a placeholder `<Text>` for each section so the route and provider are fully working end-to-end before the sections exist).

- [ ] **Step 1: Write the failing test for PatientDetailContext**

Create `staff-web/src/patients/PatientDetailContext.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { PatientDetailProvider, usePatientDetail } from './PatientDetailContext';
import { getPatient } from '../api/patients';

vi.mock('../api/patients');

function Probe() {
  const { patient, loading, error } = usePatientDetail();
  if (loading) return <div>loading</div>;
  if (error) return <div>{error}</div>;
  return <div>{patient?.fullName}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PatientDetailProvider', () => {
  it('loads the patient on mount', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'patient-1',
      fullName: 'محمد العتيبي',
      clinicalInfo: null,
    });

    render(
      <PatientDetailProvider patientId="patient-1">
        <Probe />
      </PatientDetailProvider>,
    );

    expect(screen.getByText('loading')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('محمد العتيبي')).toBeTruthy();
    });
    expect(getPatient).toHaveBeenCalledWith('patient-1');
  });

  it('surfaces a load error', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    render(
      <PatientDetailProvider patientId="patient-1">
        <Probe />
      </PatientDetailProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('تعذر تحميل بيانات المريض')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/patients/PatientDetailContext.test.tsx`
Expected: FAIL with "Cannot find module './PatientDetailContext'".

- [ ] **Step 3: Add the `patientDetail` copy namespace**

In `staff-web/src/copy/ar.ts`, add a new top-level key after `patients` (before `errors`):

```typescript
  patientDetail: {
    loadError: 'تعذر تحميل بيانات المريض',
  },
```

- [ ] **Step 4: Implement PatientDetailContext**

Create `staff-web/src/patients/PatientDetailContext.tsx`:

```typescript
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getPatient } from '../api/patients';
import type { PatientProfile } from '../api/patients';
import { ar } from '../copy/ar';

interface PatientDetailContextValue {
  patient: PatientProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PatientDetailContext = createContext<PatientDetailContextValue | undefined>(undefined);

export function PatientDetailProvider({ patientId, children }: { patientId: string; children: ReactNode }) {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const found = await getPatient(patientId);
      setPatient(found);
    } catch {
      setError(ar.patientDetail.loadError);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <PatientDetailContext.Provider value={{ patient, loading, error, refresh }}>
      {children}
    </PatientDetailContext.Provider>
  );
}

export function usePatientDetail(): PatientDetailContextValue {
  const ctx = useContext(PatientDetailContext);
  if (!ctx) {
    throw new Error('usePatientDetail must be used within a PatientDetailProvider');
  }
  return ctx;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/patients/PatientDetailContext.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing test for PatientDetailPage**

Create `staff-web/src/pages/PatientDetailPage.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PatientDetailPage } from './PatientDetailPage';
import { getPatient } from '../api/patients';

vi.mock('../api/patients');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PatientDetailPage', () => {
  it('shows the patient name and status once loaded', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'patient-1',
      fullName: 'سارة الحربي',
      status: 'ACTIVE',
      clinicalInfo: null,
    });

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/patients/patient-1']}>
          <Routes>
            <Route path="/patients/:id" element={<PatientDetailPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('سارة الحربي')).toBeTruthy();
    });
    expect(getPatient).toHaveBeenCalledWith('patient-1');
  });

  it('shows a load error when the patient cannot be fetched', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/patients/patient-1']}>
          <Routes>
            <Route path="/patients/:id" element={<PatientDetailPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('تعذر تحميل بيانات المريض')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- --run src/pages/PatientDetailPage.test.tsx`
Expected: FAIL with "Cannot find module './PatientDetailPage'".

- [ ] **Step 8: Implement PatientDetailPage**

Create `staff-web/src/pages/PatientDetailPage.tsx`:

```typescript
import { useParams } from 'react-router-dom';
import { Container, Title, Badge, Group, Loader, Alert, Stack, Text } from '@mantine/core';
import { ar } from '../copy/ar';
import { PatientDetailProvider, usePatientDetail } from '../patients/PatientDetailContext';

function PatientDetailContent() {
  const { patient, loading, error } = usePatientDetail();

  if (loading) {
    return <Loader />;
  }
  if (error || !patient) {
    return <Alert color="red">{error ?? ar.patientDetail.loadError}</Alert>;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{patient.fullName}</Title>
        <Badge color={patient.status === 'ACTIVE' ? 'green' : 'gray'}>
          {ar.patients.statuses[patient.status]}
        </Badge>
      </Group>
      <Text c="dimmed">{patient.nationalId}</Text>
    </Stack>
  );
}

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return null;
  }
  return (
    <Container size="lg">
      <PatientDetailProvider patientId={id}>
        <PatientDetailContent />
      </PatientDetailProvider>
    </Container>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- --run src/pages/PatientDetailPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 10: Wire the route**

In `staff-web/src/App.tsx`, add the import and the new route (inside the existing `RequireAuth`+`AppShell` wrapping, mirroring the `/patients` route exactly):

```typescript
import { PatientDetailPage } from './pages/PatientDetailPage';
```

```typescript
          <Route
            path="/patients/:id"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientDetailPage />
                </AppShell>
              </RequireAuth>
            }
          />
```

Place this new `<Route>` immediately after the existing `/patients` route, before the closing `</Routes>`.

- [ ] **Step 11: Make search results clickable**

In `staff-web/src/pages/PatientsPage.tsx`, add the `useNavigate` import and wire row clicks. Replace the imports line:

```typescript
import { useNavigate } from 'react-router-dom';
```

(add this alongside the existing imports at the top of the file). Then replace the `<Table.Tr key={patient.id}>` row (inside the `results.map`) with:

```typescript
              <Table.Tr
                key={patient.id}
                onClick={() => navigate(`/patients/${patient.id}`)}
                style={{ cursor: 'pointer' }}
              >
```

And add `const navigate = useNavigate();` inside the `PatientsPage` function body, alongside the existing `useState` declarations.

- [ ] **Step 12: Add the navigation test**

In `staff-web/src/pages/PatientsPage.test.tsx`, add this import at the top:

```typescript
import { MemoryRouter, Route, Routes } from 'react-router-dom';
```

Wrap every existing `render(<MantineProvider>...)` call's children with `<MemoryRouter><Routes><Route path="/patients" element={...} /></Routes></MemoryRouter>`, or more simply just `<MemoryRouter><PatientsPage /></MemoryRouter>` for the 4 existing `it(...)` blocks that don't test navigation (i.e. `<MantineProvider><MemoryRouter><PatientsPage /></MemoryRouter></MantineProvider>` — `PatientsPage` now calls `useNavigate`, which throws outside a Router context). Then add this new test at the end of the `describe` block, which needs the fuller `Routes`/`Route` setup so the navigation target actually renders and can be asserted on:

```typescript
  it('navigates to the patient detail page when a row is clicked', async () => {
    (searchPatients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'patient-42',
        fullName: 'خالد القحطاني',
        nationalId: '9998887770',
        gender: 'MALE',
        dateOfBirth: '1988-01-01T00:00:00.000Z',
        status: 'ACTIVE',
      },
    ]);

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/patients']}>
          <Routes>
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/patients/:id" element={<div>patient detail page</div>} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'خالد' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(() => {
      expect(screen.getByText('خالد القحطاني')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('خالد القحطاني'));
    await waitFor(() => {
      expect(screen.getByText('patient detail page')).toBeTruthy();
    });
  });
```

Also add `Route, Routes` to the `react-router-dom` import line for this one test's sake: `import { MemoryRouter, Route, Routes } from 'react-router-dom';`.

- [ ] **Step 13: Run all affected frontend tests**

Run: `npm test -- --run src/pages/PatientsPage.test.tsx src/pages/PatientDetailPage.test.tsx src/patients/PatientDetailContext.test.tsx src/App.test.tsx`
Expected: PASS (all tests — `App.test.tsx` may need no changes since it likely only checks the `/login` redirect, but run it to confirm no regression from the new route).

- [ ] **Step 14: Type-check and build**

Run: `npx tsc -b --noEmit` (from `staff-web/`)
Expected: no errors.
Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 15: Commit**

```bash
git add staff-web/src/patients/PatientDetailContext.tsx staff-web/src/patients/PatientDetailContext.test.tsx staff-web/src/pages/PatientDetailPage.tsx staff-web/src/pages/PatientDetailPage.test.tsx staff-web/src/App.tsx staff-web/src/pages/PatientsPage.tsx staff-web/src/pages/PatientsPage.test.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add Patient Detail Hub route and make patient search rows clickable"
```

---

### Task 6: Frontend — Profile section

**Files:**
- Create: `staff-web/src/patients/ProfileSection.tsx`
- Test: `staff-web/src/patients/ProfileSection.test.tsx`
- Modify: `staff-web/src/pages/PatientDetailPage.tsx` (render `ProfileSection` instead of the inline national-ID line)
- Modify: `staff-web/src/copy/ar.ts` (extend `patientDetail`)

**Interfaces:**
- Consumes: `usePatientDetail()` from Task 5; `useAuth()` from sub-project 1's `AuthProvider`; `canEditClinicalData` from Task 4; `updatePatient`, `updatePatientStatus`, `lookupCaregiver`, `linkGuardian` from Task 4's `patients.ts`.
- Produces: `ProfileSection` component, self-contained (reads patient from context, no props). Later tasks (`AssessmentsSection`, `TreatmentPlanSection`) follow the identical structural pattern (own state, own `usePatientDetail()` + `useAuth()` calls, own `canEdit` gate) — this task establishes that pattern.

- [ ] **Step 1: Extend the copy module**

In `staff-web/src/copy/ar.ts`, replace the `patientDetail` block added in Task 5 with:

```typescript
  patientDetail: {
    loadError: 'تعذر تحميل بيانات المريض',
    profileTitle: 'الملف الشخصي',
    fullNameLabel: 'الاسم الكامل',
    nationalIdLabel: 'رقم الهوية',
    addressLabel: 'العنوان',
    referralSourceLabel: 'مصدر الإحالة',
    initialDiagnosisLabel: 'التشخيص الأولي',
    medicalHistoryLabel: 'التاريخ المرضي',
    medicationsLabel: 'الأدوية',
    allergiesLabel: 'الحساسية',
    familyHistoryLabel: 'التاريخ العائلي',
    editButton: 'تعديل',
    saveButton: 'حفظ',
    cancelButton: 'إلغاء',
    disableButton: 'تعطيل الحساب',
    enableButton: 'تفعيل الحساب',
    linkGuardianTitle: 'ربط ولي أمر',
    guardianMobileLabel: 'رقم جوال ولي الأمر',
    linkGuardianButton: 'ربط',
  },
```

- [ ] **Step 2: Write the failing test**

Create `staff-web/src/patients/ProfileSection.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ProfileSection } from './ProfileSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient, updatePatient, updatePatientStatus, lookupCaregiver, linkGuardian } from '../api/patients';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/auth');
vi.mock('../storage/session');

const basePatient = {
  id: 'patient-1',
  userId: 'user-1',
  fullName: 'نورة الشمري',
  gender: 'FEMALE',
  dateOfBirth: '2000-01-01',
  nationalId: '1112223334',
  address: 'الرياض',
  referralSource: 'مستشفى',
  status: 'ACTIVE',
  clinicalInfo: { initialDiagnosis: 'تلعثم متوسط' },
};

function renderSection(role: 'CLINICIAN' | 'SUPERVISOR' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue(basePatient);

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <ProfileSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProfileSection', () => {
  it('shows the patient fields including clinical info once loaded', async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('تلعثم متوسط')).toBeTruthy();
    });
  });

  it('lets a clinician edit and save clinical info', async () => {
    (updatePatient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...basePatient,
      clinicalInfo: { initialDiagnosis: 'تلعثم شديد' },
    });
    renderSection();

    await waitFor(() => expect(screen.getByText('تلعثم متوسط')).toBeTruthy());
    fireEvent.click(screen.getByText('تعديل'));
    fireEvent.submit(screen.getByTestId('profile-edit-form'));

    await waitFor(() => {
      expect(updatePatient).toHaveBeenCalledWith('patient-1', expect.objectContaining({ fullName: 'نورة الشمري' }));
    });
  });

  it('hides edit and status controls for a SUPERVISOR', async () => {
    renderSection('SUPERVISOR');
    await waitFor(() => expect(screen.getByText('تلعثم متوسط')).toBeTruthy());
    expect(screen.queryByText('تعديل')).toBeNull();
    expect(screen.queryByText('تعطيل الحساب')).toBeNull();
  });

  it('looks up and links a guardian by mobile number', async () => {
    (lookupCaregiver as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'guardian-1', fullName: 'ولي الأمر' });
    (linkGuardian as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    renderSection();

    await waitFor(() => expect(screen.getByText('تلعثم متوسط')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('رقم جوال ولي الأمر'), { target: { value: '+966500000199' } });
    fireEvent.submit(screen.getByTestId('link-guardian-form'));

    await waitFor(() => {
      expect(lookupCaregiver).toHaveBeenCalledWith('+966500000199');
      expect(linkGuardian).toHaveBeenCalledWith('patient-1', { guardianUserId: 'guardian-1', relationship: 'GUARDIAN' });
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run src/patients/ProfileSection.test.tsx`
Expected: FAIL with "Cannot find module './ProfileSection'".

- [ ] **Step 4: Implement ProfileSection**

Create `staff-web/src/patients/ProfileSection.tsx`:

```typescript
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Title, Text, Stack, Group, Button, TextInput, Textarea, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canEditClinicalData } from '../auth/permissions';
import { updatePatient, updatePatientStatus, lookupCaregiver, linkGuardian } from '../api/patients';
import { ApiError } from '../api/client';

export function ProfileSection() {
  const { patient, refresh } = usePatientDetail();
  const { user } = useAuth();
  const canEdit = user ? canEditClinicalData(user.role) : false;

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [initialDiagnosis, setInitialDiagnosis] = useState('');
  const [medicalHistory, setMedicalHistory] = useState('');
  const [medications, setMedications] = useState('');
  const [allergies, setAllergies] = useState('');
  const [familyHistory, setFamilyHistory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [guardianMobile, setGuardianMobile] = useState('');
  const [linkingGuardian, setLinkingGuardian] = useState(false);
  const [guardianError, setGuardianError] = useState<string | null>(null);

  if (!patient) {
    return null;
  }

  function startEditing() {
    setFullName(patient.fullName);
    setAddress(patient.address ?? '');
    setReferralSource(patient.referralSource ?? '');
    setInitialDiagnosis(patient.clinicalInfo?.initialDiagnosis ?? '');
    setMedicalHistory(patient.clinicalInfo?.medicalHistory ?? '');
    setMedications(patient.clinicalInfo?.medications ?? '');
    setAllergies(patient.clinicalInfo?.allergies ?? '');
    setFamilyHistory(patient.clinicalInfo?.familyHistory ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updatePatient(patient.id, {
        fullName,
        address,
        referralSource,
        clinicalInfo: { initialDiagnosis, medicalHistory, medications, allergies, familyHistory },
      });
      await refresh();
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus() {
    const nextStatus = patient.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await updatePatientStatus(patient.id, nextStatus);
    await refresh();
  }

  async function handleLinkGuardian(event: FormEvent) {
    event.preventDefault();
    setGuardianError(null);
    setLinkingGuardian(true);
    try {
      const found = await lookupCaregiver(guardianMobile);
      await linkGuardian(patient.id, { guardianUserId: found.userId, relationship: 'GUARDIAN' });
      setGuardianMobile('');
      await refresh();
    } catch (err) {
      setGuardianError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setLinkingGuardian(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.patientDetail.profileTitle}</Title>

      {editing ? (
        <form data-testid="profile-edit-form" onSubmit={handleSubmit}>
          <Stack>
            {error ? <Alert color="red">{error}</Alert> : null}
            <TextInput label={ar.patientDetail.fullNameLabel} value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
            <TextInput label={ar.patientDetail.addressLabel} value={address} onChange={(e) => setAddress(e.currentTarget.value)} />
            <TextInput label={ar.patientDetail.referralSourceLabel} value={referralSource} onChange={(e) => setReferralSource(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.initialDiagnosisLabel} value={initialDiagnosis} onChange={(e) => setInitialDiagnosis(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.medicalHistoryLabel} value={medicalHistory} onChange={(e) => setMedicalHistory(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.medicationsLabel} value={medications} onChange={(e) => setMedications(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.allergiesLabel} value={allergies} onChange={(e) => setAllergies(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.familyHistoryLabel} value={familyHistory} onChange={(e) => setFamilyHistory(e.currentTarget.value)} />
            <Group>
              <Button type="submit" loading={submitting}>{ar.patientDetail.saveButton}</Button>
              <Button variant="subtle" onClick={() => setEditing(false)}>{ar.patientDetail.cancelButton}</Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <Stack gap="xs">
          <Text><b>{ar.patientDetail.fullNameLabel}:</b> {patient.fullName}</Text>
          <Text><b>{ar.patientDetail.nationalIdLabel}:</b> {patient.nationalId}</Text>
          <Text><b>{ar.patientDetail.addressLabel}:</b> {patient.address ?? '—'}</Text>
          <Text><b>{ar.patientDetail.referralSourceLabel}:</b> {patient.referralSource ?? '—'}</Text>
          <Text><b>{ar.patientDetail.initialDiagnosisLabel}:</b> {patient.clinicalInfo?.initialDiagnosis ?? '—'}</Text>
          <Text><b>{ar.patientDetail.medicalHistoryLabel}:</b> {patient.clinicalInfo?.medicalHistory ?? '—'}</Text>
          <Text><b>{ar.patientDetail.medicationsLabel}:</b> {patient.clinicalInfo?.medications ?? '—'}</Text>
          <Text><b>{ar.patientDetail.allergiesLabel}:</b> {patient.clinicalInfo?.allergies ?? '—'}</Text>
          <Text><b>{ar.patientDetail.familyHistoryLabel}:</b> {patient.clinicalInfo?.familyHistory ?? '—'}</Text>
          {canEdit ? (
            <Group mt="sm">
              <Button onClick={startEditing}>{ar.patientDetail.editButton}</Button>
              <Button color={patient.status === 'ACTIVE' ? 'red' : 'green'} variant="outline" onClick={toggleStatus}>
                {patient.status === 'ACTIVE' ? ar.patientDetail.disableButton : ar.patientDetail.enableButton}
              </Button>
            </Group>
          ) : null}
        </Stack>
      )}

      {canEdit ? (
        <>
          <Title order={4} mt="lg" mb="xs">{ar.patientDetail.linkGuardianTitle}</Title>
          <form data-testid="link-guardian-form" onSubmit={handleLinkGuardian}>
            <Group align="flex-end">
              {guardianError ? <Alert color="red">{guardianError}</Alert> : null}
              <TextInput
                label={ar.patientDetail.guardianMobileLabel}
                value={guardianMobile}
                onChange={(e) => setGuardianMobile(e.currentTarget.value)}
              />
              <Button type="submit" loading={linkingGuardian}>{ar.patientDetail.linkGuardianButton}</Button>
            </Group>
          </form>
        </>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/patients/ProfileSection.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire ProfileSection into PatientDetailPage**

In `staff-web/src/pages/PatientDetailPage.tsx`, add the import:

```typescript
import { ProfileSection } from '../patients/ProfileSection';
```

Replace the `<Text c="dimmed">{patient.nationalId}</Text>` line in `PatientDetailContent` with:

```typescript
      <ProfileSection />
```

- [ ] **Step 7: Run the page test again**

Run: `npm test -- --run src/pages/PatientDetailPage.test.tsx`
Expected: PASS (the page test's assertions still hold — patient name and status render, now alongside the full profile section).

- [ ] **Step 8: Type-check and build**

Run: `npx tsc -b --noEmit` (from `staff-web/`)
Expected: no errors.
Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 9: Commit**

```bash
git add staff-web/src/patients/ProfileSection.tsx staff-web/src/patients/ProfileSection.test.tsx staff-web/src/pages/PatientDetailPage.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add patient profile view/edit section to the Patient Detail Hub"
```

---

### Task 7: Frontend — Assessments section

**Files:**
- Create: `staff-web/src/patients/AssessmentsSection.tsx`
- Test: `staff-web/src/patients/AssessmentsSection.test.tsx`
- Modify: `staff-web/src/pages/PatientDetailPage.tsx` (render `AssessmentsSection`)
- Modify: `staff-web/src/copy/ar.ts` (extend `patientDetail`)

**Interfaces:**
- Consumes: `usePatientDetail()` (for `patient.id`), `useAuth()` + `canEditClinicalData` (same gating pattern as Task 6), `listAssessments`/`createAssessment`/`updateAssessment`/`approveAssessment`/`getBaselineComparison` from Task 4's `assessments.ts`.
- Produces: `AssessmentsSection` component, self-contained. Task 8's `TreatmentPlanSection` also calls `listAssessments` (filtered client-side to `APPROVED`) to populate its "create plan" dropdown — no shared state between the two sections, each fetches independently (matches this app's existing pattern of sections/pages owning their own data).

- [ ] **Step 1: Extend the copy module**

In `staff-web/src/copy/ar.ts`, add these keys inside the existing `patientDetail` object (after `linkGuardianButton`):

```typescript
    assessmentsTitle: 'التقييمات',
    noAssessments: 'لا توجد تقييمات بعد',
    assessmentTypeLabel: 'النوع',
    assessmentStatusLabel: 'الحالة',
    assessmentDateLabel: 'التاريخ',
    assessmentTypes: { INITIAL: 'أولي', PERIODIC: 'دوري', FINAL: 'نهائي' } as Record<string, string>,
    assessmentStatuses: { DRAFT: 'مسودة', APPROVED: 'معتمد' } as Record<string, string>,
    newAssessmentButton: 'تقييم جديد',
    difficultSituationsLabel: 'المواقف الصعبة',
    anxietyLevelLabel: 'مستوى القلق',
    initialGoalsLabel: 'الأهداف الأولية',
    clinicianNotesLabel: 'ملاحظات الأخصائي',
    ssi4FrequencyLabel: 'SSI-4: التكرار',
    ssi4DurationLabel: 'SSI-4: المدة',
    ssi4PhysicalConcomitantsLabel: 'SSI-4: الأعراض الجسدية المصاحبة',
    ssi4TotalLabel: 'SSI-4: المجموع',
    approveButton: 'اعتماد',
    severityCategoryLabel: 'درجة الشدة',
    severityCategories: {
      MILD: 'خفيفة',
      MODERATE: 'متوسطة',
      SEVERE: 'شديدة',
      VERY_SEVERE: 'شديدة جدًا',
    } as Record<string, string>,
    baselineComparisonButton: 'مقارنة بالتقييم الأساسي',
    baselineComparisonTitle: 'مقارنة بالتقييم الأساسي',
    noBaselineYet: 'لا تتوفر بيانات كافية للمقارنة',
```

- [ ] **Step 2: Write the failing test**

Create `staff-web/src/patients/AssessmentsSection.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AssessmentsSection } from './AssessmentsSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { listAssessments, createAssessment, approveAssessment } from '../api/assessments';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/assessments');
vi.mock('../api/auth');
vi.mock('../storage/session');

const draftAssessment = {
  id: 'assessment-1',
  patientProfileId: 'patient-1',
  clinicianUserId: 'staff-1',
  type: 'INITIAL',
  status: 'DRAFT',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderSection(role: 'CLINICIAN' | 'SUPERVISOR' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <AssessmentsSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AssessmentsSection', () => {
  it('shows the empty state when there are no assessments', async () => {
    (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد تقييمات بعد')).toBeTruthy();
    });
  });

  it('creates a new draft assessment and opens its intake form', async () => {
    (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (createAssessment as ReturnType<typeof vi.fn>).mockResolvedValue(draftAssessment);
    renderSection();

    await waitFor(() => expect(screen.getByText('لا توجد تقييمات بعد')).toBeTruthy());
    fireEvent.click(screen.getByText('تقييم جديد'));

    await waitFor(() => {
      expect(createAssessment).toHaveBeenCalledWith('patient-1', 'INITIAL');
      expect(screen.getByTestId('assessment-intake-form')).toBeTruthy();
    });
  });

  it('approves a draft assessment with the selected severity category', async () => {
    (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([draftAssessment]);
    (approveAssessment as ReturnType<typeof vi.fn>).mockResolvedValue({ ...draftAssessment, status: 'APPROVED', severityCategory: 'MILD' });
    renderSection();

    await waitFor(() => expect(screen.getByText('أولي')).toBeTruthy());
    fireEvent.click(screen.getByText('أولي'));
    await waitFor(() => expect(screen.getByText('اعتماد')).toBeTruthy());
    fireEvent.click(screen.getByText('اعتماد'));

    await waitFor(() => {
      expect(approveAssessment).toHaveBeenCalledWith('patient-1', 'assessment-1', 'MILD');
    });
  });

  it('hides creation and approval controls for a SUPERVISOR', async () => {
    (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([draftAssessment]);
    renderSection('SUPERVISOR');

    await waitFor(() => expect(screen.getByText('أولي')).toBeTruthy());
    expect(screen.queryByText('تقييم جديد')).toBeNull();
    fireEvent.click(screen.getByText('أولي'));
    await waitFor(() => {
      expect(screen.queryByTestId('assessment-intake-form')).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run src/patients/AssessmentsSection.test.tsx`
Expected: FAIL with "Cannot find module './AssessmentsSection'".

- [ ] **Step 4: Implement AssessmentsSection**

Create `staff-web/src/patients/AssessmentsSection.tsx`:

```typescript
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Title, Table, Button, Group, Select, Stack, Textarea, NumberInput, Alert, Text, Badge } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canEditClinicalData } from '../auth/permissions';
import {
  listAssessments,
  createAssessment,
  updateAssessment,
  approveAssessment,
  getBaselineComparison,
} from '../api/assessments';
import type { Assessment, AssessmentType, SeverityCategory, BaselineComparison } from '../api/assessments';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function AssessmentsSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();
  const canEdit = user ? canEditClinicalData(user.role) : false;

  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newType, setNewType] = useState<AssessmentType>('INITIAL');
  const [creating, setCreating] = useState(false);

  const [medicalHistory, setMedicalHistory] = useState('');
  const [difficultSituations, setDifficultSituations] = useState('');
  const [anxietyLevel, setAnxietyLevel] = useState('');
  const [initialGoals, setInitialGoals] = useState('');
  const [clinicianNotes, setClinicianNotes] = useState('');
  const [ssi4Frequency, setSsi4Frequency] = useState<number | ''>('');
  const [ssi4Duration, setSsi4Duration] = useState<number | ''>('');
  const [ssi4PhysicalConcomitants, setSsi4PhysicalConcomitants] = useState<number | ''>('');
  const [ssi4Total, setSsi4Total] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [severityCategory, setSeverityCategory] = useState<SeverityCategory>('MILD');
  const [approving, setApproving] = useState(false);
  const [baseline, setBaseline] = useState<BaselineComparison | null>(null);

  async function refreshList() {
    if (!patient) return;
    const found = await listAssessments(patient.id);
    setAssessments(found);
  }

  useEffect(() => {
    if (!patient) return;
    setError(null);
    listAssessments(patient.id)
      .then(setAssessments)
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  const selected = assessments?.find((a) => a.id === selectedId) ?? null;

  function selectAssessment(assessment: Assessment) {
    setSelectedId(assessment.id);
    setBaseline(null);
    setMedicalHistory(assessment.medicalHistory ?? '');
    setDifficultSituations(assessment.difficultSituations ?? '');
    setAnxietyLevel(assessment.anxietyLevel ?? '');
    setInitialGoals(assessment.initialGoals ?? '');
    setClinicianNotes(assessment.clinicianNotes ?? '');
    setSsi4Frequency(assessment.ssi4Frequency ?? '');
    setSsi4Duration(assessment.ssi4Duration ?? '');
    setSsi4PhysicalConcomitants(assessment.ssi4PhysicalConcomitants ?? '');
    setSsi4Total(assessment.ssi4Total ?? '');
    setSeverityCategory(assessment.severityCategory ?? 'MILD');
  }

  async function handleCreate() {
    if (!patient) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createAssessment(patient.id, newType);
      await refreshList();
      selectAssessment(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setCreating(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!patient || !selected) return;
    setSaveError(null);
    setSaving(true);
    try {
      await updateAssessment(patient.id, selected.id, {
        medicalHistory,
        difficultSituations,
        anxietyLevel,
        initialGoals,
        clinicianNotes,
        ssi4Frequency: ssi4Frequency === '' ? undefined : ssi4Frequency,
        ssi4Duration: ssi4Duration === '' ? undefined : ssi4Duration,
        ssi4PhysicalConcomitants: ssi4PhysicalConcomitants === '' ? undefined : ssi4PhysicalConcomitants,
        ssi4Total: ssi4Total === '' ? undefined : ssi4Total,
      });
      await refreshList();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (!patient || !selected) return;
    setApproving(true);
    setSaveError(null);
    try {
      const approved = await approveAssessment(patient.id, selected.id, severityCategory);
      await refreshList();
      selectAssessment(approved);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setApproving(false);
    }
  }

  async function handleShowBaseline() {
    if (!patient || !selected) return;
    const comparison = await getBaselineComparison(patient.id, selected.id);
    setBaseline(comparison);
  }

  if (!patient) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.patientDetail.assessmentsTitle}</Title>

      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {assessments === null ? null : assessments.length === 0 ? (
        <Text c="dimmed" mb="sm">{ar.patientDetail.noAssessments}</Text>
      ) : (
        <Table mb="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.patientDetail.assessmentTypeLabel}</Table.Th>
              <Table.Th>{ar.patientDetail.assessmentStatusLabel}</Table.Th>
              <Table.Th>{ar.patientDetail.assessmentDateLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {assessments.map((assessment) => (
              <Table.Tr
                key={assessment.id}
                data-testid={`assessment-row-${assessment.id}`}
                onClick={() => selectAssessment(assessment)}
                style={{ cursor: 'pointer' }}
              >
                <Table.Td>{ar.patientDetail.assessmentTypes[assessment.type]}</Table.Td>
                <Table.Td>
                  <Badge color={assessment.status === 'APPROVED' ? 'green' : 'yellow'}>
                    {ar.patientDetail.assessmentStatuses[assessment.status]}
                  </Badge>
                </Table.Td>
                <Table.Td>{formatDate(assessment.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {canEdit ? (
        <Group mb="md">
          <Select
            data={[
              { value: 'INITIAL', label: ar.patientDetail.assessmentTypes.INITIAL },
              { value: 'PERIODIC', label: ar.patientDetail.assessmentTypes.PERIODIC },
              { value: 'FINAL', label: ar.patientDetail.assessmentTypes.FINAL },
            ]}
            value={newType}
            onChange={(value) => setNewType((value as AssessmentType) ?? 'INITIAL')}
          />
          <Button onClick={handleCreate} loading={creating}>{ar.patientDetail.newAssessmentButton}</Button>
        </Group>
      ) : null}

      {selected ? (
        <Card withBorder>
          {saveError ? <Alert color="red" mb="sm">{saveError}</Alert> : null}
          {selected.status === 'DRAFT' && canEdit ? (
            <form data-testid="assessment-intake-form" onSubmit={handleSave}>
              <Stack>
                <Textarea label={ar.patientDetail.medicalHistoryLabel} value={medicalHistory} onChange={(e) => setMedicalHistory(e.currentTarget.value)} />
                <Textarea label={ar.patientDetail.difficultSituationsLabel} value={difficultSituations} onChange={(e) => setDifficultSituations(e.currentTarget.value)} />
                <Textarea label={ar.patientDetail.anxietyLevelLabel} value={anxietyLevel} onChange={(e) => setAnxietyLevel(e.currentTarget.value)} />
                <Textarea label={ar.patientDetail.initialGoalsLabel} value={initialGoals} onChange={(e) => setInitialGoals(e.currentTarget.value)} />
                <Textarea label={ar.patientDetail.clinicianNotesLabel} value={clinicianNotes} onChange={(e) => setClinicianNotes(e.currentTarget.value)} />
                <NumberInput label={ar.patientDetail.ssi4FrequencyLabel} value={ssi4Frequency} onChange={(v) => setSsi4Frequency(typeof v === 'number' ? v : '')} min={0} />
                <NumberInput label={ar.patientDetail.ssi4DurationLabel} value={ssi4Duration} onChange={(v) => setSsi4Duration(typeof v === 'number' ? v : '')} min={0} />
                <NumberInput label={ar.patientDetail.ssi4PhysicalConcomitantsLabel} value={ssi4PhysicalConcomitants} onChange={(v) => setSsi4PhysicalConcomitants(typeof v === 'number' ? v : '')} min={0} />
                <NumberInput label={ar.patientDetail.ssi4TotalLabel} value={ssi4Total} onChange={(v) => setSsi4Total(typeof v === 'number' ? v : '')} min={0} />
                <Group>
                  <Button type="submit" loading={saving}>{ar.patientDetail.saveButton}</Button>
                </Group>
              </Stack>
            </form>
          ) : (
            <Stack gap="xs">
              <Text><b>{ar.patientDetail.medicalHistoryLabel}:</b> {selected.medicalHistory ?? '—'}</Text>
              <Text><b>{ar.patientDetail.difficultSituationsLabel}:</b> {selected.difficultSituations ?? '—'}</Text>
              <Text><b>{ar.patientDetail.anxietyLevelLabel}:</b> {selected.anxietyLevel ?? '—'}</Text>
              <Text><b>{ar.patientDetail.initialGoalsLabel}:</b> {selected.initialGoals ?? '—'}</Text>
              <Text><b>{ar.patientDetail.ssi4TotalLabel}:</b> {selected.ssi4Total ?? '—'}</Text>
              {selected.severityCategory ? (
                <Text><b>{ar.patientDetail.severityCategoryLabel}:</b> {ar.patientDetail.severityCategories[selected.severityCategory]}</Text>
              ) : null}
            </Stack>
          )}

          {selected.status === 'DRAFT' && canEdit ? (
            <Group mt="md">
              <Select
                data={[
                  { value: 'MILD', label: ar.patientDetail.severityCategories.MILD },
                  { value: 'MODERATE', label: ar.patientDetail.severityCategories.MODERATE },
                  { value: 'SEVERE', label: ar.patientDetail.severityCategories.SEVERE },
                  { value: 'VERY_SEVERE', label: ar.patientDetail.severityCategories.VERY_SEVERE },
                ]}
                value={severityCategory}
                onChange={(value) => setSeverityCategory((value as SeverityCategory) ?? 'MILD')}
              />
              <Button color="green" onClick={handleApprove} loading={approving}>{ar.patientDetail.approveButton}</Button>
            </Group>
          ) : null}

          {selected.status === 'APPROVED' ? (
            <Group mt="md">
              <Button variant="light" onClick={handleShowBaseline}>{ar.patientDetail.baselineComparisonButton}</Button>
            </Group>
          ) : null}

          {baseline ? (
            <Stack gap={4} mt="sm">
              <Text fw={600}>{ar.patientDetail.baselineComparisonTitle}</Text>
              {baseline.delta ? (
                <Text>{ar.patientDetail.ssi4TotalLabel}: {baseline.delta.ssi4TotalDelta}</Text>
              ) : (
                <Text c="dimmed">{ar.patientDetail.noBaselineYet}</Text>
              )}
            </Stack>
          ) : null}
        </Card>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/patients/AssessmentsSection.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire AssessmentsSection into PatientDetailPage**

In `staff-web/src/pages/PatientDetailPage.tsx`, add the import `import { AssessmentsSection } from '../patients/AssessmentsSection';` and add `<AssessmentsSection />` right after `<ProfileSection />` in `PatientDetailContent`.

- [ ] **Step 7: Type-check and build**

Run: `npx tsc -b --noEmit` (from `staff-web/`)
Expected: no errors.
Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 8: Commit**

```bash
git add staff-web/src/patients/AssessmentsSection.tsx staff-web/src/patients/AssessmentsSection.test.tsx staff-web/src/pages/PatientDetailPage.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add assessment creation/approval section to the Patient Detail Hub"
```

---

### Task 8: Frontend — Treatment Plan section

**Files:**
- Create: `staff-web/src/patients/TreatmentPlanSection.tsx`
- Test: `staff-web/src/patients/TreatmentPlanSection.test.tsx`
- Modify: `staff-web/src/pages/PatientDetailPage.tsx` (render `TreatmentPlanSection`)
- Modify: `staff-web/src/copy/ar.ts` (extend `patientDetail`)

**Interfaces:**
- Consumes: `usePatientDetail()`, `useAuth()` + `canEditClinicalData` (same pattern as Tasks 6-7), `listAssessments` from `assessments.ts` (filtered client-side to `APPROVED`), `listExercises` from `exercises.ts`, and all of Task 4's `treatment-plans.ts` exports.
- Produces: `TreatmentPlanSection` component, self-contained — the last of the three sections, completing the Patient Detail Hub.

- [ ] **Step 1: Extend the copy module**

In `staff-web/src/copy/ar.ts`, add these keys inside `patientDetail` (after `noBaselineYet`):

```typescript
    treatmentPlanTitle: 'الخطة العلاجية',
    goalsLabel: 'الأهداف',
    phaseLabel: 'المرحلة',
    phases: {
      PHASE_1: 'المرحلة الأولى',
      PHASE_2: 'المرحلة الثانية',
      PHASE_3: 'المرحلة الثالثة',
      PHASE_4: 'المرحلة الرابعة',
      PHASE_5: 'المرحلة الخامسة',
    } as Record<string, string>,
    reviewDateLabel: 'تاريخ المراجعة',
    linkedExercisesTitle: 'التمارين المرتبطة',
    noLinkedExercises: 'لا توجد تمارين مرتبطة',
    exerciseTitleLabel: 'التمرين',
    frequencyLabel: 'التكرار الأسبوعي',
    sequenceLabel: 'الترتيب',
    removeExerciseButton: 'إزالة',
    addExerciseButton: 'إضافة',
    transitionToPhaseLabel: 'الانتقال إلى مرحلة',
    rationaleLabel: 'السبب',
    transitionButton: 'تنفيذ الانتقال',
    noActivePlan: 'لا توجد خطة علاجية نشطة',
    newPlanTitle: 'خطة علاجية جديدة',
    assessmentLabel: 'التقييم المعتمد',
    createPlanButton: 'إنشاء خطة',
    pastPlansTitle: 'الخطط السابقة',
```

- [ ] **Step 2: Write the failing test**

Create `staff-web/src/patients/TreatmentPlanSection.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { TreatmentPlanSection } from './TreatmentPlanSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { listAssessments } from '../api/assessments';
import { listTreatmentPlans, createTreatmentPlan, transitionPhase, listPlanExercises } from '../api/treatment-plans';
import { listExercises } from '../api/exercises';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/assessments');
vi.mock('../api/treatment-plans');
vi.mock('../api/exercises');
vi.mock('../api/auth');
vi.mock('../storage/session');

const activePlan = {
  id: 'plan-1',
  patientProfileId: 'patient-1',
  clinicianUserId: 'staff-1',
  assessmentId: 'assessment-1',
  phase: 'PHASE_1',
  goals: 'تحسين الطلاقة',
  reviewDate: '2026-03-01T00:00:00.000Z',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderSection(role: 'CLINICIAN' | 'SUPERVISOR' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });
  (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listExercises as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listPlanExercises as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <TreatmentPlanSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TreatmentPlanSection', () => {
  it('shows the no-active-plan message when there is none', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد خطة علاجية نشطة')).toBeTruthy();
    });
  });

  it('shows the active plan goals and phase once loaded', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([activePlan]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('تحسين الطلاقة')).toBeTruthy();
      expect(screen.getByText('المرحلة الأولى')).toBeTruthy();
    });
  });

  it('creates a new plan from an approved assessment', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'assessment-1', type: 'INITIAL', status: 'APPROVED', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    (createTreatmentPlan as ReturnType<typeof vi.fn>).mockResolvedValue(activePlan);
    renderSection();

    await waitFor(() => expect(screen.getByText('خطة علاجية جديدة')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('الأهداف'), { target: { value: 'تحسين الطلاقة' } });
    fireEvent.change(screen.getByLabelText('تاريخ المراجعة'), { target: { value: '2026-04-01' } });
    fireEvent.submit(screen.getByTestId('new-plan-form'));

    await waitFor(() => {
      expect(createTreatmentPlan).toHaveBeenCalled();
    });
  });

  it('transitions the active plan to a new phase', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([activePlan]);
    (transitionPhase as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activePlan, phase: 'PHASE_2' });
    renderSection();

    await waitFor(() => expect(screen.getByText('تحسين الطلاقة')).toBeTruthy());
    fireEvent.submit(screen.getByTestId('phase-transition-form'));

    await waitFor(() => {
      expect(transitionPhase).toHaveBeenCalledWith('patient-1', 'plan-1', { toPhase: 'PHASE_1', rationale: undefined });
    });
  });

  it('hides all write controls for a SUPERVISOR', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([activePlan]);
    renderSection('SUPERVISOR');

    await waitFor(() => expect(screen.getByText('تحسين الطلاقة')).toBeTruthy());
    expect(screen.queryByTestId('phase-transition-form')).toBeNull();
    expect(screen.queryByTestId('new-plan-form')).toBeNull();
    expect(screen.queryByTestId('link-exercise-form')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run src/patients/TreatmentPlanSection.test.tsx`
Expected: FAIL with "Cannot find module './TreatmentPlanSection'".

- [ ] **Step 4: Implement TreatmentPlanSection**

Create `staff-web/src/patients/TreatmentPlanSection.tsx`:

```typescript
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Title, Text, Stack, Group, Button, Select, TextInput, NumberInput, Table, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canEditClinicalData } from '../auth/permissions';
import { listAssessments } from '../api/assessments';
import type { Assessment } from '../api/assessments';
import {
  getActiveTreatmentPlan,
  listTreatmentPlans,
  createTreatmentPlan,
  transitionPhase,
  linkExercise,
  listPlanExercises,
  unlinkExercise,
} from '../api/treatment-plans';
import type { TreatmentPlan, TreatmentPhase, PlanExercise } from '../api/treatment-plans';
import { listExercises } from '../api/exercises';
import type { Exercise } from '../api/exercises';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

const PHASES: TreatmentPhase[] = ['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5'];

export function TreatmentPlanSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();
  const canEdit = user ? canEditClinicalData(user.role) : false;

  const [activePlan, setActivePlan] = useState<TreatmentPlan | null>(null);
  const [pastPlans, setPastPlans] = useState<TreatmentPlan[]>([]);
  const [planExercises, setPlanExercises] = useState<PlanExercise[]>([]);
  const [approvedAssessments, setApprovedAssessments] = useState<Assessment[]>([]);
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [goals, setGoals] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [creatingPlan, setCreatingPlan] = useState(false);

  const [toPhase, setToPhase] = useState<TreatmentPhase>('PHASE_1');
  const [rationale, setRationale] = useState('');
  const [transitioning, setTransitioning] = useState(false);

  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [frequencyPerWeek, setFrequencyPerWeek] = useState<number | ''>('');
  const [sequence, setSequence] = useState<number | ''>('');
  const [linkingExercise, setLinkingExercise] = useState(false);

  async function loadAll() {
    if (!patient) return;
    setError(null);
    try {
      const [all, assessments, exerciseCatalog] = await Promise.all([
        listTreatmentPlans(patient.id),
        listAssessments(patient.id),
        listExercises(),
      ]);
      const active = all.find((plan) => plan.status === 'ACTIVE') ?? null;
      setActivePlan(active);
      setPastPlans(all.filter((plan) => plan.status !== 'ACTIVE'));
      setApprovedAssessments(assessments.filter((a) => a.status === 'APPROVED'));
      setCatalog(exerciseCatalog);
      if (active) {
        setToPhase(active.phase);
        const exercises = await listPlanExercises(patient.id, active.id);
        setPlanExercises(exercises);
      } else {
        setPlanExercises([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  async function handleCreatePlan(event: FormEvent) {
    event.preventDefault();
    if (!patient || !assessmentId || !goals || !reviewDate) return;
    setCreatingPlan(true);
    setError(null);
    try {
      await createTreatmentPlan(patient.id, { assessmentId, goals, reviewDate });
      setGoals('');
      setReviewDate('');
      setAssessmentId(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setCreatingPlan(false);
    }
  }

  async function handleTransitionPhase(event: FormEvent) {
    event.preventDefault();
    if (!patient || !activePlan) return;
    setTransitioning(true);
    setError(null);
    try {
      await transitionPhase(patient.id, activePlan.id, { toPhase, rationale: rationale || undefined });
      setRationale('');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setTransitioning(false);
    }
  }

  async function handleLinkExercise(event: FormEvent) {
    event.preventDefault();
    if (!patient || !activePlan || !exerciseId || frequencyPerWeek === '' || sequence === '') return;
    setLinkingExercise(true);
    setError(null);
    try {
      await linkExercise(patient.id, activePlan.id, { exerciseId, frequencyPerWeek, sequence });
      setExerciseId(null);
      setFrequencyPerWeek('');
      setSequence('');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setLinkingExercise(false);
    }
  }

  async function handleUnlink(targetExerciseId: string) {
    if (!patient || !activePlan) return;
    await unlinkExercise(patient.id, activePlan.id, targetExerciseId);
    await loadAll();
  }

  if (!patient) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.patientDetail.treatmentPlanTitle}</Title>

      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {activePlan ? (
        <Stack gap="xs" mb="md">
          <Text><b>{ar.patientDetail.goalsLabel}:</b> {activePlan.goals}</Text>
          <Text><b>{ar.patientDetail.phaseLabel}:</b> {ar.patientDetail.phases[activePlan.phase]}</Text>
          <Text><b>{ar.patientDetail.reviewDateLabel}:</b> {formatDate(activePlan.reviewDate)}</Text>

          <Text fw={600} mt="sm">{ar.patientDetail.linkedExercisesTitle}</Text>
          {planExercises.length === 0 ? (
            <Text c="dimmed">{ar.patientDetail.noLinkedExercises}</Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{ar.patientDetail.exerciseTitleLabel}</Table.Th>
                  <Table.Th>{ar.patientDetail.frequencyLabel}</Table.Th>
                  <Table.Th>{ar.patientDetail.sequenceLabel}</Table.Th>
                  {canEdit ? <Table.Th /> : null}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {planExercises.map((pe) => (
                  <Table.Tr key={pe.id}>
                    <Table.Td>{pe.exercise.title}</Table.Td>
                    <Table.Td>{pe.frequencyPerWeek}</Table.Td>
                    <Table.Td>{pe.sequence}</Table.Td>
                    {canEdit ? (
                      <Table.Td>
                        <Button size="xs" color="red" variant="subtle" onClick={() => handleUnlink(pe.exerciseId)}>
                          {ar.patientDetail.removeExerciseButton}
                        </Button>
                      </Table.Td>
                    ) : null}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          {canEdit ? (
            <form data-testid="link-exercise-form" onSubmit={handleLinkExercise}>
              <Group align="flex-end" mt="sm">
                <Select
                  label={ar.patientDetail.exerciseTitleLabel}
                  data={catalog.map((ex) => ({ value: ex.id, label: ex.title }))}
                  value={exerciseId}
                  onChange={setExerciseId}
                />
                <NumberInput label={ar.patientDetail.frequencyLabel} value={frequencyPerWeek} onChange={(v) => setFrequencyPerWeek(typeof v === 'number' ? v : '')} min={1} max={21} />
                <NumberInput label={ar.patientDetail.sequenceLabel} value={sequence} onChange={(v) => setSequence(typeof v === 'number' ? v : '')} min={1} />
                <Button type="submit" loading={linkingExercise}>{ar.patientDetail.addExerciseButton}</Button>
              </Group>
            </form>
          ) : null}

          {canEdit ? (
            <form data-testid="phase-transition-form" onSubmit={handleTransitionPhase}>
              <Group align="flex-end" mt="md">
                <Select
                  label={ar.patientDetail.transitionToPhaseLabel}
                  data={PHASES.map((phase) => ({ value: phase, label: ar.patientDetail.phases[phase] }))}
                  value={toPhase}
                  onChange={(value) => setToPhase((value as TreatmentPhase) ?? 'PHASE_1')}
                />
                <TextInput label={ar.patientDetail.rationaleLabel} value={rationale} onChange={(e) => setRationale(e.currentTarget.value)} />
                <Button type="submit" loading={transitioning}>{ar.patientDetail.transitionButton}</Button>
              </Group>
            </form>
          ) : null}
        </Stack>
      ) : (
        <Text c="dimmed" mb="md">{ar.patientDetail.noActivePlan}</Text>
      )}

      {canEdit ? (
        <form data-testid="new-plan-form" onSubmit={handleCreatePlan}>
          <Title order={4} mb="xs">{ar.patientDetail.newPlanTitle}</Title>
          <Group align="flex-end">
            <Select
              label={ar.patientDetail.assessmentLabel}
              data={approvedAssessments.map((a) => ({ value: a.id, label: `${ar.patientDetail.assessmentTypes[a.type]} — ${formatDate(a.createdAt)}` }))}
              value={assessmentId}
              onChange={setAssessmentId}
            />
            <TextInput label={ar.patientDetail.goalsLabel} value={goals} onChange={(e) => setGoals(e.currentTarget.value)} />
            <TextInput type="date" label={ar.patientDetail.reviewDateLabel} value={reviewDate} onChange={(e) => setReviewDate(e.currentTarget.value)} />
            <Button type="submit" loading={creatingPlan}>{ar.patientDetail.createPlanButton}</Button>
          </Group>
        </form>
      ) : null}

      {pastPlans.length > 0 ? (
        <Stack mt="lg">
          <Text fw={600}>{ar.patientDetail.pastPlansTitle}</Text>
          {pastPlans.map((plan) => (
            <Text key={plan.id} c="dimmed">
              {ar.patientDetail.phases[plan.phase]} — {formatDate(plan.createdAt)}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Card>
  );
}
```

Note: `getActiveTreatmentPlan` is imported but intentionally unused by this implementation (the section derives the active plan from `listTreatmentPlans` instead, to get past plans in the same request) — remove the unused import before running `tsc`, i.e. delete `getActiveTreatmentPlan,` from the `treatment-plans` import list above.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/patients/TreatmentPlanSection.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire TreatmentPlanSection into PatientDetailPage**

In `staff-web/src/pages/PatientDetailPage.tsx`, add the import `import { TreatmentPlanSection } from '../patients/TreatmentPlanSection';` and add `<TreatmentPlanSection />` right after `<AssessmentsSection />` in `PatientDetailContent`.

- [ ] **Step 7: Type-check and build**

Run: `npx tsc -b --noEmit` (from `staff-web/`)
Expected: no errors (in particular, confirm the unused `getActiveTreatmentPlan` import was actually removed — an unused import doesn't fail `tsc -b` by default in this project's config, but check `staff-web/tsconfig.app.json` for `noUnusedLocals`; if it's `true`, this would be a real build error, not just lint noise).
Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 8: Commit**

```bash
git add staff-web/src/patients/TreatmentPlanSection.tsx staff-web/src/patients/TreatmentPlanSection.test.tsx staff-web/src/pages/PatientDetailPage.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add treatment plan management section to the Patient Detail Hub"
```

---

### Task 9: Full suite verification and manual walkthrough

**Files:** none (verification only).

**Interfaces:** N/A.

- [ ] **Step 1: Run the full backend suite**

Run: `npm run test:e2e` (from `backend/`)
Expected: all suites pass (this project's full suite was 164/164 as of the last merge; expect that count plus this sub-project's ~11 new tests, ~175 total). If Docker Desktop isn't running, `docker ps` will fail outright and every suite will fail — this is an environment issue, not a regression; restart Docker Desktop and re-run before concluding anything is broken.

- [ ] **Step 2: Run the full frontend suite**

Run: `npm test` (from `staff-web/`)
Expected: all tests pass (sub-project 1 had 26; this sub-project adds roughly 3 (permissions) + 2 (PatientDetailContext) + 2 (PatientDetailPage) + 1 (PatientsPage navigation) + 4 (ProfileSection) + 4 (AssessmentsSection) + 5 (TreatmentPlanSection) = 21 new tests, ~47 total).

Run: `npx tsc -b --noEmit` (from `staff-web/`)
Expected: no errors.

Run: `npm run build` (from `staff-web/`)
Expected: builds successfully.

- [ ] **Step 3: Manual API-level walkthrough**

Browser-based visual verification was not available for sub-project 1 (documented in its final review) — repeat that same API-level walkthrough approach here rather than attempting browser verification that has failed twice before. Write a short Node script (in the scratchpad directory, not committed) that, against the real running backend (`npm run start:dev` from `backend/`):

1. Registers and promotes a CLINICIAN, a SUPERVISOR, and a PATIENT (reusing the pattern from the sub-project-1 walkthrough script).
2. As CLINICIAN: creates a patient profile, edits it to add `clinicalInfo`, confirms `GET /api/v1/patients?q=` for that patient does NOT include `clinicalInfo` in the result, calls `lookup-caregiver` for a registered CAREGIVER's mobile and confirms it resolves, links that caregiver as a guardian.
3. As CLINICIAN: creates a DRAFT assessment, edits it with SSI-4 fields, approves it with a severity category, creates a second assessment and approves it, calls the baseline-comparison endpoint and confirms a non-null `delta`.
4. As CLINICIAN: creates a treatment plan from the first approved assessment, transitions its phase, links an exercise (create one via `POST /api/v1/exercises` first) to the plan, lists the plan's exercises, unlinks it.
5. As SUPERVISOR: confirms every write call above (edit, create, approve, transition, link) returns 403 when attempted, and confirms every corresponding GET succeeds.

Run the script and confirm every step behaves as described. This does not require the browser tools — it directly proves the backend contract the frontend relies on, matching the verification depth achieved for sub-project 1.

- [ ] **Step 4: Report status**

No commit for this task (verification only) — proceed to the final whole-branch review per `subagent-driven-development`.
