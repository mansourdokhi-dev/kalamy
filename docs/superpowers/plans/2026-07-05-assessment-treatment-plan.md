# Kalamy Clinical Core (Assessment + Treatment Plan + Exercise Library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Kalamy NestJS backend with three modules — Assessment (ASM), Treatment Plan (PLAN), and Exercise Library (EX) — building on the merged Foundation (Auth + Patient Profile).

**Architecture:** Three new feature modules (`assessments`, `treatment-plans`, `exercises`) added to `backend/src/modules/`, following the exact shape of the existing `auth`/`patients` modules. Five new Prisma models. No new cross-cutting infrastructure — RBAC guards, session guard, audit interceptor, exception filter, and Zod validation are already global and apply automatically.

**Tech Stack:** Same as Foundation — NestJS 11 (TypeScript), PostgreSQL 16 (Docker), Prisma 6.19.3, nestjs-zod + Zod, Jest.

**Reference spec:** `docs/superpowers/specs/2026-07-05-assessment-treatment-plan-design.md`

## Global Constraints

- All endpoints are under `/api/v1/...`, matching the Foundation's convention.
- Assessments are never hard-deleted — only `DRAFT`/`APPROVED` status changes.
- Treatment plans are never hard-deleted — creating a new plan for a patient sets the prior plan's `status` to `INACTIVE` in the same transaction (enforced: exactly one `ACTIVE` plan per patient at a time).
- Exercises are never hard-deleted — `PATCH .../status` to `ARCHIVED` is blocked if the exercise is referenced by a `PlanExercise` row belonging to a plan with `status: ACTIVE`.
- SSI-4 subscores (`ssi4Frequency`, `ssi4Duration`, `ssi4PhysicalConcomitants`, `ssi4Total`) are stored as plain integers. The mapping from total score to `severityCategory` is **not computed by the system** — the clinician submits `severityCategory` directly as part of approving/editing the assessment. This is a deliberate, documented limitation (see design spec's Source document notes), not an oversight — do not add a scoring algorithm.
- A treatment plan cannot be created unless its referenced assessment has `status: APPROVED` — enforced at creation time (400 if not).
- Phase transitions are clinician-recorded decisions, not system-computed — there is no "eligibility" logic to enforce; the endpoint simply records the transition and updates the plan's current phase.
- Every new PostgreSQL-touching test is an integration test that runs against a real local Postgres (via the Foundation's existing `docker-compose.yml`) — never mocked, same as the Foundation.
- RBAC follows the Foundation's established split: CLINICIAN and ADMIN get create/approve/manage permissions; PATIENT/CAREGIVER get view-only on their own linked patient's data (ownership enforced in the service layer, same `assertCanAccess` pattern as `PatientsService`); SUPERVISOR gets view-only across all patients, no approval gate.

---

## File Structure

```
backend/
  prisma/
    schema.prisma                              (modified: 5 new models, 6 new enums, back-relations on User/PatientProfile)
  src/
    app.module.ts                               (modified: import 3 new modules)
    common/
      rbac/
        permissions.ts                          (modified: new Permission values + ROLE_PERMISSIONS entries)
        permissions.spec.ts                     (modified: new test cases)
    modules/
      exercises/
        exercises.module.ts
        exercises.controller.ts
        exercises.service.ts
        dto/
          create-exercise.dto.ts
          update-exercise.dto.ts
          update-exercise-status.dto.ts
      assessments/
        assessments.module.ts
        assessments.controller.ts
        assessments.service.ts
        dto/
          create-assessment.dto.ts
          update-assessment.dto.ts
          approve-assessment.dto.ts
      treatment-plans/
        treatment-plans.module.ts
        treatment-plans.controller.ts
        treatment-plans.service.ts
        dto/
          create-treatment-plan.dto.ts
          update-treatment-plan.dto.ts
          phase-transition.dto.ts
          link-exercise.dto.ts
  test/
    utils/
      test-app.ts                                (modified: resetDatabase deletes new tables)
    exercises.e2e-spec.ts
    assessments.e2e-spec.ts
    treatment-plans.e2e-spec.ts
    clinical-core-smoke.e2e-spec.ts
```

---

### Task 1: Prisma schema — Assessment, TreatmentPlan, PhaseTransition, Exercise, PlanExercise

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/test/utils/test-app.ts`
- Test: `backend/test/exercises.e2e-spec.ts` (just enough to prove the new tables round-trip; full CRUD tests come in later tasks)

**Interfaces:**
- Consumes: existing `User`, `PatientProfile` models (Foundation).
- Produces: `Assessment`, `TreatmentPlan`, `PhaseTransition`, `Exercise`, `PlanExercise` Prisma models and their generated TypeScript types (`@prisma/client`), used by every later task in this plan.

- [ ] **Step 1: Add new enums and models to `prisma/schema.prisma`**

Add these enums after the existing `enum PatientProfileStatus { ... }` block:

```prisma
enum AssessmentType {
  INITIAL
  PERIODIC
  FINAL
}

enum AssessmentStatus {
  DRAFT
  APPROVED
}

enum SeverityCategory {
  MILD
  MODERATE
  SEVERE
  VERY_SEVERE
}

enum TreatmentPhase {
  PHASE_1
  PHASE_2
  PHASE_3
  PHASE_4
  PHASE_5
}

enum PlanStatus {
  ACTIVE
  INACTIVE
}

enum ExerciseStatus {
  ACTIVE
  ARCHIVED
}
```

Add these fields to the existing `model User { ... }` block, immediately after `guardianLinksAsGuardian GuardianLink[] @relation("GuardianLinkGuardian")`:

```prisma
  assessments      Assessment[]
  treatmentPlans   TreatmentPlan[]
  phaseTransitions PhaseTransition[]
  exercisesCreated Exercise[]
```

Add this field to the existing `model PatientProfile { ... }` block, immediately after `clinicalInfo PatientClinicalInfo?`:

```prisma
  assessments    Assessment[]
  treatmentPlans TreatmentPlan[]
```

Add these new models at the end of the file, after `model AuditLog { ... }`:

```prisma
model Assessment {
  id                       String            @id @default(uuid())
  patientProfileId         String
  patientProfile           PatientProfile    @relation(fields: [patientProfileId], references: [id])
  clinicianUserId          String
  clinicianUser            User              @relation(fields: [clinicianUserId], references: [id])
  type                     AssessmentType
  status                   AssessmentStatus  @default(DRAFT)
  medicalHistory           String?
  difficultSituations      String?
  anxietyLevel             String?
  initialGoals             String?
  clinicianNotes           String?
  ssi4Frequency            Int?
  ssi4Duration             Int?
  ssi4PhysicalConcomitants Int?
  ssi4Total                Int?
  severityCategory         SeverityCategory?
  approvedAt               DateTime?
  createdAt                DateTime          @default(now())
  updatedAt                DateTime          @updatedAt

  treatmentPlans TreatmentPlan[]

  @@index([patientProfileId, createdAt])
}

model TreatmentPlan {
  id               String         @id @default(uuid())
  patientProfileId String
  patientProfile   PatientProfile @relation(fields: [patientProfileId], references: [id])
  clinicianUserId  String
  clinicianUser    User           @relation(fields: [clinicianUserId], references: [id])
  assessmentId     String
  assessment       Assessment     @relation(fields: [assessmentId], references: [id])
  phase            TreatmentPhase @default(PHASE_1)
  goals            String
  reviewDate       DateTime
  status           PlanStatus     @default(ACTIVE)
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  phaseTransitions PhaseTransition[]
  planExercises    PlanExercise[]

  @@index([patientProfileId, status])
}

model PhaseTransition {
  id              String         @id @default(uuid())
  treatmentPlanId String
  treatmentPlan   TreatmentPlan  @relation(fields: [treatmentPlanId], references: [id])
  fromPhase       TreatmentPhase
  toPhase         TreatmentPhase
  clinicianUserId String
  clinicianUser   User           @relation(fields: [clinicianUserId], references: [id])
  rationale       String?
  createdAt       DateTime       @default(now())
}

model Exercise {
  id              String         @id @default(uuid())
  title           String
  category        String
  phaseLevel      Int
  instructions    String
  mediaUrl        String?
  durationMinutes Int
  status          ExerciseStatus @default(ACTIVE)
  createdByUserId String
  createdByUser   User           @relation(fields: [createdByUserId], references: [id])
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  planExercises PlanExercise[]
}

model PlanExercise {
  id               String        @id @default(uuid())
  treatmentPlanId  String
  treatmentPlan    TreatmentPlan @relation(fields: [treatmentPlanId], references: [id])
  exerciseId       String
  exercise         Exercise      @relation(fields: [exerciseId], references: [id])
  frequencyPerWeek Int
  sequence         Int
  createdAt        DateTime      @default(now())

  @@unique([treatmentPlanId, exerciseId])
}
```

- [ ] **Step 2: Apply the migration**

Run: `docker compose up -d` (if Postgres isn't already running), then:
```bash
npm run prisma:migrate -- --name clinical_core
```
Expected: prompts complete non-interactively when a name is passed inline; creates `prisma/migrations/<timestamp>_clinical_core/migration.sql`; ends with "Your database is now in sync with your schema."

- [ ] **Step 3: Update `test/utils/test-app.ts`'s `resetDatabase` to clear the new tables**

Replace the `resetDatabase` function with (deletion order matters — children before parents):

```typescript
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
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

- [ ] **Step 4: Write a smoke test proving the new tables round-trip — `test/exercises.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Exercise schema smoke test', () => {
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

  it('can create and read an Exercise row', async () => {
    const clinician = await prisma.user.create({
      data: {
        fullName: 'Schema Test Clinician',
        mobile: '+966500000200',
        passwordHash: 'irrelevant-for-this-test',
        role: 'CLINICIAN',
        status: 'ACTIVE',
      },
    });

    const exercise = await prisma.exercise.create({
      data: {
        title: 'Diaphragmatic Breathing',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'Breathe in slowly through the nose for 4 counts.',
        durationMinutes: 5,
        createdByUserId: clinician.id,
      },
    });

    const found = await prisma.exercise.findUnique({ where: { id: exercise.id } });
    expect(found?.title).toBe('Diaphragmatic Breathing');
    expect(found?.status).toBe('ACTIVE');
  });
});
```

- [ ] **Step 5: Run test to verify it fails, then confirm it passes after migration**

Run: `npm run test:e2e`
Expected: if Step 2's migration hasn't been applied yet, this fails with a Prisma "table does not exist" error. After the migration is applied, run again.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add Prisma schema for Assessment, TreatmentPlan, and Exercise Library"
```

---

### Task 2: RBAC permission policy extension

**Files:**
- Modify: `backend/src/common/rbac/permissions.ts`
- Modify: `backend/src/common/rbac/permissions.spec.ts`

**Interfaces:**
- Consumes: `Permission` enum, `ROLE_PERMISSIONS` map, `hasPermission()` (Foundation Task 4).
- Produces: 7 new `Permission` values used by every controller in Tasks 3-10: `CREATE_EXERCISE`, `EDIT_EXERCISE`, `VIEW_EXERCISE`, `ARCHIVE_EXERCISE`, `CREATE_ASSESSMENT`, `EDIT_ASSESSMENT`, `APPROVE_ASSESSMENT`, `VIEW_ASSESSMENT`, `CREATE_TREATMENT_PLAN`, `EDIT_TREATMENT_PLAN`, `VIEW_TREATMENT_PLAN`.

- [ ] **Step 1: Write the failing tests — append to `src/common/rbac/permissions.spec.ts`**

```typescript
describe('hasPermission — clinical core', () => {
  it('allows a CLINICIAN to create an exercise', () => {
    expect(hasPermission('CLINICIAN', Permission.CREATE_EXERCISE)).toBe(true);
  });

  it('does not allow a PATIENT to create an exercise', () => {
    expect(hasPermission('PATIENT', Permission.CREATE_EXERCISE)).toBe(false);
  });

  it('allows a PATIENT to view an exercise', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_EXERCISE)).toBe(true);
  });

  it('allows a CLINICIAN to approve an assessment', () => {
    expect(hasPermission('CLINICIAN', Permission.APPROVE_ASSESSMENT)).toBe(true);
  });

  it('does not allow a CAREGIVER to approve an assessment', () => {
    expect(hasPermission('CAREGIVER', Permission.APPROVE_ASSESSMENT)).toBe(false);
  });

  it('allows a CAREGIVER to view a treatment plan (ownership enforced elsewhere)', () => {
    expect(hasPermission('CAREGIVER', Permission.VIEW_TREATMENT_PLAN)).toBe(true);
  });

  it('does not allow a SUPERVISOR to create a treatment plan', () => {
    expect(hasPermission('SUPERVISOR', Permission.CREATE_TREATMENT_PLAN)).toBe(false);
  });

  it('allows a SUPERVISOR to view a treatment plan', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_TREATMENT_PLAN)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- permissions`
Expected: FAIL — `Permission.CREATE_EXERCISE` etc. are `undefined`.

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
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PATIENT: [
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.VIEW_EXERCISE,
    Permission.VIEW_ASSESSMENT,
    Permission.VIEW_TREATMENT_PLAN,
  ],
  CAREGIVER: [
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.VIEW_EXERCISE,
    Permission.VIEW_ASSESSMENT,
    Permission.VIEW_TREATMENT_PLAN,
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
  ],
  SUPERVISOR: [
    Permission.VIEW_PATIENT_PROFILE,
    Permission.SEARCH_PATIENTS,
    Permission.VIEW_EXERCISE,
    Permission.VIEW_ASSESSMENT,
    Permission.VIEW_TREATMENT_PLAN,
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
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- permissions`
Expected: PASS — 13 tests passed (5 existing + 8 new).

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: extend RBAC policy for exercises, assessments, and treatment plans"
```

---

### Task 3: Exercises — create, list (filtered), get by id

**Files:**
- Create: `backend/src/modules/exercises/dto/create-exercise.dto.ts`
- Create: `backend/src/modules/exercises/exercises.service.ts`
- Create: `backend/src/modules/exercises/exercises.controller.ts`
- Create: `backend/src/modules/exercises/exercises.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/exercises.e2e-spec.ts` (extend the file created in Task 1)

**Interfaces:**
- Consumes: `PrismaService` (Task 1), `Permission`/`RequirePermission`/`PermissionsGuard` (Task 2), `SessionGuard`/`AuthenticatedUser`/`CurrentUser` (Foundation).
- Produces: `ExercisesService.create()`, `.findAll(phase?, category?)`, `.findById()` — consumed by Task 4 (update/archive) and Task 10 (plan-exercise linking, which calls `findById` to validate an exercise exists before linking).

- [ ] **Step 1: Create `src/modules/exercises/dto/create-exercise.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateExerciseSchema = z.object({
  title: z.string().min(1).max(150),
  category: z.string().min(1).max(50),
  phaseLevel: z.number().int().min(1).max(5),
  instructions: z.string().min(1),
  mediaUrl: z.url().optional(),
  durationMinutes: z.number().int().min(1),
});

export class CreateExerciseDto extends createZodDto(CreateExerciseSchema) {}
```

- [ ] **Step 2: Write the failing test — append to `test/exercises.e2e-spec.ts`** (new top-level `describe`, same file as Task 1's schema smoke test)

```typescript
describe('Exercises: create, list, get', () => {
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

  it('lets a CLINICIAN create an exercise', async () => {
    const token = await createClinicianToken('+966500000210', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Easy Onset Practice',
        category: 'Fluency Shaping',
        phaseLevel: 2,
        instructions: 'Start phonation gently, without tension.',
        durationMinutes: 10,
      });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe('Easy Onset Practice');
    expect(response.body.status).toBe('ACTIVE');
  });

  it('rejects a PATIENT trying to create an exercise', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile: '+966500000211',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000211', code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000211', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${loginResponse.body.token}`)
      .send({
        title: 'Should Not Be Created',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });

    expect(response.status).toBe(403);
  });

  it('filters exercises by phase', async () => {
    const token = await createClinicianToken('+966500000212', 'password123');

    await request(app.getHttpServer()).post('/api/v1/exercises').set('Authorization', `Bearer ${token}`).send({
      title: 'Phase 1 Exercise',
      category: 'Breathing',
      phaseLevel: 1,
      instructions: 'N/A',
      durationMinutes: 5,
    });
    await request(app.getHttpServer()).post('/api/v1/exercises').set('Authorization', `Bearer ${token}`).send({
      title: 'Phase 3 Exercise',
      category: 'Fluency Shaping',
      phaseLevel: 3,
      instructions: 'N/A',
      durationMinutes: 5,
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/exercises?phase=1')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].title).toBe('Phase 1 Exercise');
  });

  it('gets a single exercise by id', async () => {
    const token = await createClinicianToken('+966500000213', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Retrievable Exercise',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/exercises/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Retrievable Exercise');
  });

  it('returns 404 for a nonexistent exercise', async () => {
    const token = await createClinicianToken('+966500000214', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/exercises/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `/api/v1/exercises` routes don't exist yet (404 on all of them, including the ones asserting 201/200).

- [ ] **Step 4: Create `src/modules/exercises/exercises.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Exercise } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateExerciseDto, actor: AuthenticatedUser): Promise<Exercise> {
    return this.prisma.exercise.create({
      data: {
        title: dto.title,
        category: dto.category,
        phaseLevel: dto.phaseLevel,
        instructions: dto.instructions,
        mediaUrl: dto.mediaUrl,
        durationMinutes: dto.durationMinutes,
        createdByUserId: actor.id,
      },
    });
  }

  findAll(phase?: number, category?: string): Promise<Exercise[]> {
    return this.prisma.exercise.findMany({
      where: {
        status: 'ACTIVE',
        phaseLevel: phase,
        category: category ? { equals: category, mode: 'insensitive' } : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Exercise> {
    const exercise = await this.prisma.exercise.findUnique({ where: { id } });
    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }
    return exercise;
  }
}
```

- [ ] **Step 5: Create `src/modules/exercises/exercises.controller.ts`**

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/exercises')
@UseGuards(SessionGuard, PermissionsGuard)
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post()
  @RequirePermission(Permission.CREATE_EXERCISE)
  create(@Body() dto: CreateExerciseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.exercisesService.create(dto, user);
  }

  @Get()
  @RequirePermission(Permission.VIEW_EXERCISE)
  findAll(
    @Query('phase', new ParseIntPipe({ optional: true })) phase?: number,
    @Query('category') category?: string,
  ) {
    return this.exercisesService.findAll(phase, category);
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_EXERCISE)
  findOne(@Param('id') id: string) {
    return this.exercisesService.findById(id);
  }
}
```

- [ ] **Step 6: Create `src/modules/exercises/exercises.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ExercisesController],
  providers: [ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
```

- [ ] **Step 7: Modify `src/app.module.ts` to import `ExercisesModule`**

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

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, PatientsModule, ExercisesModule],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 5 new tests in `exercises.e2e-spec.ts`.

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat: add exercise creation, filtered listing, and retrieval"
```

---

### Task 4: Exercises — update and archive (in-use protection)

**Files:**
- Create: `backend/src/modules/exercises/dto/update-exercise.dto.ts`
- Create: `backend/src/modules/exercises/dto/update-exercise-status.dto.ts`
- Modify: `backend/src/modules/exercises/exercises.service.ts`
- Modify: `backend/src/modules/exercises/exercises.controller.ts`
- Test: `backend/test/exercises.e2e-spec.ts`

**Interfaces:**
- Consumes: `ExercisesService.findById()` (Task 3), `PrismaService`'s `planExercise`/`treatmentPlan` models (Task 1).
- Produces: `ExercisesService.update()`, `.updateStatus()` — the archive-blocking logic here is the only place in this plan that queries `PlanExercise` joined to `TreatmentPlan.status`, so get this exactly right; no other task re-implements it.

- [ ] **Step 1: Create `src/modules/exercises/dto/update-exercise.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateExerciseSchema = z.object({
  title: z.string().min(1).max(150).optional(),
  category: z.string().min(1).max(50).optional(),
  phaseLevel: z.number().int().min(1).max(5).optional(),
  instructions: z.string().min(1).optional(),
  mediaUrl: z.url().optional(),
  durationMinutes: z.number().int().min(1).optional(),
});

export class UpdateExerciseDto extends createZodDto(UpdateExerciseSchema) {}
```

- [ ] **Step 2: Create `src/modules/exercises/dto/update-exercise-status.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateExerciseStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED']),
});

