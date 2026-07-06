# Kalamy Sessions + Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Kalamy NestJS backend with the fixed 30-session clinician-gated training curriculum (Sessions) and a read-only progress dashboard (Progress), building on the merged Foundation and Clinical Core modules.

**Architecture:** Two new feature modules (`sessions`, `progress`) plus one shared extraction (`common/patient-access`, a `PatientAccessService` pulling the duplicated ownership-check pattern out of `PatientsService`/`AssessmentsService`/`TreatmentPlansService` into one injectable service the new modules use). Three new Prisma models. No other new cross-cutting infrastructure — RBAC guards, session guard, audit interceptor, and Zod validation are already global.

**Tech Stack:** Same as prior modules — NestJS 11 (TypeScript), PostgreSQL 16 (Docker), Prisma 6.19.3, nestjs-zod + Zod, Jest.

**Reference spec:** `docs/superpowers/specs/2026-07-06-sessions-progress-design.md`

## Global Constraints

- All endpoints are under `/api/v1/...`.
- `SessionTemplate` rows (30 fixed sessions, 11 categories) are admin/clinician-editable data, not hardcoded logic.
- Starting the program (`POST /api/v1/patients/:patientId/sessions/start`) requires the patient to have a treatment plan with `status: ACTIVE` — 400 otherwise. 409 if a `PatientSession` already exists for this patient (program already started).
- A patient cannot submit their sample (`POST .../current/submit`) until `now >= trainingStartedAt + sessionTemplate.trainingDurationDays` (days) — enforced server-side, 400 if too early.
- Self-rating bounds, exact per the design spec: `selfSeverityCurrent`/`selfSeverityExpectedNext` are 0–8, `camperdownPerformanceRating` is 1–9, `clientOpinionScore`/`clinicianOpinionScore` are 0–10.
- Only a clinician/admin review (`POST .../current/review`) advances the patient — there is no automated progression and **no retry limit** on `REPEAT_REQUIRED`.
- Approving or requiring-repeat both atomically create the next `PatientSession` row (next session number on approve, same session number + 1 attempt on repeat) in a single `$transaction` — never a separate top-level call.
- `PatientSession` rows are never deleted or hard-updated after review — each attempt is an immutable historical row once reviewed.
- RBAC: `START_SESSION`/`SUBMIT_SESSION` → PATIENT/CAREGIVER only (a caregiver acts for a linked minor). `REVIEW_SESSION`/`MANAGE_SESSION_TEMPLATES` → CLINICIAN/ADMIN only. `VIEW_SESSION`/`VIEW_SESSION_TEMPLATES`/`VIEW_PROGRESS` → all 5 roles, with patient-scoped ownership enforced via the new shared `PatientAccessService` (not role permission alone) for anything scoped to a specific patient.
- Every new PostgreSQL-touching test is an integration test that runs against a real local Postgres (via the existing `docker-compose.yml`) — never mocked.
- The three existing services (`PatientsService`, `AssessmentsService`, `TreatmentPlansService`) are **not modified** in this plan — the shared `PatientAccessService` is new, used only by the new `sessions`/`progress` modules. Do not refactor the existing services to use it; that is explicitly out of scope.

---

## File Structure

```
backend/
  prisma/
    schema.prisma                                (modified: 2 new models, 1 new enum, back-relations)
  src/
    app.module.ts                                 (modified: import 3 new modules)
    common/
      patient-access/
        patient-access.service.ts
        patient-access.module.ts
        patient-access.service.spec.ts
      rbac/
        permissions.ts                            (modified: new Permission values + ROLE_PERMISSIONS entries)
        permissions.spec.ts                        (modified: new test cases)
    modules/
      sessions/
        sessions.module.ts
        session-templates.controller.ts
        session-templates.service.ts
        patient-sessions.controller.ts
        patient-sessions.service.ts
        dto/
          create-session-template.dto.ts
          update-session-template.dto.ts
          submit-ratings.dto.ts
          submit-sample.dto.ts
          review-session.dto.ts
      progress/
        progress.module.ts
        progress.controller.ts
        progress.service.ts
  test/
    utils/
      test-app.ts                                  (modified: resetDatabase deletes new tables)
    common/
      patient-access.e2e-spec.ts                    (not needed — covered by unit test + sessions e2e)
    session-templates.e2e-spec.ts
    patient-sessions.e2e-spec.ts
    progress.e2e-spec.ts
    sessions-progress-smoke.e2e-spec.ts
```

---

### Task 1: Prisma schema — SessionTemplate, PatientSession

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/test/utils/test-app.ts`
- Test: `backend/test/session-templates.e2e-spec.ts` (schema round-trip smoke test only; full CRUD tests come in Task 4)

**Interfaces:**
- Consumes: existing `PatientProfile`, `TreatmentPlan`, `User` models.
- Produces: `SessionTemplate`, `PatientSession` Prisma models and generated types, used by every later task.

- [ ] **Step 1: Add the new enum and models to `prisma/schema.prisma`**

Add this enum after the existing `enum ExerciseStatus { ... }` block:

```prisma
enum SessionStatus {
  IN_TRAINING
  SUBMITTED
  APPROVED
  REPEAT_REQUIRED
}
```

Add this field to the existing `model User { ... }` block, immediately after `exercisesCreated Exercise[]`:

```prisma
  reviewedPatientSessions PatientSession[]
```

Add this field to the existing `model PatientProfile { ... }` block, immediately after `treatmentPlans TreatmentPlan[]`:

```prisma
  patientSessions PatientSession[]
```

Add this field to the existing `model TreatmentPlan { ... }` block, immediately after `planExercises PlanExercise[]`:

```prisma
  patientSessions PatientSession[]
```

Add these new models at the end of the file, after the last existing model:

```prisma
model SessionTemplate {
  id                   String   @id @default(uuid())
  sessionNumber        Int      @unique
  category             Int
  cognitiveVideoUrl    String?
  behavioralVideoUrl   String?
  trainingDurationDays Int
  instructions         String
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  patientSessions PatientSession[]
}

model PatientSession {
  id                          String          @id @default(uuid())
  patientProfileId            String
  patientProfile              PatientProfile  @relation(fields: [patientProfileId], references: [id])
  treatmentPlanId              String
  treatmentPlan                TreatmentPlan   @relation(fields: [treatmentPlanId], references: [id])
  sessionTemplateId            String
  sessionTemplate               SessionTemplate @relation(fields: [sessionTemplateId], references: [id])
  attemptNumber                 Int             @default(1)
  status                         SessionStatus   @default(IN_TRAINING)
  trainingStartedAt              DateTime        @default(now())
  sampleVideoUrl                 String?
  sampleSubmittedAt              DateTime?
  selfSeverityCurrent             Int?
  selfSeverityExpectedNext        Int?
  camperdownPerformanceRating     Int?
  clientOpinionScore              Int?
  clinicianOpinionScore           Int?
  clinicianUserId                  String?
  clinicianUser                    User?     @relation(fields: [clinicianUserId], references: [id])
  reviewNotes                      String?
  reviewedAt                       DateTime?
  createdAt                        DateTime  @default(now())
  updatedAt                        DateTime  @updatedAt

  @@index([patientProfileId, createdAt])
}
```

- [ ] **Step 2: Apply the migration**

Run: `docker compose up -d` (if Postgres isn't already running), then:
```bash
npm run prisma:migrate -- --name sessions_progress
```
Expected: creates `prisma/migrations/<timestamp>_sessions_progress/migration.sql`; ends with "Your database is now in sync with your schema."

- [ ] **Step 3: Update `test/utils/test-app.ts`'s `resetDatabase` to clear the new tables**

Replace the `resetDatabase` function with (children before parents — `patientSession` references `patientProfile`/`treatmentPlan`/`sessionTemplate`/`user`, so it must be deleted before all four):

```typescript
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
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