export class UpdateExerciseStatusDto extends createZodDto(UpdateExerciseStatusSchema) {}
```

- [ ] **Step 3: Write the failing tests — append to the `'Exercises: create, list, get'` describe block in `test/exercises.e2e-spec.ts`**

```typescript
  it('lets a CLINICIAN update an exercise', async () => {
    const token = await createClinicianToken('+966500000215', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Original Title',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/exercises/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Title' });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Updated Title');
  });

  it('archives an exercise not referenced by any active plan', async () => {
    const token = await createClinicianToken('+966500000216', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Unused Exercise',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/exercises/${createResponse.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ARCHIVED');
  });

  it('rejects archiving an exercise referenced by an active plan', async () => {
    const token = await createClinicianToken('+966500000217', 'password123');
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Plan Patient',
      mobile: '+966500000218',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000218', code: patientRegister.body.devOtpCode });

    const patientProfileResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        userId: patientRegister.body.userId,
        fullName: 'Plan Patient',
        gender: 'MALE',
        dateOfBirth: '1990-01-01',
        nationalId: 'ARCHIVE-TEST-1',
      });

    const exerciseResponse = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'In-Use Exercise',
        category: 'Breathing',
        phaseLevel: 1,
        instructions: 'N/A',
        durationMinutes: 5,
      });

    const assessmentResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfileResponse.body.id}/assessments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'INITIAL' });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfileResponse.body.id}/assessments/${assessmentResponse.body.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ severityCategory: 'MILD' });

    const planResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfileResponse.body.id}/treatment-plans`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        assessmentId: assessmentResponse.body.id,
        goals: 'Reduce stuttering frequency',
        reviewDate: '2026-08-01',
      });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfileResponse.body.id}/treatment-plans/${planResponse.body.id}/exercises`)
      .set('Authorization', `Bearer ${token}`)
      .send({ exerciseId: exerciseResponse.body.id, frequencyPerWeek: 3, sequence: 1 });

    const archiveResponse = await request(app.getHttpServer())
      .patch(`/api/v1/exercises/${exerciseResponse.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' });

    expect(archiveResponse.status).toBe(400);
  });
```

Note: this last test exercises the full assessment → approve → plan → link chain built in Tasks 5-10. It's placed here (in Task 4) because it's the only test proving the archive-block logic, but it will not pass until Task 10 is done — that's expected and fine; TDD across tasks in this plan means later tasks turn earlier "future-dependent" tests green. Do not skip or remove this test; leave it and note in your report that it's expected to fail until Task 10 lands.

- [ ] **Step 4: Run the exercise-specific tests to verify the update/archive-of-unused-exercise tests fail**

Run: `npm run test:e2e -- exercises`
Expected: FAIL — `PUT /api/v1/exercises/:id` and `PATCH /api/v1/exercises/:id/status` don't exist yet (404). The archive-blocked-by-active-plan test will also fail, but for a different reason (missing routes from later tasks) — confirm the failure reason is "route not found," not an assertion mismatch, for that one.

- [ ] **Step 5: Add `update` and `updateStatus` to `src/modules/exercises/exercises.service.ts`**

Add these imports at the top (merge with the existing import lines):

```typescript
import { BadRequestException } from '@nestjs/common';
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import { UpdateExerciseStatusDto } from './dto/update-exercise-status.dto';
```

Add these methods to the `ExercisesService` class, after `findById`:

```typescript
  async update(id: string, dto: UpdateExerciseDto): Promise<Exercise> {
    await this.findById(id);
    return this.prisma.exercise.update({
      where: { id },
      data: {
        title: dto.title,
        category: dto.category,
        phaseLevel: dto.phaseLevel,
        instructions: dto.instructions,
        mediaUrl: dto.mediaUrl,
        durationMinutes: dto.durationMinutes,
      },
    });
  }

  async updateStatus(id: string, dto: UpdateExerciseStatusDto): Promise<Exercise> {
    await this.findById(id);

    if (dto.status === 'ARCHIVED') {
      const activeUsage = await this.prisma.planExercise.findFirst({
        where: { exerciseId: id, treatmentPlan: { status: 'ACTIVE' } },
      });
      if (activeUsage) {
        throw new BadRequestException('Cannot archive an exercise referenced by an active treatment plan');
      }
    }

    return this.prisma.exercise.update({
      where: { id },
      data: { status: dto.status },
    });
  }
```

- [ ] **Step 6: Add the two new routes to `src/modules/exercises/exercises.controller.ts`**

Add to imports (merge with existing `@nestjs/common` import line so it reads):

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
```

Add these imports:

```typescript
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import { UpdateExerciseStatusDto } from './dto/update-exercise-status.dto';
```

Add these two routes to the `ExercisesController` class, after `findOne`:

```typescript
  @Put(':id')
  @RequirePermission(Permission.EDIT_EXERCISE)
  update(@Param('id') id: string, @Body() dto: UpdateExerciseDto) {
    return this.exercisesService.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermission(Permission.ARCHIVE_EXERCISE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateExerciseStatusDto) {
    return this.exercisesService.updateStatus(id, dto);
  }
```

- [ ] **Step 7: Run test to verify update and simple-archive pass (the active-plan-block test still fails, expected)**

Run: `npm run test:e2e -- exercises`
Expected: the update test and the archive-of-unused-exercise test now PASS. The archive-blocked-by-active-plan test still FAILS with 404 on `/assessments` or `/treatment-plans` routes (not yet built) — confirm it's still failing for the same "route not found" reason, not a new error.

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: add exercise update and archive with active-plan protection"
```

---

### Task 5: Assessments — create (draft), list per patient, get by id (ownership enforced)

**Files:**
- Create: `backend/src/modules/assessments/dto/create-assessment.dto.ts`
- Create: `backend/src/modules/assessments/assessments.service.ts`
- Create: `backend/src/modules/assessments/assessments.controller.ts`
- Create: `backend/src/modules/assessments/assessments.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/assessments.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `Permission`/`RequirePermission`/`PermissionsGuard`, `SessionGuard`/`AuthenticatedUser`/`CurrentUser`.
- Produces: `AssessmentsService.create()`, `.findAllForPatient()`, `.findById()`, and the private `assertCanAccess()` ownership pattern (mirrors `PatientsService`) — consumed by Task 6 (update/approve) and Task 7 (baseline comparison), and referenced by Task 8 (treatment plan creation needs to look up an assessment's `status`).

- [ ] **Step 1: Create `src/modules/assessments/dto/create-assessment.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateAssessmentSchema = z.object({
  type: z.enum(['INITIAL', 'PERIODIC', 'FINAL']),
});

export class CreateAssessmentDto extends createZodDto(CreateAssessmentSchema) {}
```

- [ ] **Step 2: Write the failing tests — `test/assessments.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Assessments: create, list, get', () => {
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
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return { token: loginResponse.body.token, userId: registerResponse.body.userId };
  }

  async function createPatientProfile(clinicianToken: string, patientUserId: string, nationalId: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientUserId,
        fullName: 'Assessment Test Patient',
        gender: 'MALE',
        dateOfBirth: '1990-01-01',
        nationalId,
      });
    return response.body.id;
  }

  it('lets a CLINICIAN create a draft assessment for a patient', async () => {
    const clinicianToken = await createClinicianToken('+966500000300', 'password123');
    const patient = await registerActivateAndLogin('+966500000301', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-TEST-1');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    expect(response.status).toBe(201);
    expect(response.body.type).toBe('INITIAL');
    expect(response.body.status).toBe('DRAFT');
  });

  it('rejects a PATIENT trying to create an assessment', async () => {
    const clinicianToken = await createClinicianToken('+966500000302', 'password123');
    const patient = await registerActivateAndLogin('+966500000303', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-TEST-2');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ type: 'INITIAL' });

    expect(response.status).toBe(403);
  });

  it('lets the patient view their own assessments', async () => {
    const clinicianToken = await createClinicianToken('+966500000304', 'password123');
    const patient = await registerActivateAndLogin('+966500000305', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-TEST-3');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${patient.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('rejects a PATIENT viewing another patient\'s assessments', async () => {
    const clinicianToken = await createClinicianToken('+966500000306', 'password123');
    const patientA = await registerActivateAndLogin('+966500000307', 'password123', 'PATIENT');
    const patientB = await registerActivateAndLogin('+966500000308', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patientA.userId, 'ASM-TEST-4');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${patientB.token}`);

    expect(response.status).toBe(403);
  });

  it('gets a single assessment by id', async () => {
    const clinicianToken = await createClinicianToken('+966500000309', 'password123');
    const patient = await registerActivateAndLogin('+966500000310', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-TEST-5');
    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/assessments/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(createResponse.body.id);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e -- assessments`
Expected: FAIL — `/api/v1/patients/:patientId/assessments` routes don't exist yet.

- [ ] **Step 4: Create `src/modules/assessments/assessments.service.ts`**

```typescript
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Assessment, PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class AssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientProfileId: string, dto: CreateAssessmentDto, actor: AuthenticatedUser): Promise<Assessment> {
    await this.findPatientProfileOrThrow(patientProfileId);
    return this.prisma.assessment.create({
      data: {
        patientProfileId,
        clinicianUserId: actor.id,
        type: dto.type,
      },
    });
  }

  async findAllForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<Assessment[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    return this.prisma.assessment.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(patientProfileId: string, id: string, actor: AuthenticatedUser): Promise<Assessment> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    const assessment = await this.prisma.assessment.findUnique({ where: { id } });
    if (!assessment || assessment.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Assessment not found');
    }
    return assessment;
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }

  private async assertCanAccess(actor: AuthenticatedUser, profile: PatientProfile): Promise<void> {
    if (actor.role === Role.CLINICIAN || actor.role === Role.SUPERVISOR || actor.role === Role.ADMIN) {
      return;
    }
    if (actor.role === Role.PATIENT) {
      if (profile.userId === actor.id) {
        return;
      }
      throw new ForbiddenException("Cannot access another patient's assessments");
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

- [ ] **Step 5: Create `src/modules/assessments/assessments.controller.ts`**

```typescript
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/assessments')
@UseGuards(SessionGuard, PermissionsGuard)
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Post()
  @RequirePermission(Permission.CREATE_ASSESSMENT)
  create(@Param('patientId') patientId: string, @Body() dto: CreateAssessmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assessmentsService.create(patientId, dto, user);
  }

  @Get()
  @RequirePermission(Permission.VIEW_ASSESSMENT)
  findAll(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assessmentsService.findAllForPatient(patientId, user);
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_ASSESSMENT)
  findOne(@Param('patientId') patientId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assessmentsService.findById(patientId, id, user);
  }
}
```

- [ ] **Step 6: Create `src/modules/assessments/assessments.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
```

- [ ] **Step 7: Modify `src/app.module.ts` to import `AssessmentsModule`**

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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    ExercisesModule,
    AssessmentsModule,
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

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 6 new tests in `assessments.e2e-spec.ts`. (The Task 4 archive-blocked-by-active-plan test still fails — expected until Task 10.)

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat: add assessment creation, listing, and retrieval"
```

---

### Task 6: Assessments — update (while draft) and approve

**Files:**
- Create: `backend/src/modules/assessments/dto/update-assessment.dto.ts`
- Create: `backend/src/modules/assessments/dto/approve-assessment.dto.ts`
- Modify: `backend/src/modules/assessments/assessments.service.ts`
- Modify: `backend/src/modules/assessments/assessments.controller.ts`
- Test: `backend/test/assessments.e2e-spec.ts`

**Interfaces:**
- Consumes: `AssessmentsService.findById()`/`assertCanAccess()` (Task 5).
- Produces: `AssessmentsService.update()`, `.approve()` — Task 8 (treatment plan creation) depends on `Assessment.status === 'APPROVED'` being enforced here before a plan can reference it.

- [ ] **Step 1: Create `src/modules/assessments/dto/update-assessment.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateAssessmentSchema = z.object({
  medicalHistory: z.string().optional(),
  difficultSituations: z.string().optional(),
  anxietyLevel: z.string().optional(),
  initialGoals: z.string().optional(),
  clinicianNotes: z.string().optional(),
  ssi4Frequency: z.number().int().min(0).optional(),
  ssi4Duration: z.number().int().min(0).optional(),
  ssi4PhysicalConcomitants: z.number().int().min(0).optional(),
  ssi4Total: z.number().int().min(0).optional(),
});

export class UpdateAssessmentDto extends createZodDto(UpdateAssessmentSchema) {}
```

- [ ] **Step 2: Create `src/modules/assessments/dto/approve-assessment.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ApproveAssessmentSchema = z.object({
  severityCategory: z.enum(['MILD', 'MODERATE', 'SEVERE', 'VERY_SEVERE']),
});

export class ApproveAssessmentDto extends createZodDto(ApproveAssessmentSchema) {}
```

- [ ] **Step 3: Write the failing tests — append to `test/assessments.e2e-spec.ts`** (new top-level `describe`, same file, same helper functions redefined or reused if you hoist them — for a fresh subagent working task-by-task, redefine the helpers locally in the new `describe` block exactly as shown in Task 5's Step 2, to keep this task self-contained)

```typescript
describe('Assessments: update and approve', () => {
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

  async function setUpPatientWithDraftAssessment(clinicianToken: string, patientMobile: string, nationalId: string) {
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Draft Assessment Patient',
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
        fullName: 'Draft Assessment Patient',
        gender: 'FEMALE',
        dateOfBirth: '1995-01-01',
        nationalId,
      });
    const assessmentResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileResponse.body.id}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });
    return { profileId: profileResponse.body.id, assessmentId: assessmentResponse.body.id };
  }

  it('lets a CLINICIAN update a draft assessment with SSI-4 scores', async () => {
    const clinicianToken = await createClinicianToken('+966500000320', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithDraftAssessment(
      clinicianToken,
      '+966500000321',
      'ASM-UPD-1',
    );

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/assessments/${assessmentId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ ssi4Frequency: 12, ssi4Duration: 3, ssi4PhysicalConcomitants: 2, ssi4Total: 17 });

    expect(response.status).toBe(200);
    expect(response.body.ssi4Total).toBe(17);
  });

  it('approves a draft assessment with a clinician-assigned severity category', async () => {
    const clinicianToken = await createClinicianToken('+966500000322', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithDraftAssessment(
      clinicianToken,
      '+966500000323',
      'ASM-UPD-2',
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentId}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MODERATE' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('APPROVED');
    expect(response.body.severityCategory).toBe('MODERATE');
    expect(response.body.approvedAt).not.toBeNull();
  });

  it('rejects updating an already-approved assessment', async () => {
    const clinicianToken = await createClinicianToken('+966500000324', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithDraftAssessment(
      clinicianToken,
      '+966500000325',
      'ASM-UPD-3',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentId}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MILD' });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/assessments/${assessmentId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ clinicianNotes: 'Trying to edit after approval' });

    expect(response.status).toBe(400);
  });

  it('rejects a PATIENT trying to approve an assessment', async () => {
    const clinicianToken = await createClinicianToken('+966500000326', 'password123');
    const { profileId, assessmentId } = await setUpPatientWithDraftAssessment(
      clinicianToken,
      '+966500000327',
      'ASM-UPD-4',
    );
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000327', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${assessmentId}/approve`)
      .set('Authorization', `Bearer ${patientLogin.body.token}`)
      .send({ severityCategory: 'MILD' });

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:e2e -- assessments`
Expected: FAIL — `PUT /api/v1/patients/:patientId/assessments/:id` and `POST .../approve` don't exist yet.

- [ ] **Step 5: Add `update` and `approve` to `src/modules/assessments/assessments.service.ts`**

Add these imports (merge with the existing import lines so the top of the file reads):

```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Assessment, PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { ApproveAssessmentDto } from './dto/approve-assessment.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';
```

Add these methods to the `AssessmentsService` class, after `findById`:

```typescript
  async update(patientProfileId: string, id: string, dto: UpdateAssessmentDto): Promise<Assessment> {
    const assessment = await this.findOwnAssessmentOrThrow(patientProfileId, id);
    if (assessment.status !== 'DRAFT') {
      throw new BadRequestException('Only a DRAFT assessment can be edited');
    }
    return this.prisma.assessment.update({
      where: { id },
      data: {
        medicalHistory: dto.medicalHistory,
        difficultSituations: dto.difficultSituations,
        anxietyLevel: dto.anxietyLevel,
        initialGoals: dto.initialGoals,
        clinicianNotes: dto.clinicianNotes,
        ssi4Frequency: dto.ssi4Frequency,
        ssi4Duration: dto.ssi4Duration,
        ssi4PhysicalConcomitants: dto.ssi4PhysicalConcomitants,
        ssi4Total: dto.ssi4Total,
      },
    });
  }

  async approve(patientProfileId: string, id: string, dto: ApproveAssessmentDto): Promise<Assessment> {
    const assessment = await this.findOwnAssessmentOrThrow(patientProfileId, id);
    if (assessment.status !== 'DRAFT') {
      throw new BadRequestException('Assessment is already approved');
    }
    return this.prisma.assessment.update({
      where: { id },
      data: {
        status: 'APPROVED',
        severityCategory: dto.severityCategory,
        approvedAt: new Date(),
      },
    });
  }

  private async findOwnAssessmentOrThrow(patientProfileId: string, id: string): Promise<Assessment> {
    const assessment = await this.prisma.assessment.findUnique({ where: { id } });
    if (!assessment || assessment.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Assessment not found');
    }
    return assessment;
  }
```

- [ ] **Step 6: Add the two new routes to `src/modules/assessments/assessments.controller.ts`**

Add to imports (merge with the existing `@nestjs/common` import line):

```typescript
import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
```

Add these imports:

```typescript
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { ApproveAssessmentDto } from './dto/approve-assessment.dto';
```

Add these two routes to the `AssessmentsController` class, after `findOne`:

```typescript
  @Put(':id')
  @RequirePermission(Permission.EDIT_ASSESSMENT)
  update(@Param('patientId') patientId: string, @Param('id') id: string, @Body() dto: UpdateAssessmentDto) {
    return this.assessmentsService.update(patientId, id, dto);
  }

  @Post(':id/approve')
  @RequirePermission(Permission.APPROVE_ASSESSMENT)
  approve(@Param('patientId') patientId: string, @Param('id') id: string, @Body() dto: ApproveAssessmentDto) {
    return this.assessmentsService.approve(patientId, id, dto);
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 4 new tests. (The Task 4 archive-blocked-by-active-plan test still fails — expected until Task 10.)

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: add assessment update and approval"
```

---

### Task 7: Assessments — baseline comparison

**Files:**
- Modify: `backend/src/modules/assessments/assessments.service.ts`
- Modify: `backend/src/modules/assessments/assessments.controller.ts`
- Test: `backend/test/assessments.e2e-spec.ts`

**Interfaces:**
- Consumes: `AssessmentsService.findById()`/`assertCanAccess()` (Task 5), `Assessment.status`/`approvedAt` (Task 6).
- Produces: `AssessmentsService.getBaselineComparison()` — returns `{ current, baseline, delta }`, not consumed by any other task in this plan (this is the final piece of the Assessments module).

- [ ] **Step 1: Write the failing tests — append to the `'Assessments: create, list, get'` describe block in `test/assessments.e2e-spec.ts`**

```typescript
  it('compares a re-assessment against the baseline (first approved assessment)', async () => {
    const clinicianToken = await createClinicianToken('+966500000330', 'password123');
    const patient = await registerActivateAndLogin('+966500000331', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-BASE-1');

    const initialResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });
    await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/assessments/${initialResponse.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ ssi4Frequency: 15, ssi4Duration: 4, ssi4PhysicalConcomitants: 3, ssi4Total: 22 });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${initialResponse.body.id}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'SEVERE' });

    const periodicResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'PERIODIC' });
    await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}/assessments/${periodicResponse.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ ssi4Frequency: 9, ssi4Duration: 2, ssi4PhysicalConcomitants: 1, ssi4Total: 12 });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments/${periodicResponse.body.id}/approve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ severityCategory: 'MODERATE' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/assessments/${periodicResponse.body.id}/baseline-comparison`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body.baseline.id).toBe(initialResponse.body.id);
    expect(response.body.current.id).toBe(periodicResponse.body.id);
    expect(response.body.delta.ssi4TotalDelta).toBe(-10);
  });

  it('returns a null baseline when no approved assessment exists yet', async () => {
    const clinicianToken = await createClinicianToken('+966500000332', 'password123');
    const patient = await registerActivateAndLogin('+966500000333', 'password123', 'PATIENT');
    const profileId = await createPatientProfile(clinicianToken, patient.userId, 'ASM-BASE-2');
    const draftResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/assessments`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ type: 'INITIAL' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}/assessments/${draftResponse.body.id}/baseline-comparison`)
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body.baseline).toBeNull();
    expect(response.body.delta).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- assessments`
Expected: FAIL — `GET .../baseline-comparison` route doesn't exist yet.

- [ ] **Step 3: Add `getBaselineComparison` to `src/modules/assessments/assessments.service.ts`**

Add this method to the `AssessmentsService` class, after `approve`:

```typescript
  async getBaselineComparison(
    patientProfileId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{
    current: Assessment;
    baseline: Assessment | null;
    delta: { ssi4FrequencyDelta: number; ssi4DurationDelta: number; ssi4PhysicalConcomitantsDelta: number; ssi4TotalDelta: number } | null;
  }> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    const current = await this.findOwnAssessmentOrThrow(patientProfileId, id);

    const baseline = await this.prisma.assessment.findFirst({
      where: { patientProfileId, status: 'APPROVED' },
      orderBy: { approvedAt: 'asc' },
    });

    if (!baseline || baseline.ssi4Total === null || current.ssi4Total === null) {
      return { current, baseline, delta: null };
    }

    return {
      current,
      baseline,
      delta: {
        ssi4FrequencyDelta: (current.ssi4Frequency ?? 0) - (baseline.ssi4Frequency ?? 0),
        ssi4DurationDelta: (current.ssi4Duration ?? 0) - (baseline.ssi4Duration ?? 0),
        ssi4PhysicalConcomitantsDelta: (current.ssi4PhysicalConcomitants ?? 0) - (baseline.ssi4PhysicalConcomitants ?? 0),
        ssi4TotalDelta: current.ssi4Total - baseline.ssi4Total,
      },
    };
  }
```