- [ ] **Step 4: Write a smoke test proving the new tables round-trip — `test/session-templates.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('SessionTemplate schema smoke test', () => {
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

  it('can create and read a SessionTemplate row', async () => {
    const template = await prisma.sessionTemplate.create({
      data: {
        sessionNumber: 1,
        category: 1,
        trainingDurationDays: 3,
        instructions: 'Extend a single vowel sound for 5 seconds while opening and closing your hand.',
      },
    });

    const found = await prisma.sessionTemplate.findUnique({ where: { id: template.id } });
    expect(found?.sessionNumber).toBe(1);
    expect(found?.trainingDurationDays).toBe(3);
  });
});
```

- [ ] **Step 5: Run test to verify it fails, then confirm it passes after migration**

Run: `npm run test:e2e`
Expected: fails with a "table does not exist" error before the migration is applied (Step 2); PASS after.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add Prisma schema for SessionTemplate and PatientSession"
```

---

### Task 2: RBAC permission policy extension

**Files:**
- Modify: `backend/src/common/rbac/permissions.ts`
- Modify: `backend/src/common/rbac/permissions.spec.ts`

**Interfaces:**
- Consumes: `Permission` enum, `ROLE_PERMISSIONS` map, `hasPermission()` (existing).
- Produces: 6 new `Permission` values used by every controller in Tasks 4-10: `MANAGE_SESSION_TEMPLATES`, `VIEW_SESSION_TEMPLATES`, `START_SESSION`, `SUBMIT_SESSION`, `VIEW_SESSION`, `REVIEW_SESSION`, `VIEW_PROGRESS`.

- [ ] **Step 1: Write the failing tests — append to `src/common/rbac/permissions.spec.ts`**

```typescript
describe('hasPermission — sessions and progress', () => {
  it('allows a CLINICIAN to manage session templates', () => {
    expect(hasPermission('CLINICIAN', Permission.MANAGE_SESSION_TEMPLATES)).toBe(true);
  });

  it('does not allow a PATIENT to manage session templates', () => {
    expect(hasPermission('PATIENT', Permission.MANAGE_SESSION_TEMPLATES)).toBe(false);
  });

  it('allows a PATIENT to start their program', () => {
    expect(hasPermission('PATIENT', Permission.START_SESSION)).toBe(true);
  });

  it('does not allow a CLINICIAN to start a session on a patient\'s behalf', () => {
    expect(hasPermission('CLINICIAN', Permission.START_SESSION)).toBe(false);
  });

  it('allows a CAREGIVER to submit a session sample', () => {
    expect(hasPermission('CAREGIVER', Permission.SUBMIT_SESSION)).toBe(true);
  });

  it('allows a CLINICIAN to review a session', () => {
    expect(hasPermission('CLINICIAN', Permission.REVIEW_SESSION)).toBe(true);
  });

  it('does not allow a PATIENT to review a session', () => {
    expect(hasPermission('PATIENT', Permission.REVIEW_SESSION)).toBe(false);
  });

  it('allows a SUPERVISOR to view progress', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_PROGRESS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- permissions`
Expected: FAIL — the 6 new `Permission` values are `undefined`.

- [ ] **Step 3: Replace `src/common/rbac/permissions.ts` in full**

```typescript
import { Role } from '@prisma/client';

export enum Permission {
  CREATE_PATIENT_PROFILE = 'CREATE_PATIENT_PROFILE',
  VIEW_PATIENT_PROFILE = 'VIEW_PATIENT_PROFILE',
  EDIT_PATIENT_PROFILE = 'EDIT_PATIENT_PROFILE',
  DISABLE_PATIENT_PROFILE = 'DISABLE_PATIENT_PROFILE',
  LINK_GUARDIAN = 'LINK_GUARDIAN',
  SEARCH_PATIENTS = 'SEARCH_PATIENTS',
  MANAGE_USERS = 'MANAGE_USERS',
  CREATE_EXERCISE = 'CREATE_EXERCISE',
  EDIT_EXERCISE = 'EDIT_EXERCISE',
  VIEW_EXERCISE = 'VIEW_EXERCISE',
  ARCHIVE_EXERCISE = 'ARCHIVE_EXERCISE',
  CREATE_ASSESSMENT = 'CREATE_ASSESSMENT',
  EDIT_ASSESSMENT = 'EDIT_ASSESSMENT',
  APPROVE_ASSESSMENT = 'APPROVE_ASSESSMENT',
  VIEW_ASSESSMENT = 'VIEW_ASSESSMENT',
  CREATE_TREATMENT_PLAN = 'CREATE_TREATMENT_PLAN',
  EDIT_TREATMENT_PLAN = 'EDIT_TREATMENT_PLAN',
  VIEW_TREATMENT_PLAN = 'VIEW_TREATMENT_PLAN',
  MANAGE_SESSION_TEMPLATES = 'MANAGE_SESSION_TEMPLATES',
  VIEW_SESSION_TEMPLATES = 'VIEW_SESSION_TEMPLATES',
  START_SESSION = 'START_SESSION',
  SUBMIT_SESSION = 'SUBMIT_SESSION',
  VIEW_SESSION = 'VIEW_SESSION',
  REVIEW_SESSION = 'REVIEW_SESSION',
  VIEW_PROGRESS = 'VIEW_PROGRESS',
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PATIENT: [
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.VIEW_EXERCISE,
    Permission.VIEW_ASSESSMENT,
    Permission.VIEW_TREATMENT_PLAN,
    Permission.VIEW_SESSION_TEMPLATES,
    Permission.START_SESSION,
    Permission.SUBMIT_SESSION,
    Permission.VIEW_SESSION,
    Permission.VIEW_PROGRESS,
  ],
  CAREGIVER: [
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.VIEW_EXERCISE,
    Permission.VIEW_ASSESSMENT,
    Permission.VIEW_TREATMENT_PLAN,
    Permission.VIEW_SESSION_TEMPLATES,
    Permission.START_SESSION,
    Permission.SUBMIT_SESSION,
    Permission.VIEW_SESSION,
    Permission.VIEW_PROGRESS,
  ],
  CLINICIAN: [
    Permission.CREATE_PATIENT_PROFILE,
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.DISABLE_PATIENT_PROFILE,
    Permission.LINK_GUARDIAN,
    Permission.SEARCH_PATIENTS,
    Permission.CREATE_EXERCISE,
    Permission.EDIT_EXERCISE,
    Permission.VIEW_EXERCISE,
    Permission.ARCHIVE_EXERCISE,
    Permission.CREATE_ASSESSMENT,
    Permission.EDIT_ASSESSMENT,
    Permission.APPROVE_ASSESSMENT,
    Permission.VIEW_ASSESSMENT,
    Permission.CREATE_TREATMENT_PLAN,
    Permission.EDIT_TREATMENT_PLAN,
    Permission.VIEW_TREATMENT_PLAN,
    Permission.MANAGE_SESSION_TEMPLATES,
    Permission.VIEW_SESSION_TEMPLATES,
    Permission.VIEW_SESSION,
    Permission.REVIEW_SESSION,
    Permission.VIEW_PROGRESS,
  ],
  SUPERVISOR: [
    Permission.VIEW_PATIENT_PROFILE,
    Permission.SEARCH_PATIENTS,
    Permission.VIEW_EXERCISE,
    Permission.VIEW_ASSESSMENT,
    Permission.VIEW_TREATMENT_PLAN,
    Permission.VIEW_SESSION_TEMPLATES,
    Permission.VIEW_SESSION,
    Permission.VIEW_PROGRESS,
  ],
  ADMIN: [
    Permission.CREATE_PATIENT_PROFILE,
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.DISABLE_PATIENT_PROFILE,
    Permission.LINK_GUARDIAN,
    Permission.SEARCH_PATIENTS,
    Permission.MANAGE_USERS,
    Permission.CREATE_EXERCISE,
    Permission.EDIT_EXERCISE,
    Permission.VIEW_EXERCISE,
    Permission.ARCHIVE_EXERCISE,
    Permission.CREATE_ASSESSMENT,
    Permission.EDIT_ASSESSMENT,
    Permission.APPROVE_ASSESSMENT,
    Permission.VIEW_ASSESSMENT,
    Permission.CREATE_TREATMENT_PLAN,
    Permission.EDIT_TREATMENT_PLAN,
    Permission.VIEW_TREATMENT_PLAN,
    Permission.MANAGE_SESSION_TEMPLATES,
    Permission.VIEW_SESSION_TEMPLATES,
    Permission.VIEW_SESSION,
    Permission.REVIEW_SESSION,
    Permission.VIEW_PROGRESS,
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- permissions`
Expected: PASS — 21 tests passed (13 existing + 8 new).

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: extend RBAC policy for sessions and progress"
```

---

### Task 3: Shared PatientAccessService (ownership-check extraction)

**Files:**
- Create: `backend/src/common/patient-access/patient-access.service.ts`
- Create: `backend/src/common/patient-access/patient-access.service.spec.ts`
- Create: `backend/src/common/patient-access/patient-access.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuthenticatedUser` (from `../auth/session.guard`), `PatientProfile`/`Role` (from `@prisma/client`).
- Produces: `PatientAccessService.assertCanAccess(actor, profile): Promise<void>` — throws `ForbiddenException` on denial, resolves on access. Consumed by Tasks 5-10 (`PatientSessionsService`, `ProgressService`). **Do not modify `PatientsService`, `AssessmentsService`, or `TreatmentPlansService` to use this** — those already-shipped services keep their own private copies; this is a fresh extraction for new code only, per the design spec.

This is the exact logic already duplicated in `PatientsService`/`AssessmentsService`/`TreatmentPlansService`'s private `assertCanAccess` methods, made into a standalone injectable service so the 4th and every future copy is declarative instead of copy-pasted.

- [ ] **Step 1: Write the failing test — `src/common/patient-access/patient-access.service.spec.ts`**

```typescript
import { ForbiddenException } from '@nestjs/common';
import { PatientAccessService } from './patient-access.service';
import { PatientProfile } from '@prisma/client';

function makePrismaMock() {
  const guardianLink = { findFirst: jest.fn() };
  return { guardianLink } as any;
}

function makeProfile(overrides: Partial<PatientProfile> = {}): PatientProfile {
  return {
    id: 'profile-1',
    userId: 'patient-user-1',
    fullName: 'Test Patient',
    gender: 'MALE',
    dateOfBirth: new Date('2000-01-01'),
    nationalId: 'NID-1',
    address: null,
    referralSource: null,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PatientProfile;
}

describe('PatientAccessService', () => {
  it('allows a CLINICIAN unconditionally', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);

    await expect(
      service.assertCanAccess({ id: 'clinician-1', role: 'CLINICIAN', sessionId: 's1' }, makeProfile()),
    ).resolves.toBeUndefined();
  });

  it('allows a SUPERVISOR unconditionally', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);

    await expect(
      service.assertCanAccess({ id: 'supervisor-1', role: 'SUPERVISOR', sessionId: 's1' }, makeProfile()),
    ).resolves.toBeUndefined();
  });

  it('allows an ADMIN unconditionally', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);

    await expect(
      service.assertCanAccess({ id: 'admin-1', role: 'ADMIN', sessionId: 's1' }, makeProfile()),
    ).resolves.toBeUndefined();
  });

  it('allows a PATIENT to access their own profile', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);
    const profile = makeProfile({ userId: 'patient-user-1' });

    await expect(
      service.assertCanAccess({ id: 'patient-user-1', role: 'PATIENT', sessionId: 's1' }, profile),
    ).resolves.toBeUndefined();
  });

  it('denies a PATIENT accessing another patient\'s profile', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);
    const profile = makeProfile({ userId: 'patient-user-1' });

    await expect(
      service.assertCanAccess({ id: 'patient-user-2', role: 'PATIENT', sessionId: 's1' }, profile),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a CAREGIVER linked as guardian', async () => {
    const prisma = makePrismaMock();
    prisma.guardianLink.findFirst.mockResolvedValue({ id: 'link-1' });
    const service = new PatientAccessService(prisma);
    const profile = makeProfile({ userId: 'patient-user-1' });

    await expect(
      service.assertCanAccess({ id: 'guardian-1', role: 'CAREGIVER', sessionId: 's1' }, profile),
    ).resolves.toBeUndefined();
    expect(prisma.guardianLink.findFirst).toHaveBeenCalledWith({
      where: { guardianUserId: 'guardian-1', patientUserId: 'patient-user-1' },
    });
  });

  it('denies a CAREGIVER not linked as guardian', async () => {
    const prisma = makePrismaMock();
    prisma.guardianLink.findFirst.mockResolvedValue(null);
    const service = new PatientAccessService(prisma);
    const profile = makeProfile({ userId: 'patient-user-1' });

    await expect(
      service.assertCanAccess({ id: 'guardian-2', role: 'CAREGIVER', sessionId: 's1' }, profile),
    ).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- patient-access`
Expected: FAIL — `Cannot find module './patient-access.service'`.

- [ ] **Step 3: Create `src/common/patient-access/patient-access.service.ts`**

```typescript
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/session.guard';

@Injectable()
export class PatientAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanAccess(actor: AuthenticatedUser, profile: PatientProfile): Promise<void> {
    if (actor.role === Role.CLINICIAN || actor.role === Role.SUPERVISOR || actor.role === Role.ADMIN) {
      return;
    }
    if (actor.role === Role.PATIENT) {
      if (profile.userId === actor.id) {
        return;
      }
      throw new ForbiddenException("Cannot access another patient's data");
    }
    if (actor.role === Role.CAREGIVER) {
      const link = await this.prisma.guardianLink.findFirst({
        where: { guardianUserId: actor.id, patientUserId: profile.userId },
      });
      if (link) {
        return;
      }
      throw new ForbiddenException('Not linked as guardian for this patient');
    }
    throw new ForbiddenException('Access denied');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- patient-access`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Create `src/common/patient-access/patient-access.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { PatientAccessService } from './patient-access.service';

@Module({
  providers: [PatientAccessService],
  exports: [PatientAccessService],
})
export class PatientAccessModule {}
```

- [ ] **Step 6: Run the full unit suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all suites, including the new `patient-access.service.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: extract shared PatientAccessService for future modules"
```

---

### Task 4: Session Templates — create, list, get, update

**Files:**
- Create: `backend/src/modules/sessions/dto/create-session-template.dto.ts`
- Create: `backend/src/modules/sessions/dto/update-session-template.dto.ts`
- Create: `backend/src/modules/sessions/session-templates.service.ts`
- Create: `backend/src/modules/sessions/session-templates.controller.ts`
- Create: `backend/src/modules/sessions/sessions.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/session-templates.e2e-spec.ts` (extend the file created in Task 1)

**Interfaces:**
- Consumes: `PrismaService`, `Permission`/`RequirePermission`/`PermissionsGuard`, `SessionGuard`.
- Produces: `SessionTemplatesService.create()`, `.findAll()`, `.findById()`, `.update()` — `.findById()` is consumed by Task 5 (`PatientSessionsService.start()` needs to look up the sessionNumber-1 template) and Task 8 (review creates the next attempt referencing the next template).

- [ ] **Step 1: Create `src/modules/sessions/dto/create-session-template.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSessionTemplateSchema = z.object({
  sessionNumber: z.number().int().min(1).max(30),
  category: z.number().int().min(1).max(11),
  cognitiveVideoUrl: z.url().optional(),
  behavioralVideoUrl: z.url().optional(),
  trainingDurationDays: z.number().int().min(1),
  instructions: z.string().min(1),
});

export class CreateSessionTemplateDto extends createZodDto(CreateSessionTemplateSchema) {}
```

- [ ] **Step 2: Create `src/modules/sessions/dto/update-session-template.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateSessionTemplateSchema = z.object({
  category: z.number().int().min(1).max(11).optional(),
  cognitiveVideoUrl: z.url().optional(),
  behavioralVideoUrl: z.url().optional(),
  trainingDurationDays: z.number().int().min(1).optional(),
  instructions: z.string().min(1).optional(),
});

export class UpdateSessionTemplateDto extends createZodDto(UpdateSessionTemplateSchema) {}
```

- [ ] **Step 3: Write the failing tests — append to `test/session-templates.e2e-spec.ts`** (new top-level `describe`, same file as Task 1's schema smoke test)

```typescript
import request from 'supertest';

describe('Session Templates: create, list, get, update', () => {
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

  it('lets a CLINICIAN create a session template', async () => {
    const token = await createClinicianToken('+966500000600', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionNumber: 1,
        category: 1,
        trainingDurationDays: 3,
        instructions: 'Extend a vowel sound for 5 seconds while opening and closing your hand.',
      });

    expect(response.status).toBe(201);
    expect(response.body.sessionNumber).toBe(1);
  });

  it('rejects a PATIENT trying to create a session template', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile: '+966500000601',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000601', code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000601', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${loginResponse.body.token}`)
      .send({
        sessionNumber: 2,
        category: 1,
        trainingDurationDays: 3,
        instructions: 'Should not be created.',
      });

    expect(response.status).toBe(403);
  });

  it('lists session templates ordered by sessionNumber', async () => {
    const token = await createClinicianToken('+966500000602', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${token}`).send({
      sessionNumber: 2,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 2 instructions.',
    });
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${token}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/session-templates')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.map((t: { sessionNumber: number }) => t.sessionNumber)).toEqual([1, 2]);
  });

  it('gets a single session template by id', async () => {
    const token = await createClinicianToken('+966500000603', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionNumber: 5,
        category: 2,
        trainingDurationDays: 4,
        instructions: 'Retrievable template.',
      });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/session-templates/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.instructions).toBe('Retrievable template.');
  });

  it('lets a CLINICIAN update a session template', async () => {
    const token = await createClinicianToken('+966500000604', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/session-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionNumber: 10,
        category: 4,
        trainingDurationDays: 3,
        instructions: 'Original instructions.',
      });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/session-templates/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ instructions: 'Updated instructions.' });

    expect(response.status).toBe(200);
    expect(response.body.instructions).toBe('Updated instructions.');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:e2e -- session-templates`
Expected: FAIL — `/api/v1/session-templates` routes don't exist yet.

- [ ] **Step 5: Create `src/modules/sessions/session-templates.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionTemplate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSessionTemplateDto } from './dto/create-session-template.dto';
import { UpdateSessionTemplateDto } from './dto/update-session-template.dto';

@Injectable()
export class SessionTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSessionTemplateDto): Promise<SessionTemplate> {
    return this.prisma.sessionTemplate.create({
      data: {
        sessionNumber: dto.sessionNumber,
        category: dto.category,
        cognitiveVideoUrl: dto.cognitiveVideoUrl,
        behavioralVideoUrl: dto.behavioralVideoUrl,
        trainingDurationDays: dto.trainingDurationDays,
        instructions: dto.instructions,
      },
    });
  }

  findAll(): Promise<SessionTemplate[]> {
    return this.prisma.sessionTemplate.findMany({ orderBy: { sessionNumber: 'asc' } });
  }

  async findById(id: string): Promise<SessionTemplate> {
    const template = await this.prisma.sessionTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Session template not found');
    }
    return template;
  }

  async findByNumberOrThrow(sessionNumber: number): Promise<SessionTemplate> {
    const template = await this.prisma.sessionTemplate.findUnique({ where: { sessionNumber } });
    if (!template) {
      throw new NotFoundException(`Session template ${sessionNumber} not found`);
    }
    return template;
  }

  async update(id: string, dto: UpdateSessionTemplateDto): Promise<SessionTemplate> {
    await this.findById(id);
    return this.prisma.sessionTemplate.update({
      where: { id },
      data: {
        category: dto.category,
        cognitiveVideoUrl: dto.cognitiveVideoUrl,
        behavioralVideoUrl: dto.behavioralVideoUrl,
        trainingDurationDays: dto.trainingDurationDays,
        instructions: dto.instructions,
      },
    });
  }
}
```

- [ ] **Step 6: Create `src/modules/sessions/session-templates.controller.ts`**

```typescript
import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SessionTemplatesService } from './session-templates.service';
import { CreateSessionTemplateDto } from './dto/create-session-template.dto';
import { UpdateSessionTemplateDto } from './dto/update-session-template.dto';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/session-templates')
@UseGuards(SessionGuard, PermissionsGuard)
export class SessionTemplatesController {
  constructor(private readonly sessionTemplatesService: SessionTemplatesService) {}

  @Post()
  @RequirePermission(Permission.MANAGE_SESSION_TEMPLATES)
  create(@Body() dto: CreateSessionTemplateDto) {
    return this.sessionTemplatesService.create(dto);
  }

  @Get()
  @RequirePermission(Permission.VIEW_SESSION_TEMPLATES)
  findAll() {
    return this.sessionTemplatesService.findAll();
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_SESSION_TEMPLATES)
  findOne(@Param('id') id: string) {
    return this.sessionTemplatesService.findById(id);
  }

  @Put(':id')
  @RequirePermission(Permission.MANAGE_SESSION_TEMPLATES)
  update(@Param('id') id: string, @Body() dto: UpdateSessionTemplateDto) {
    return this.sessionTemplatesService.update(id, dto);
  }
}
```

- [ ] **Step 7: Create `src/modules/sessions/sessions.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { SessionTemplatesController } from './session-templates.controller';
import { SessionTemplatesService } from './session-templates.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SessionTemplatesController],
  providers: [SessionTemplatesService],
  exports: [SessionTemplatesService],
})
export class SessionsModule {}
```

- [ ] **Step 8: Modify `src/app.module.ts` to import `SessionsModule`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { TreatmentPlansModule } from './modules/treatment-plans/treatment-plans.module';
import { SessionsModule } from './modules/sessions/sessions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    ExercisesModule,
    AssessmentsModule,
    TreatmentPlansModule,
    SessionsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 5 new tests in `session-templates.e2e-spec.ts`.

- [ ] **Step 10: Commit**

```bash
git add backend/
git commit -m "feat: add session template creation, listing, retrieval, and update"
```

---

### Task 5: Patient Sessions — start the program

**Files:**
- Create: `backend/src/modules/sessions/patient-sessions.service.ts`
- Create: `backend/src/modules/sessions/patient-sessions.controller.ts`
- Modify: `backend/src/modules/sessions/sessions.module.ts`
- Test: `backend/test/patient-sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `SessionTemplatesService.findByNumberOrThrow()` (Task 4), `PatientAccessService.assertCanAccess()` (Task 3).
- Produces: `PatientSessionsService.start()`, and the private `findPatientProfileOrThrow()` helper — reused by Tasks 6-9.

- [ ] **Step 1: Write the failing tests — `test/patient-sessions.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Patient Sessions: start the program', () => {
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

  async function setUpPatientWithActivePlan(clinicianToken: string, patientMobile: string, nationalId: string) {
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Session Test Patient',
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
        fullName: 'Session Test Patient',
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

  it('lets a PATIENT start the program when session 1 template exists and their plan is active', async () => {
    const clinicianToken = await createClinicianToken('+966500000700', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000701', 'SES-TEST-1');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(201);
    expect(response.body.attemptNumber).toBe(1);
    expect(response.body.status).toBe('IN_TRAINING');
  });

  it('rejects starting the program without an active treatment plan', async () => {
    const clinicianToken = await createClinicianToken('+966500000702', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'No Plan Patient',
      mobile: '+966500000703',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000703', code: patientRegister.body.devOtpCode });
    const profileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'No Plan Patient',
        gender: 'MALE',
        dateOfBirth: '1990-01-01',
        nationalId: 'SES-TEST-2',
      });
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000703', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/sessions/start`)
      .set('Authorization', `Bearer ${patientLogin.body.token}`);

    expect(response.status).toBe(400);
  });

  it('rejects starting the program a second time', async () => {
    const clinicianToken = await createClinicianToken('+966500000704', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000705', 'SES-TEST-3');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(409);
  });

  it('rejects an unrelated PATIENT starting another patient\'s program', async () => {
    const clinicianToken = await createClinicianToken('+966500000706', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId } = await setUpPatientWithActivePlan(clinicianToken, '+966500000707', 'SES-TEST-4');
    const otherPatientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500000708',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000708', code: otherPatientRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000708', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- patient-sessions`
Expected: FAIL — `/api/v1/patients/:patientId/sessions/start` doesn't exist yet.

- [ ] **Step 3: Create `src/modules/sessions/patient-sessions.service.ts`**

```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, PatientSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { SessionTemplatesService } from './session-templates.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class PatientSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
    private readonly sessionTemplatesService: SessionTemplatesService,
  ) {}

  async start(patientProfileId: string, actor: AuthenticatedUser): Promise<PatientSession> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const activePlan = await this.prisma.treatmentPlan.findFirst({
      where: { patientProfileId, status: 'ACTIVE' },
    });
    if (!activePlan) {
      throw new BadRequestException('Starting the program requires an active treatment plan');
    }

    const existing = await this.prisma.patientSession.findFirst({ where: { patientProfileId } });
    if (existing) {
      throw new ConflictException('The program has already been started for this patient');
    }

    const firstTemplate = await this.sessionTemplatesService.findByNumberOrThrow(1);

    return this.prisma.patientSession.create({
      data: {
        patientProfileId,
        treatmentPlanId: activePlan.id,
        sessionTemplateId: firstTemplate.id,
        attemptNumber: 1,
      },
    });
  }

  async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
```

- [ ] **Step 4: Create `src/modules/sessions/patient-sessions.controller.ts`**

```typescript
import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PatientSessionsService } from './patient-sessions.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/sessions')
@UseGuards(SessionGuard, PermissionsGuard)
export class PatientSessionsController {
  constructor(private readonly patientSessionsService: PatientSessionsService) {}

  @Post('start')
  @RequirePermission(Permission.START_SESSION)
  start(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.start(patientId, user);
  }
}
```

- [ ] **Step 5: Modify `src/modules/sessions/sessions.module.ts` to register the new controller/service**

```typescript
import { Module } from '@nestjs/common';
import { SessionTemplatesController } from './session-templates.controller';
import { SessionTemplatesService } from './session-templates.service';
import { PatientSessionsController } from './patient-sessions.controller';
import { PatientSessionsService } from './patient-sessions.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';

@Module({
  imports: [AuthModule, PatientAccessModule],
  controllers: [SessionTemplatesController, PatientSessionsController],
  providers: [SessionTemplatesService, PatientSessionsService],
  exports: [SessionTemplatesService, PatientSessionsService],
})
export class SessionsModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 4 new tests in `patient-sessions.e2e-spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add starting the 30-session program"
```

---

### Task 6: Patient Sessions — submit self-ratings

**Files:**
- Create: `backend/src/modules/sessions/dto/submit-ratings.dto.ts`
- Modify: `backend/src/modules/sessions/patient-sessions.service.ts`
- Modify: `backend/src/modules/sessions/patient-sessions.controller.ts`
- Test: `backend/test/patient-sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientSessionsService.findPatientProfileOrThrow()` (Task 5).
- Produces: `PatientSessionsService.findCurrentOrThrow()` (a plain method, not exposed via any route directly — reused by Tasks 7-9) and `.submitRatings()`.

- [ ] **Step 1: Create `src/modules/sessions/dto/submit-ratings.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubmitRatingsSchema = z.object({
  selfSeverityCurrent: z.number().int().min(0).max(8).optional(),
  selfSeverityExpectedNext: z.number().int().min(0).max(8).optional(),
  camperdownPerformanceRating: z.number().int().min(1).max(9).optional(),
  clientOpinionScore: z.number().int().min(0).max(10).optional(),
});

export class SubmitRatingsDto extends createZodDto(SubmitRatingsSchema) {}
```

- [ ] **Step 2: Write the failing tests — append to the `'Patient Sessions: start the program'` describe block in `test/patient-sessions.e2e-spec.ts`**

```typescript
  it('lets a PATIENT submit self-ratings while in training', async () => {
    const clinicianToken = await createClinicianToken('+966500000710', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000711', 'SES-TEST-5');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/sessions/current/ratings`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ selfSeverityCurrent: 4, selfSeverityExpectedNext: 3, camperdownPerformanceRating: 6, clientOpinionScore: 7 });

    expect(response.status).toBe(200);
    expect(response.body.selfSeverityCurrent).toBe(4);
    expect(response.body.camperdownPerformanceRating).toBe(6);
  });

  it('rejects submitting ratings when no session has been started', async () => {
    const clinicianToken = await createClinicianToken('+966500000712', 'password123');
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000713', 'SES-TEST-6');

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/sessions/current/ratings`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ selfSeverityCurrent: 2 });

    expect(response.status).toBe(404);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e -- patient-sessions`
Expected: FAIL — `PUT .../sessions/current/ratings` doesn't exist yet.

- [ ] **Step 4: Add `findCurrentOrThrow` and `submitRatings` to `src/modules/sessions/patient-sessions.service.ts`**

Add this import (merge with the existing import lines):

```typescript
import { SubmitRatingsDto } from './dto/submit-ratings.dto';
```

Add these methods to the `PatientSessionsService` class, after `findPatientProfileOrThrow`:

```typescript
  async findCurrentOrThrow(patientProfileId: string, actor: AuthenticatedUser): Promise<PatientSession> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const current = await this.prisma.patientSession.findFirst({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!current) {
      throw new NotFoundException('No session has been started for this patient yet');
    }
    return current;
  }

  async submitRatings(patientProfileId: string, dto: SubmitRatingsDto, actor: AuthenticatedUser): Promise<PatientSession> {
    const current = await this.findCurrentOrThrow(patientProfileId, actor);
    if (current.status !== 'IN_TRAINING') {
      throw new BadRequestException('Ratings can only be submitted while the current attempt is in training');
    }

    return this.prisma.patientSession.update({
      where: { id: current.id },
      data: {
        selfSeverityCurrent: dto.selfSeverityCurrent,
        selfSeverityExpectedNext: dto.selfSeverityExpectedNext,
        camperdownPerformanceRating: dto.camperdownPerformanceRating,
        clientOpinionScore: dto.clientOpinionScore,
      },
    });
  }
```

- [ ] **Step 5: Add the new route to `src/modules/sessions/patient-sessions.controller.ts`**

Add to imports (merge with the existing `@nestjs/common` import line):

```typescript
import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
```

Add this import:

```typescript
import { SubmitRatingsDto } from './dto/submit-ratings.dto';
```

Add this route to the `PatientSessionsController` class, after `start`:

```typescript
  @Put('current/ratings')
  @RequirePermission(Permission.SUBMIT_SESSION)
  submitRatings(@Param('patientId') patientId: string, @Body() dto: SubmitRatingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.submitRatings(patientId, dto, user);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 2 new tests.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add submitting self-ratings for the current session attempt"
```

---

### Task 7: Patient Sessions — submit the practice sample (training-duration gate)

**Files:**
- Create: `backend/src/modules/sessions/dto/submit-sample.dto.ts`
- Modify: `backend/src/modules/sessions/patient-sessions.service.ts`
- Modify: `backend/src/modules/sessions/patient-sessions.controller.ts`
- Test: `backend/test/patient-sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientSessionsService.findCurrentOrThrow()` (Task 6).
- Produces: `PatientSessionsService.submitSample()` — consumed by no later task directly, but its `SUBMITTED` status transition is the precondition Task 8's review endpoint checks for.

- [ ] **Step 1: Create `src/modules/sessions/dto/submit-sample.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubmitSampleSchema = z.object({
  sampleVideoUrl: z.url(),
});

export class SubmitSampleDto extends createZodDto(SubmitSampleSchema) {}
```

- [ ] **Step 2: Write the failing tests — append to the `'Patient Sessions: start the program'` describe block in `test/patient-sessions.e2e-spec.ts`**

```typescript
  it('rejects submitting the sample before the training duration has elapsed', async () => {
    const clinicianToken = await createClinicianToken('+966500000720', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000721', 'SES-TEST-7');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/sample.mp4' });

    expect(response.status).toBe(400);
  });

  it('lets a PATIENT submit the sample once the training duration has elapsed', async () => {
    const clinicianToken = await createClinicianToken('+966500000722', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000723', 'SES-TEST-8');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    // Backdate trainingStartedAt so the 3-day requirement has already elapsed.
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/sample.mp4' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('SUBMITTED');
    expect(response.body.sampleVideoUrl).toBe('https://example.com/sample.mp4');
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e -- patient-sessions`
Expected: FAIL — `POST .../sessions/current/submit` doesn't exist yet.

- [ ] **Step 4: Add `submitSample` to `src/modules/sessions/patient-sessions.service.ts`**

Add this import (merge with the existing import lines):

```typescript
import { SubmitSampleDto } from './dto/submit-sample.dto';
```

Add this method to the `PatientSessionsService` class, after `submitRatings`:

```typescript
  async submitSample(patientProfileId: string, dto: SubmitSampleDto, actor: AuthenticatedUser): Promise<PatientSession> {
    const current = await this.findCurrentOrThrow(patientProfileId, actor);
    if (current.status !== 'IN_TRAINING') {
      throw new BadRequestException('The sample can only be submitted while the current attempt is in training');
    }

    const template = await this.sessionTemplatesService.findById(current.sessionTemplateId);
    const requiredMillis = template.trainingDurationDays * 24 * 60 * 60 * 1000;
    const elapsedMillis = Date.now() - current.trainingStartedAt.getTime();
    if (elapsedMillis < requiredMillis) {
      throw new BadRequestException(
        `The required training period (${template.trainingDurationDays} day(s)) has not elapsed yet`,
      );
    }

    return this.prisma.patientSession.update({
      where: { id: current.id },
      data: {
        sampleVideoUrl: dto.sampleVideoUrl,
        sampleSubmittedAt: new Date(),
        status: 'SUBMITTED',
      },
    });
  }
```

- [ ] **Step 5: Add the new route to `src/modules/sessions/patient-sessions.controller.ts`**

Add this import:

```typescript
import { SubmitSampleDto } from './dto/submit-sample.dto';
```

Add this route to the `PatientSessionsController` class, after `submitRatings`:

```typescript
  @Post('current/submit')
  @RequirePermission(Permission.SUBMIT_SESSION)
  submitSample(@Param('patientId') patientId: string, @Body() dto: SubmitSampleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.submitSample(patientId, dto, user);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 2 new tests.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add submitting the practice sample with training-duration gate"
```

---

### Task 8: Patient Sessions — clinician review (approve/repeat, atomic next attempt)

**Files:**
- Create: `backend/src/modules/sessions/dto/review-session.dto.ts`
- Modify: `backend/src/modules/sessions/patient-sessions.service.ts`
- Modify: `backend/src/modules/sessions/patient-sessions.controller.ts`
- Test: `backend/test/patient-sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `SessionTemplatesService.findById()` (Task 4).
- Produces: `PatientSessionsService.review()` — the only method in this plan that creates a new `PatientSession` attempt row (other than `start()`'s first row); no later task consumes it directly, but it's the mechanism that makes 30-session progression possible at all.

- [ ] **Step 1: Create `src/modules/sessions/dto/review-session.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReviewSessionSchema = z.object({
  decision: z.enum(['APPROVE', 'REPEAT']),
  reviewNotes: z.string().optional(),
  clinicianOpinionScore: z.number().int().min(0).max(10).optional(),
});

export class ReviewSessionDto extends createZodDto(ReviewSessionSchema) {}
```

- [ ] **Step 2: Write the failing tests — append to the `'Patient Sessions: start the program'` describe block in `test/patient-sessions.e2e-spec.ts`**

```typescript
  async function startAndSubmitSample(clinicianToken: string, profileId: string, patientToken: string) {
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/sample.mp4' });
  }

  it('advances the patient to session 2 when the clinician approves', async () => {
    const clinicianToken = await createClinicianToken('+966500000730', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 2,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 2 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000731', 'SES-TEST-9');
    await startAndSubmitSample(clinicianToken, profileId, patientToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'APPROVE', reviewNotes: 'Good progress.', clinicianOpinionScore: 8 });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('APPROVED');

    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions/current`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(currentResponse.body.status).toBe('IN_TRAINING');
    expect(currentResponse.body.attemptNumber).toBe(1);
  });

  it('creates a new attempt at the same session when the clinician requires a repeat', async () => {
    const clinicianToken = await createClinicianToken('+966500000732', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000733', 'SES-TEST-10');
    await startAndSubmitSample(clinicianToken, profileId, patientToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'REPEAT', reviewNotes: 'Needs more practice.' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('REPEAT_REQUIRED');

    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions/current`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(currentResponse.body.attemptNumber).toBe(2);
    expect(currentResponse.body.status).toBe('IN_TRAINING');
  });

  it('rejects a PATIENT trying to review their own session', async () => {
    const clinicianToken = await createClinicianToken('+966500000734', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000735', 'SES-TEST-11');
    await startAndSubmitSample(clinicianToken, profileId, patientToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ decision: 'APPROVE' });

    expect(response.status).toBe(403);
  });

  it('rejects reviewing an attempt that has not been submitted yet', async () => {
    const clinicianToken = await createClinicianToken('+966500000736', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000737', 'SES-TEST-12');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'APPROVE' });

    expect(response.status).toBe(400);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e -- patient-sessions`
Expected: FAIL — `POST .../sessions/current/review` doesn't exist yet.

- [ ] **Step 4: Add `review` to `src/modules/sessions/patient-sessions.service.ts`**

Add this import (merge with the existing import lines):

```typescript
import { ReviewSessionDto } from './dto/review-session.dto';
```

Add this method to the `PatientSessionsService` class, after `submitSample`:

```typescript
  async review(patientProfileId: string, dto: ReviewSessionDto, actor: AuthenticatedUser): Promise<PatientSession> {
    await this.findPatientProfileOrThrow(patientProfileId);

    const current = await this.prisma.patientSession.findFirst({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!current) {
      throw new NotFoundException('No session has been started for this patient yet');
    }
    if (current.status !== 'SUBMITTED') {
      throw new BadRequestException('Only a submitted attempt can be reviewed');
    }

    return this.prisma.$transaction(async (tx) => {
      const decisionStatus = dto.decision === 'APPROVE' ? 'APPROVED' : 'REPEAT_REQUIRED';
      const reviewed = await tx.patientSession.update({
        where: { id: current.id },
        data: {
          status: decisionStatus,
          clinicianUserId: actor.id,
          reviewNotes: dto.reviewNotes,
          clinicianOpinionScore: dto.clinicianOpinionScore,
          reviewedAt: new Date(),
        },
      });

      if (dto.decision === 'REPEAT') {
        await tx.patientSession.create({
          data: {
            patientProfileId,
            treatmentPlanId: current.treatmentPlanId,
            sessionTemplateId: current.sessionTemplateId,
            attemptNumber: current.attemptNumber + 1,
          },
        });
        return reviewed;
      }

      const currentTemplate = await tx.sessionTemplate.findUnique({ where: { id: current.sessionTemplateId } });
      if (!currentTemplate) {
        throw new NotFoundException('Session template not found');
      }

      if (currentTemplate.sessionNumber < 30) {
        const nextTemplate = await tx.sessionTemplate.findUnique({
          where: { sessionNumber: currentTemplate.sessionNumber + 1 },
        });
        if (!nextTemplate) {
          throw new NotFoundException(`Session template ${currentTemplate.sessionNumber + 1} not found`);
        }
        await tx.patientSession.create({
          data: {
            patientProfileId,
            treatmentPlanId: current.treatmentPlanId,
            sessionTemplateId: nextTemplate.id,
            attemptNumber: 1,
          },
        });
      }

      return reviewed;
    });
  }
```

- [ ] **Step 5: Add a `GET current` route and the review route to `src/modules/sessions/patient-sessions.controller.ts`**

(The `GET current` route is needed by this task's own tests to check the post-review state; Task 9 formalizes the rest of the read endpoints, but this one can't wait since these tests need it now.)

Add to imports (merge with the existing `@nestjs/common` import line):

```typescript
import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
```

Add this import:

```typescript
import { ReviewSessionDto } from './dto/review-session.dto';
```

Add these two routes to the `PatientSessionsController` class, after `submitSample`:

```typescript
  @Get('current')
  @RequirePermission(Permission.VIEW_SESSION)
  getCurrent(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.findCurrentOrThrow(patientId, user);
  }

  @Post('current/review')
  @RequirePermission(Permission.REVIEW_SESSION)
  review(@Param('patientId') patientId: string, @Body() dto: ReviewSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.review(patientId, dto, user);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 4 new tests.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add clinician review with atomic next-attempt creation"
```

---

### Task 9: Patient Sessions — full attempt history

**Files:**
- Modify: `backend/src/modules/sessions/patient-sessions.service.ts`
- Modify: `backend/src/modules/sessions/patient-sessions.controller.ts`
- Test: `backend/test/patient-sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientAccessService.assertCanAccess()` (Task 3), `findPatientProfileOrThrow()` (Task 5).
- Produces: `PatientSessionsService.listHistory()` — consumed by Task 10's Progress dashboard (via direct Prisma query, not this method, since Progress needs aggregation rather than the raw list — see Task 10's own interface note). No other task depends on this one directly; it's the last read endpoint for the Sessions module itself.

- [ ] **Step 1: Write the failing tests — append to the `'Patient Sessions: start the program'` describe block in `test/patient-sessions.e2e-spec.ts`**

```typescript
  it('lists the full attempt history for a patient, oldest first', async () => {
    const clinicianToken = await createClinicianToken('+966500000740', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000741', 'SES-TEST-13');
    await startAndSubmitSample(clinicianToken, profileId, patientToken);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'REPEAT' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0].attemptNumber).toBe(1);
    expect(response.body[0].status).toBe('REPEAT_REQUIRED');
    expect(response.body[1].attemptNumber).toBe(2);
    expect(response.body[1].status).toBe('IN_TRAINING');
  });

  it('rejects an unrelated PATIENT viewing another patient\'s session history', async () => {
    const clinicianToken = await createClinicianToken('+966500000742', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000743', 'SES-TEST-14');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    const otherPatientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500000744',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000744', code: otherPatientRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000744', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- patient-sessions`
Expected: FAIL — `GET /api/v1/patients/:patientId/sessions` doesn't exist yet.

- [ ] **Step 3: Add `listHistory` to `src/modules/sessions/patient-sessions.service.ts`**

Add this method to the `PatientSessionsService` class, after `review`:

```typescript
  async listHistory(patientProfileId: string, actor: AuthenticatedUser): Promise<PatientSession[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    return this.prisma.patientSession.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'asc' },
    });
  }
```

- [ ] **Step 4: Add the new route to `src/modules/sessions/patient-sessions.controller.ts`**

Add this route to the `PatientSessionsController` class, after `getCurrent`:

```typescript
  @Get()
  @RequirePermission(Permission.VIEW_SESSION)
  listHistory(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.listHistory(patientId, user);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 2 new tests.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add full session attempt history listing"
```

---

### Task 10: Progress — aggregated dashboard

**Files:**
- Create: `backend/src/modules/progress/progress.service.ts`
- Create: `backend/src/modules/progress/progress.controller.ts`
- Create: `backend/src/modules/progress/progress.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/progress.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientAccessService.assertCanAccess()` (Task 3), the `PatientSession`/`SessionTemplate` Prisma models (Task 1). Queries `PatientSession` directly via Prisma rather than through `PatientSessionsService` — this is a read-only aggregation with its own query shape (joins `sessionTemplate` for `sessionNumber`), not a reuse of `listHistory()`'s plain list.
- Produces: `ProgressService.getDashboard()` — the last piece of this plan before the final Swagger/smoke task.

- [ ] **Step 1: Write the failing tests — `test/progress.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Progress: aggregated dashboard', () => {
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

  async function setUpPatientWithActivePlan(clinicianToken: string, patientMobile: string, nationalId: string) {
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Progress Test Patient',
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
        fullName: 'Progress Test Patient',
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

  it('returns a zeroed dashboard before the program has started', async () => {
    const clinicianToken = await createClinicianToken('+966500000750', 'password123');
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000751', 'PROG-TEST-1');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/progress`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.currentSessionNumber).toBeNull();
    expect(response.body.totalAttempts).toBe(0);
  });

  it('reflects a repeated session in the dashboard', async () => {
    const clinicianToken = await createClinicianToken('+966500000752', 'password123');
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Session 1 instructions.',
    });
    const { profileId, patientToken } = await setUpPatientWithActivePlan(clinicianToken, '+966500000753', 'PROG-TEST-2');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/sample.mp4' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'REPEAT' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/progress`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.currentSessionNumber).toBe(1);
    expect(response.body.totalAttempts).toBe(2);
    expect(response.body.sessionsApproved).toBe(0);
    expect(response.body.repeatedSessionNumbers).toEqual([1]);
  });

  it('rejects an unrelated PATIENT viewing another patient\'s progress', async () => {
    const clinicianToken = await createClinicianToken('+966500000754', 'password123');
    const { profileId } = await setUpPatientWithActivePlan(clinicianToken, '+966500000755', 'PROG-TEST-3');
    const otherPatientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unrelated Patient',
      mobile: '+966500000756',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000756', code: otherPatientRegister.body.devOtpCode });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000756', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/progress`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- progress`
Expected: FAIL — `/api/v1/patients/:patientId/progress` doesn't exist yet.

- [ ] **Step 3: Create `src/modules/progress/progress.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export interface ProgressDashboard {
  currentSessionNumber: number | null;
  sessionsApproved: number;
  totalAttempts: number;
  repeatedSessionNumbers: number[];
  daysInProgram: number;
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async getDashboard(patientProfileId: string, actor: AuthenticatedUser): Promise<ProgressDashboard> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const sessions = await this.prisma.patientSession.findMany({
      where: { patientProfileId },
      include: { sessionTemplate: true },
      orderBy: { createdAt: 'asc' },
    });

    if (sessions.length === 0) {
      return { currentSessionNumber: null, sessionsApproved: 0, totalAttempts: 0, repeatedSessionNumbers: [], daysInProgram: 0 };
    }

    const approvedSessionNumbers = new Set(
      sessions.filter((s) => s.status === 'APPROVED').map((s) => s.sessionTemplate.sessionNumber),
    );

    const attemptCountBySessionNumber = new Map<number, number>();
    for (const s of sessions) {
      const n = s.sessionTemplate.sessionNumber;
      attemptCountBySessionNumber.set(n, (attemptCountBySessionNumber.get(n) ?? 0) + 1);
    }
    const repeatedSessionNumbers = [...attemptCountBySessionNumber.entries()]
      .filter(([, count]) => count > 1)
      .map(([sessionNumber]) => sessionNumber)
      .sort((a, b) => a - b);

    const latest = sessions[sessions.length - 1];
    const first = sessions[0];
    const daysInProgram = Math.floor((Date.now() - first.trainingStartedAt.getTime()) / (24 * 60 * 60 * 1000));

    return {
      currentSessionNumber: latest.sessionTemplate.sessionNumber,
      sessionsApproved: approvedSessionNumbers.size,
      totalAttempts: sessions.length,
      repeatedSessionNumbers,
      daysInProgram,
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

- [ ] **Step 4: Create `src/modules/progress/progress.controller.ts`**

```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/progress')
@UseGuards(SessionGuard, PermissionsGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get()
  @RequirePermission(Permission.VIEW_PROGRESS)
  getDashboard(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.progressService.getDashboard(patientId, user);
  }
}
```

- [ ] **Step 5: Create `src/modules/progress/progress.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';

@Module({
  imports: [AuthModule, PatientAccessModule],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
```

- [ ] **Step 6: Modify `src/app.module.ts` to import `ProgressModule`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { TreatmentPlansModule } from './modules/treatment-plans/treatment-plans.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { ProgressModule } from './modules/progress/progress.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    ExercisesModule,
    AssessmentsModule,
    TreatmentPlansModule,
    SessionsModule,
    ProgressModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 3 new tests in `progress.e2e-spec.ts`.

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: add aggregated progress dashboard"
```

---

### Task 11: Swagger description update and full sessions-progress smoke test

**Files:**
- Modify: `backend/src/main.ts`
- Test: `backend/test/sessions-progress-smoke.e2e-spec.ts`

**Interfaces:**
- Consumes: every service built in Tasks 1-10.
- Produces: nothing further — this is the final task of the plan.

- [ ] **Step 1: Update the Swagger description in `src/main.ts`**

Change the `.setDescription(...)` line in the `DocumentBuilder` config from:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, and Exercise Library modules')
```

to:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Sessions, and Progress modules')
```

Leave every other line in `main.ts` untouched.

- [ ] **Step 2: Write the smoke test — `test/sessions-progress-smoke.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Smoke test: full session progression from start to clinician-approved advance', () => {
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

  it('walks a patient from program start through a repeat and on to an approved advance', async () => {
    // 1. Seed a clinician and create the first two session templates
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Dr. Nourah Al-Shammari',
      mobile: '+966500000800',
      password: 'clinician-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000800', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500000800' }, data: { role: 'CLINICIAN' } });
    const clinicianLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000800', password: 'clinician-pass1' });
    const clinicianToken = clinicianLogin.body.token;

    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 1,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Extend a single vowel sound for 5 seconds while opening and closing your hand.',
    });
    await request(app.getHttpServer()).post('/api/v1/session-templates').set('Authorization', `Bearer ${clinicianToken}`).send({
      sessionNumber: 2,
      category: 1,
      trainingDurationDays: 3,
      instructions: 'Extend a single-syllable word for 5 seconds.',
    });

    // 2. Register a patient and build them up to an active treatment plan
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Yousef Al-Ghamdi',
      mobile: '+966500000801',
      password: 'patient-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000801', code: patientRegister.body.devOtpCode });
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000801', password: 'patient-pass1' });
    const patientToken = patientLogin.body.token;

    const profileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'Yousef Al-Ghamdi',
        gender: 'MALE',
        dateOfBirth: '1995-06-01',
        nationalId: 'SMOKE-SESSIONS-1',
      });
    const profileId = profileResponse.body.id;

    const assessmentResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentResponse.body.id}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MODERATE' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/treatment-plans`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ assessmentId: assessmentResponse.body.id, goals: 'Complete the 30-session program', reviewDate: '2026-12-01' });

    // 3. Patient starts the program (session 1, attempt 1)
    const startResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/start`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(startResponse.status).toBe(201);
    expect(startResponse.body.attemptNumber).toBe(1);

    // 4. Patient submits self-ratings, then (after backdating the training start) the sample
    await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/sessions/current/ratings`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ selfSeverityCurrent: 5, selfSeverityExpectedNext: 4, camperdownPerformanceRating: 5, clientOpinionScore: 6 });
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });
    const submitResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/attempt-1.mp4' });
    expect(submitResponse.status).toBe(201);
    expect(submitResponse.body.status).toBe('SUBMITTED');

    // 5. Clinician requires a repeat
    const repeatReviewResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'REPEAT', reviewNotes: 'Hand synchronization needs more practice.' });
    expect(repeatReviewResponse.status).toBe(201);
    expect(repeatReviewResponse.body.status).toBe('REPEAT_REQUIRED');

    // 6. Patient retrains and submits a second attempt
    await prisma.patientSession.updateMany({
      where: { patientProfileId: profileId, status: 'IN_TRAINING' },
      data: { trainingStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
    });
    const secondSubmitResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ sampleVideoUrl: 'https://example.com/attempt-2.mp4' });
    expect(secondSubmitResponse.status).toBe(201);

    // 7. Clinician approves, advancing to session 2
    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/sessions/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'APPROVE', reviewNotes: 'Well done.', clinicianOpinionScore: 8 });
    expect(approveResponse.status).toBe(201);
    expect(approveResponse.body.status).toBe('APPROVED');

    // 8. The patient's current attempt is now session 2, attempt 1
    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions/current`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(currentResponse.body.attemptNumber).toBe(1);

    // 9. Full history shows 3 rows: attempt 1 (repeat-required), attempt 2 (approved), session 2 attempt 1 (in training)
    const historyResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/sessions`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(historyResponse.body).toHaveLength(3);

    // 10. Progress dashboard reflects one approved session and one repeated session
    const progressResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/progress`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(progressResponse.body.currentSessionNumber).toBe(2);
    expect(progressResponse.body.sessionsApproved).toBe(1);
    expect(progressResponse.body.totalAttempts).toBe(3);
    expect(progressResponse.body.repeatedSessionNumbers).toEqual([1]);

    // 11. Every mutating step was audit-logged
    const auditActions = (await prisma.auditLog.findMany()).map((log) => log.action);
    expect(auditActions).toEqual(
      expect.arrayContaining([
        'POST /api/v1/patients',
        expect.stringContaining('/sessions/start'),
        expect.stringContaining('/sessions/current/submit'),
        expect.stringContaining('/sessions/current/review'),
      ]),
    );
  });
});
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test && npm run test:e2e`
Expected: PASS — all unit suites pass; all e2e suites pass, including the new smoke test.

- [ ] **Step 4: Verify the app boots and Swagger reflects the new modules**

Run: `npm run start:dev` (one terminal), then in another:
```bash
curl http://localhost:3000/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/docs
```
Expected: `{"status":"ok"}`, then `200`. Stop the dev server before continuing.

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: update Swagger description and add full sessions-progress smoke test"
```

---