- [ ] **Step 4: Add the new route to `src/modules/assessments/assessments.controller.ts`**

Add this route to the `AssessmentsController` class, after `findOne`:

```typescript
  @Get(':id/baseline-comparison')
  @RequirePermission(Permission.VIEW_ASSESSMENT)
  getBaselineComparison(
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assessmentsService.getBaselineComparison(patientId, id, user);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:e2e -- assessments`
Expected: PASS — all assessment tests pass, including the 2 new baseline-comparison tests.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add assessment baseline comparison"
```

---

### Task 8: Treatment Plans — create (requires approved assessment, single-active enforcement), list, get active

**Files:**
- Create: `backend/src/modules/treatment-plans/dto/create-treatment-plan.dto.ts`
- Create: `backend/src/modules/treatment-plans/treatment-plans.service.ts`
- Create: `backend/src/modules/treatment-plans/treatment-plans.controller.ts`
- Create: `backend/src/modules/treatment-plans/treatment-plans.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/treatment-plans.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `Permission`/`RequirePermission`/`PermissionsGuard`, `SessionGuard`/`AuthenticatedUser`/`CurrentUser`, `Assessment.status` (Task 6).
- Produces: `TreatmentPlansService.create()`, `.findAllForPatient()`, `.findActiveForPatient()`, `.findByIdOrThrow()` (a plain method on the class, not exposed via any route — throwing `NotFoundException` when the plan doesn't belong to the given patient — reused directly by Tasks 9 and 10), and `assertCanAccess()` (same ownership pattern as `AssessmentsService`).

- [ ] **Step 1: Create `src/modules/treatment-plans/dto/create-treatment-plan.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateTreatmentPlanSchema = z.object({
  assessmentId: z.uuid(),
  goals: z.string().min(1),
  reviewDate: z.iso.date(),
});

export class CreateTreatmentPlanDto extends createZodDto(CreateTreatmentPlanSchema) {}
```

- [ ] **Step 2: Write the failing tests — `test/treatment-plans.e2e-spec.ts`**

```typescript
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e -- treatment-plans`
Expected: FAIL — `/api/v1/patients/:patientId/treatment-plans` routes don't exist yet.

- [ ] **Step 4: Create `src/modules/treatment-plans/treatment-plans.service.ts`**

```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, Role, TreatmentPlan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTreatmentPlanDto } from './dto/create-treatment-plan.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class TreatmentPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientProfileId: string, dto: CreateTreatmentPlanDto, actor: AuthenticatedUser): Promise<TreatmentPlan> {
    await this.findPatientProfileOrThrow(patientProfileId);

    const assessment = await this.prisma.assessment.findUnique({ where: { id: dto.assessmentId } });
    if (!assessment || assessment.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Assessment not found for this patient');
    }
    if (assessment.status !== 'APPROVED') {
      throw new BadRequestException('Treatment plan requires an approved assessment');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.treatmentPlan.updateMany({
        where: { patientProfileId, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });

      return tx.treatmentPlan.create({
        data: {
          patientProfileId,
          clinicianUserId: actor.id,
          assessmentId: dto.assessmentId,
          goals: dto.goals,
          reviewDate: new Date(dto.reviewDate),
        },
      });
    });
  }

  async findAllForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<TreatmentPlan[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    return this.prisma.treatmentPlan.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<TreatmentPlan> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    const plan = await this.prisma.treatmentPlan.findFirst({
      where: { patientProfileId, status: 'ACTIVE' },
    });
    if (!plan) {
      throw new NotFoundException('No active treatment plan for this patient');
    }
    return plan;
  }

  async findByIdOrThrow(patientProfileId: string, id: string): Promise<TreatmentPlan> {
    const plan = await this.prisma.treatmentPlan.findUnique({ where: { id } });
    if (!plan || plan.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Treatment plan not found');
    }
    return plan;
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }

  private async assertCanAccess(actor: AuthenticatedUser, profile: PatientProfile): Promise<void> {
    if (actor.role === Role.CLINICIAN || actor.role === Role.SUPERVISOR || actor.role === Role.ADMIN) {
      return;
    }
    if (actor.role === Role.PATIENT) {
      if (profile.userId === actor.id) {
        return;
      }
      throw new ForbiddenException("Cannot access another patient's treatment plans");
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

- [ ] **Step 5: Create `src/modules/treatment-plans/treatment-plans.controller.ts`**

```typescript
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TreatmentPlansService } from './treatment-plans.service';
import { CreateTreatmentPlanDto } from './dto/create-treatment-plan.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/treatment-plans')
@UseGuards(SessionGuard, PermissionsGuard)
export class TreatmentPlansController {
  constructor(private readonly treatmentPlansService: TreatmentPlansService) {}

  @Post()
  @RequirePermission(Permission.CREATE_TREATMENT_PLAN)
  create(@Param('patientId') patientId: string, @Body() dto: CreateTreatmentPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.treatmentPlansService.create(patientId, dto, user);
  }

  @Get()
  @RequirePermission(Permission.VIEW_TREATMENT_PLAN)
  findAll(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.treatmentPlansService.findAllForPatient(patientId, user);
  }

  @Get('active')
  @RequirePermission(Permission.VIEW_TREATMENT_PLAN)
  findActive(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.treatmentPlansService.findActiveForPatient(patientId, user);
  }
}
```

Note: `@Get('active')` must be declared before any `@Get(':id')` route is added in a later task, so Nest's route matching doesn't treat `"active"` as an `:id` value. Task 9 adds no conflicting `:id` GET route, so this ordering is safe as written; if a future task adds `GET :id`, it must be declared after `'active'`.

- [ ] **Step 6: Create `src/modules/treatment-plans/treatment-plans.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TreatmentPlansController } from './treatment-plans.controller';
import { TreatmentPlansService } from './treatment-plans.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TreatmentPlansController],
  providers: [TreatmentPlansService],
  exports: [TreatmentPlansService],
})
export class TreatmentPlansModule {}
```

- [ ] **Step 7: Modify `src/app.module.ts` to import `TreatmentPlansModule`**

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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    ExercisesModule,
    AssessmentsModule,
    TreatmentPlansModule,
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

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 5 new tests in `treatment-plans.e2e-spec.ts`. (The Task 4 archive-blocked-by-active-plan test still fails — expected until Task 10.)

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat: add treatment plan creation with single-active enforcement"
```

---

### Task 9: Treatment Plans — update goals/review date, and clinician-recorded phase transitions

**Files:**
- Create: `backend/src/modules/treatment-plans/dto/update-treatment-plan.dto.ts`
- Create: `backend/src/modules/treatment-plans/dto/phase-transition.dto.ts`
- Modify: `backend/src/modules/treatment-plans/treatment-plans.service.ts`
- Modify: `backend/src/modules/treatment-plans/treatment-plans.controller.ts`
- Test: `backend/test/treatment-plans.e2e-spec.ts`

**Interfaces:**
- Consumes: `TreatmentPlansService.findByIdOrThrow()` (Task 8).
- Produces: `TreatmentPlansService.update()`, `.recordPhaseTransition()` — no later task depends on these directly, but `PhaseTransition` rows they create are visible for future reporting modules.

- [ ] **Step 1: Create `src/modules/treatment-plans/dto/update-treatment-plan.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateTreatmentPlanSchema = z.object({
  goals: z.string().min(1).optional(),
  reviewDate: z.iso.date().optional(),
});

export class UpdateTreatmentPlanDto extends createZodDto(UpdateTreatmentPlanSchema) {}
```

- [ ] **Step 2: Create `src/modules/treatment-plans/dto/phase-transition.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PhaseTransitionSchema = z.object({
  toPhase: z.enum(['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5']),
  rationale: z.string().optional(),
});

export class PhaseTransitionDto extends createZodDto(PhaseTransitionSchema) {}
```

- [ ] **Step 3: Write the failing tests — append to the `'Treatment Plans: create, list, get active'` describe block in `test/treatment-plans.e2e-spec.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:e2e -- treatment-plans`
Expected: FAIL — `PUT .../treatment-plans/:id` and `POST .../phase-transition` don't exist yet.

- [ ] **Step 5: Add `update` and `recordPhaseTransition` to `src/modules/treatment-plans/treatment-plans.service.ts`**

Add these imports (merge with the existing import lines):

```typescript
import { PatientProfile, PhaseTransition, Role, TreatmentPlan } from '@prisma/client';
import { UpdateTreatmentPlanDto } from './dto/update-treatment-plan.dto';
import { PhaseTransitionDto } from './dto/phase-transition.dto';
```

Add these methods to the `TreatmentPlansService` class, after `findByIdOrThrow`:

```typescript
  async update(patientProfileId: string, id: string, dto: UpdateTreatmentPlanDto): Promise<TreatmentPlan> {
    await this.findByIdOrThrow(patientProfileId, id);
    return this.prisma.treatmentPlan.update({
      where: { id },
      data: {
        goals: dto.goals,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : undefined,
      },
    });
  }

  async recordPhaseTransition(
    patientProfileId: string,
    id: string,
    dto: PhaseTransitionDto,
    actor: AuthenticatedUser,
  ): Promise<TreatmentPlan> {
    const plan = await this.findByIdOrThrow(patientProfileId, id);

    return this.prisma.$transaction(async (tx) => {
      await tx.phaseTransition.create({
        data: {
          treatmentPlanId: id,
          fromPhase: plan.phase,
          toPhase: dto.toPhase,
          clinicianUserId: actor.id,
          rationale: dto.rationale,
        },
      });

      return tx.treatmentPlan.update({
        where: { id },
        data: { phase: dto.toPhase },
      });
    });
  }
```

- [ ] **Step 6: Add the two new routes to `src/modules/treatment-plans/treatment-plans.controller.ts`**

Add to imports (merge with the existing `@nestjs/common` import line):

```typescript
import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
```

Add these imports:

```typescript
import { UpdateTreatmentPlanDto } from './dto/update-treatment-plan.dto';
import { PhaseTransitionDto } from './dto/phase-transition.dto';
```

Add these two routes to the `TreatmentPlansController` class, after `findActive`:

```typescript
  @Put(':id')
  @RequirePermission(Permission.EDIT_TREATMENT_PLAN)
  update(@Param('patientId') patientId: string, @Param('id') id: string, @Body() dto: UpdateTreatmentPlanDto) {
    return this.treatmentPlansService.update(patientId, id, dto);
  }

  @Post(':id/phase-transition')
  @RequirePermission(Permission.EDIT_TREATMENT_PLAN)
  recordPhaseTransition(
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @Body() dto: PhaseTransitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treatmentPlansService.recordPhaseTransition(patientId, id, dto, user);
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 3 new tests. (The Task 4 archive-blocked-by-active-plan test still fails — expected until Task 10.)

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: add treatment plan updates and phase transitions"
```

---

### Task 10: Treatment Plans — link/list/unlink exercises

**Files:**
- Create: `backend/src/modules/treatment-plans/dto/link-exercise.dto.ts`
- Modify: `backend/src/modules/treatment-plans/treatment-plans.service.ts`
- Modify: `backend/src/modules/treatment-plans/treatment-plans.controller.ts`
- Modify: `backend/src/modules/treatment-plans/treatment-plans.module.ts`
- Test: `backend/test/treatment-plans.e2e-spec.ts`
- Test: `backend/test/exercises.e2e-spec.ts` (no new test needed here — this task makes the existing "rejects archiving an exercise referenced by an active plan" test from Task 4 pass; do not modify that test file)

**Interfaces:**
- Consumes: `TreatmentPlansService.findByIdOrThrow()` (Task 8), `ExercisesService.findById()` (Task 3).
- Produces: `TreatmentPlansService.linkExercise()`, `.listExercises()`, `.unlinkExercise()`. This is the last task in the plan proper — Task 11 only adds Swagger tags and a final smoke test.

- [ ] **Step 1: Create `src/modules/treatment-plans/dto/link-exercise.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LinkExerciseSchema = z.object({
  exerciseId: z.uuid(),
  frequencyPerWeek: z.number().int().min(1).max(21),
  sequence: z.number().int().min(1),
});

export class LinkExerciseDto extends createZodDto(LinkExerciseSchema) {}
```

- [ ] **Step 2: Write the failing tests — append to the `'Treatment Plans: create, list, get active'` describe block in `test/treatment-plans.e2e-spec.ts`**

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e -- treatment-plans`
Expected: FAIL — `POST/GET/DELETE .../exercises` routes don't exist yet.

- [ ] **Step 4: Add `linkExercise`, `listExercises`, `unlinkExercise` to `src/modules/treatment-plans/treatment-plans.service.ts`**

Add these imports (merge with the existing import lines):

```typescript
import { ConflictException } from '@nestjs/common';
import { PlanExercise } from '@prisma/client';
import { LinkExerciseDto } from './dto/link-exercise.dto';
import { ExercisesService } from '../exercises/exercises.service';
```

Add `private readonly exercisesService: ExercisesService` to the constructor, so it reads:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly exercisesService: ExercisesService,
  ) {}
```

Add these methods to the `TreatmentPlansService` class, after `recordPhaseTransition`:

```typescript
  async linkExercise(patientProfileId: string, planId: string, dto: LinkExerciseDto): Promise<PlanExercise> {
    await this.findByIdOrThrow(patientProfileId, planId);
    await this.exercisesService.findById(dto.exerciseId);

    const existingLink = await this.prisma.planExercise.findUnique({
      where: { treatmentPlanId_exerciseId: { treatmentPlanId: planId, exerciseId: dto.exerciseId } },
    });
    if (existingLink) {
      throw new ConflictException('This exercise is already linked to this plan');
    }

    return this.prisma.planExercise.create({
      data: {
        treatmentPlanId: planId,
        exerciseId: dto.exerciseId,
        frequencyPerWeek: dto.frequencyPerWeek,
        sequence: dto.sequence,
      },
    });
  }

  async listExercises(patientProfileId: string, planId: string) {
    await this.findByIdOrThrow(patientProfileId, planId);
    return this.prisma.planExercise.findMany({
      where: { treatmentPlanId: planId },
      include: { exercise: true },
      orderBy: { sequence: 'asc' },
    });
  }

  async unlinkExercise(patientProfileId: string, planId: string, exerciseId: string): Promise<void> {
    await this.findByIdOrThrow(patientProfileId, planId);
    const link = await this.prisma.planExercise.findUnique({
      where: { treatmentPlanId_exerciseId: { treatmentPlanId: planId, exerciseId } },
    });
    if (!link) {
      throw new NotFoundException('This exercise is not linked to this plan');
    }
    await this.prisma.planExercise.delete({ where: { id: link.id } });
  }
```

Note: `findUnique` on the compound key uses Prisma's generated field name `treatmentPlanId_exerciseId` — this comes directly from the `@@unique([treatmentPlanId, exerciseId])` declared on `PlanExercise` in Task 1's schema. Also add `NotFoundException` to the existing `@nestjs/common` import line if it isn't already imported in this file (it is, from Task 8 — just confirm it's there).

- [ ] **Step 5: Add the three new routes to `src/modules/treatment-plans/treatment-plans.controller.ts`**

Add to imports (merge with the existing `@nestjs/common` import line):

```typescript
import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
```

Add this import:

```typescript
import { LinkExerciseDto } from './dto/link-exercise.dto';
```

Add these three routes to the `TreatmentPlansController` class, after `recordPhaseTransition`:

```typescript
  @Post(':id/exercises')
  @RequirePermission(Permission.EDIT_TREATMENT_PLAN)
  linkExercise(@Param('patientId') patientId: string, @Param('id') id: string, @Body() dto: LinkExerciseDto) {
    return this.treatmentPlansService.linkExercise(patientId, id, dto);
  }

  @Get(':id/exercises')
  @RequirePermission(Permission.VIEW_TREATMENT_PLAN)
  listExercises(@Param('patientId') patientId: string, @Param('id') id: string) {
    return this.treatmentPlansService.listExercises(patientId, id);
  }

  @Delete(':id/exercises/:exerciseId')
  @RequirePermission(Permission.EDIT_TREATMENT_PLAN)
  unlinkExercise(
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @Param('exerciseId') exerciseId: string,
  ) {
    return this.treatmentPlansService.unlinkExercise(patientId, id, exerciseId);
  }
```

- [ ] **Step 6: Modify `src/modules/treatment-plans/treatment-plans.module.ts` to import `ExercisesModule`**

```typescript
import { Module } from '@nestjs/common';
import { TreatmentPlansController } from './treatment-plans.controller';
import { TreatmentPlansService } from './treatment-plans.service';
import { AuthModule } from '../auth/auth.module';
import { ExercisesModule } from '../exercises/exercises.module';

@Module({
  imports: [AuthModule, ExercisesModule],
  controllers: [TreatmentPlansController],
  providers: [TreatmentPlansService],
  exports: [TreatmentPlansService],
})
export class TreatmentPlansModule {}
```

- [ ] **Step 7: Run the full test suite to verify everything passes, including the Task 4 test that depended on this task**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 4 new tests in `treatment-plans.e2e-spec.ts` **and** the previously-failing "rejects archiving an exercise referenced by an active plan" test in `exercises.e2e-spec.ts` from Task 4. Confirm this specific test now passes — if it doesn't, something in the linking chain (assessment approve → plan create → exercise link) is broken.

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: add treatment plan exercise linking"
```

---

### Task 11: Swagger description update and full clinical-core smoke test

**Files:**
- Modify: `backend/src/main.ts`
- Test: `backend/test/clinical-core-smoke.e2e-spec.ts`

**Interfaces:**
- Consumes: every service built in Tasks 1-10.
- Produces: nothing further — this is the final task of the plan.

- [ ] **Step 1: Update the Swagger description in `src/main.ts`**

Change the `.setDescription(...)` line in the `DocumentBuilder` config from:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile modules')
```

to:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, and Exercise Library modules')
```

Leave every other line in `main.ts` untouched.

- [ ] **Step 2: Write the smoke test — `test/clinical-core-smoke.e2e-spec.ts`**

```typescript
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
Expected: `{"status":"ok"}`, then `200`. Stop the dev server (Ctrl+C / kill the process) before continuing.

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: update Swagger description and add full clinical-core smoke test"
```

---
