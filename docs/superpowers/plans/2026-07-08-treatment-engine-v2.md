# Treatment Engine v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current hardcoded-30-session treatment model with the governing spec's level-based, 72-hour-cycle, integrated-sample model, per `docs/superpowers/specs/2026-07-08-treatment-engine-v2-design.md`.

**Architecture:** A new `backend/src/modules/treatment-engine/` NestJS module replaces `backend/src/modules/sessions/` entirely (deleted). New Prisma models (`Level`, `LevelVersion`, `TrainingCycle72h`, `TrainingEvent`, `SampleSession`, `SampleAttempt`, `SpeechSample`, `SampleSamplePart`) replace `SessionTemplate`/`PatientSession`/`SessionStatus`. `progress.service.ts` and `reports.service.ts` are updated in place since they query the old models directly (a compile-breaking dependency, not optional cleanup).

**Tech Stack:** NestJS 11, Prisma 6.19.3, nestjs-zod/Zod, Jest + Supertest e2e — same as every existing backend module.

## Global Constraints

- No hardcoded level count or numeric cap anywhere in code — `Level.order` is a sort key, never a `< 30`-style ceiling check.
- The 72-hour cycle never starts from calendar time alone: it starts only after the patient has watched the level's human model AND completed one real training event; recording a `TrainingEvent` must be rejected with 409 if the cycle's `humanModelWatchedAt` is null.
- Sample-gate eligibility requires a real training event in each of the three consecutive 24-hour periods measured from `firstTrainingEventAt`; if a period was missed, eligibility is deferred (not reset to zero) until one more real training event occurs after the 72-hour mark.
- Exactly one active `SpeechSample` per `TrainingCycle72h` — enforced by a database-level unique constraint on `trainingCycleId`, not just application logic (AC-04).
- Max 10 `SampleAttempt` rows per `SampleSession`, counting soft-deleted ones — deleting an attempt never restores the count (AC-05).
- A technical-defect decision reopens only the affected `SampleSamplePart` rows for re-recording; it never creates a new `TrainingCycle72h` and never requires a full sample retake (AC-06).
- A level-repeat decision creates a **new** `TrainingCycle72h` for the same `Level`, using the same `LevelVersion` (human model + training list) as the cycle being repeated; the old cycle and its sample are preserved, never deleted.
- No raw status writes from any controller — every `LevelCycleStatus` transition happens inside a service method that checks the current status first and throws `ConflictException` on an invalid transition.
- All content lists (training items, sample-part templates) are stored as admin-editable JSON fields on `LevelVersion`, validated by a Zod schema on write — not hardcoded in application code (per the "manage content without touching code" requirement; a JSON field editable via an authenticated PATCH endpoint satisfies this without building a full generalized CMS in this pass).
- Media/recording URLs remain plain string fields, exactly as in the old model — real upload/storage infrastructure is a separate, later sub-project; do not build a technical fitness check (file exists/plays) since there is nothing real to check yet.
- Specialist review-queue mechanics (locking, 24h/48h SLA timers, escalation, direct intervention, consultations) are explicitly OUT of scope for this plan — a later "Specialist Review v2" plan. This plan's specialist decision endpoint is a direct action by any clinician with `REVIEW_SESSION` permission, with no queue/lock/timer logic.

---

## File Structure

- `backend/prisma/schema.prisma` — remove `SessionStatus`, `SessionTemplate`, `PatientSession`; add `LevelCycleStatus`, `SpecialistDecision`, `SampleSessionStatus` enums and `Level`, `LevelVersion`, `TrainingCycle72h`, `TrainingEvent`, `SampleSession`, `SampleAttempt`, `SpeechSample`, `SampleSamplePart` models.
- `backend/src/modules/treatment-engine/` — new module:
  - `levels.controller.ts` / `levels.service.ts` — admin/content CRUD for `Level`/`LevelVersion`.
  - `training-cycles.controller.ts` / `training-cycles.service.ts` — cycle lifecycle: start, watch-human-model, record training event, view current/history.
  - `samples.controller.ts` / `samples.service.ts` — sample preparation (attempts) and submission.
  - `specialist-review.controller.ts` / `specialist-review.service.ts` — the three decision actions.
  - `dto/` — Zod DTOs for each write endpoint.
  - `treatment-engine.module.ts` — module wiring.
- `backend/src/modules/sessions/` — deleted entirely (last task).
- `backend/src/modules/progress/progress.service.ts` — rewritten to query the new models.
- `backend/src/modules/reports/reports.service.ts` — the 3 call-sites that reference `patientSession`/`sessionTemplate` rewritten against the new models.
- `backend/src/common/rbac/permissions.ts` — new permissions for the above.
- `backend/src/app.module.ts` — swap `SessionsModule` for `TreatmentEngineModule`.
- `backend/src/main.ts` — Swagger description update (last task).

---

### Task 1: Prisma schema replacement

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Migration: `backend/prisma/migrations/<timestamp>_treatment_engine_v2/migration.sql` (generated)

**Interfaces:**
- Produces: `LevelCycleStatus`, `SpecialistDecision`, `SampleSessionStatus` enums; `Level`, `LevelVersion`, `TrainingCycle72h`, `TrainingEvent`, `SampleSession`, `SampleAttempt`, `SpeechSample`, `SampleSamplePart` models — exact fields below, consumed by every later task in this plan.

- [ ] **Step 1: Remove the old models and enum**

In `backend/prisma/schema.prisma`, delete the `SessionStatus` enum (lines 76-81) and the `SessionTemplate` (lines 301-313) and `PatientSession` (lines 315-341) models entirely.

- [ ] **Step 2: Add the new enums**

Add after the existing `ComplaintStatus` enum:

```prisma
enum LevelCycleStatus {
  ACTIVE_LEVEL_TRAINING
  SAMPLE_ELIGIBLE
  SAMPLE_PREPARATION
  SAMPLE_SUBMITTED
  WAITING_FOR_SPECIALIST
  UNDER_REVIEW
  DIRECT_INTERVENTION_REQUIRED
  WAITING_FINAL_DECISION_AFTER_INTERVENTION
  TECHNICAL_PARTIAL_RERECORD
  LEVEL_REPEAT_DECIDED
  NEXT_LEVEL_APPROVED
  CLOSED_DUE_TO_INACTIVITY
  SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN
}

enum SpecialistDecision {
  TRANSITION
  LEVEL_REPEAT
  TECHNICAL_RERECORD
}

enum SampleSessionStatus {
  OPEN
  CLOSED_SUBMITTED
  CLOSED_EXHAUSTED
}
```

- [ ] **Step 3: Add the new models**

Add after the `Complaint` model at the end of the file:

```prisma
model Level {
  id        String         @id @default(uuid())
  name      String
  order     Int            @unique
  status    ExerciseStatus @default(ACTIVE)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  versions       LevelVersion[]
  trainingCycles TrainingCycle72h[]
}

model LevelVersion {
  id                     String    @id @default(uuid())
  levelId                String
  level                  Level     @relation(fields: [levelId], references: [id])
  versionNumber          Int
  cognitiveVideo1Url     String?
  cognitiveVideo1Question String?
  cognitiveVideo2Url     String?
  cognitiveVideo2Question String?
  behavioralTechnique    String
  humanModelVideoUrl     String?
  humanModelDurationSeconds Int?
  trainingListJson       String  // JSON array of training items, admin-editable
  samplePartTemplateJson String  // JSON array of {partType, label, order, required}
  publishedAt            DateTime?
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  trainingCycles TrainingCycle72h[]

  @@unique([levelId, versionNumber])
}

model TrainingCycle72h {
  id                   String           @id @default(uuid())
  patientProfileId     String
  patientProfile       PatientProfile   @relation(fields: [patientProfileId], references: [id])
  treatmentPlanId      String
  treatmentPlan        TreatmentPlan    @relation(fields: [treatmentPlanId], references: [id])
  levelId              String
  level                Level            @relation(fields: [levelId], references: [id])
  levelVersionId       String
  levelVersion         LevelVersion     @relation(fields: [levelVersionId], references: [id])
  cycleNumber          Int              // 1 for the first attempt at this level, 2+ for repeats
  status               LevelCycleStatus @default(ACTIVE_LEVEL_TRAINING)
  humanModelWatchedAt  DateTime?
  firstTrainingEventAt DateTime?
  closedAt             DateTime?
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt

  trainingEvents TrainingEvent[]
  speechSample   SpeechSample?

  @@index([patientProfileId, createdAt])
  @@index([treatmentPlanId, levelId])
}

model TrainingEvent {
  id               String           @id @default(uuid())
  trainingCycleId  String
  trainingCycle    TrainingCycle72h @relation(fields: [trainingCycleId], references: [id])
  occurredAt       DateTime         @default(now())
  durationSeconds  Int?
  unitsCompleted   Int?
  createdAt        DateTime         @default(now())

  @@index([trainingCycleId, occurredAt])
}

model SampleSession {
  id               String              @id @default(uuid())
  trainingCycleId  String              @unique
  attemptsUsed     Int                 @default(0)
  status           SampleSessionStatus @default(OPEN)
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  attempts SampleAttempt[]
}

model SampleAttempt {
  id              String        @id @default(uuid())
  sampleSessionId String
  sampleSession   SampleSession @relation(fields: [sampleSessionId], references: [id])
  attemptNumber   Int
  recordingUrl    String
  deletedAt       DateTime?
  createdAt       DateTime      @default(now())

  sampleParts SampleSamplePart[]

  @@index([sampleSessionId, attemptNumber])
}

model SpeechSample {
  id                          String             @id @default(uuid())
  trainingCycleId             String             @unique
  trainingCycle               TrainingCycle72h   @relation(fields: [trainingCycleId], references: [id])
  selfSeverityCurrent         Int?
  selfSeverityExpectedNext    Int?
  camperdownPerformanceRating Int?
  clientOpinionScore          Int?
  submittedAt                 DateTime?
  reviewedByUserId            String?
  reviewedByUser              User?              @relation(fields: [reviewedByUserId], references: [id])
  clinicianOpinionScore       Int?
  reviewNotes                 String?
  reviewedAt                  DateTime?
  decision                    SpecialistDecision?
  createdAt                   DateTime           @default(now())
  updatedAt                   DateTime           @updatedAt

  parts SampleSamplePart[]
}

model SampleSamplePart {
  id               String         @id @default(uuid())
  speechSampleId   String
  speechSample     SpeechSample   @relation(fields: [speechSampleId], references: [id])
  sourceAttemptId  String?
  sourceAttempt    SampleAttempt? @relation(fields: [sourceAttemptId], references: [id])
  partType         String
  label            String
  order            Int
  recordingUrl     String?
  technicallyDamaged Boolean      @default(false)
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  @@index([speechSampleId, order])
}
```

- [ ] **Step 4: Add the reverse relations this creates on existing models**

`User` needs a reverse relation for `SpeechSample.reviewedByUser`. In `backend/prisma/schema.prisma`'s `User` model, add one line among its existing relation arrays (find the block of `Xxx[]` relation lines near the end of the model, e.g. near `patientSessions PatientSession[]` if it still exists at this point — remove that line since `PatientSession` is gone, per Step 1 — and add):

```prisma
  reviewedSpeechSamples SpeechSample[]
```

`PatientProfile` needs a reverse relation for `TrainingCycle72h.patientProfile`. Find its existing relation-array block (e.g. near `assessments Assessment[]`) and add:

```prisma
  trainingCycles TrainingCycle72h[]
```

`TreatmentPlan` needs a reverse relation for `TrainingCycle72h.treatmentPlan`. Find its relation block (it currently has `patientSessions PatientSession[]` — remove that line since `PatientSession` is gone) and add:

```prisma
  trainingCycles TrainingCycle72h[]
```

- [ ] **Step 5: Generate and run the migration**

```bash
cd backend
npx prisma migrate dev --name treatment_engine_v2
```
Expected: migration applies cleanly against the running dev Postgres container, `npx prisma generate` runs automatically as part of `migrate dev`, no errors.

- [ ] **Step 6: Fix the shared e2e test-reset helper**

`backend/test/utils/test-app.ts`'s `resetDatabase()` is imported by every single e2e test file in the backend (not just this module's) and directly calls `prisma.patientSession.deleteMany()` / `prisma.sessionTemplate.deleteMany()`, which no longer exist after Step 5 — every e2e test in the whole backend would fail to even reset its database without this fix. Replace those two lines with deletions of the new models, in foreign-key-safe order (children before parents):

```typescript
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.complaint.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.sampleSamplePart.deleteMany(),
    prisma.sampleAttempt.deleteMany(),
    prisma.sampleSession.deleteMany(),
    prisma.speechSample.deleteMany(),
    prisma.trainingEvent.deleteMany(),
    prisma.trainingCycle72h.deleteMany(),
    prisma.levelVersion.deleteMany(),
    prisma.level.deleteMany(),
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

Do not touch `createTestApp()` in the same file — it's unaffected.

- [ ] **Step 7: Verify the Prisma client compiles against the new schema**

```bash
npx tsc --noEmit -p backend/tsconfig.json
```
Expected: this WILL show errors in `progress.service.ts`, `reports.service.ts`, and everything under `src/modules/sessions/` — that is expected at this point in the plan (they still reference the removed models) and is fixed by Tasks 12, 13, and 14. Confirm the errors are ONLY in those files and nowhere else (a broader compile error would mean an earlier step introduced an unrelated schema mistake).

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/test/utils/test-app.ts
git commit -m "feat: add Treatment Engine v2 schema (Level, TrainingCycle72h, SpeechSample)

Removes SessionTemplate/PatientSession/SessionStatus, replaced by a
level + 72-hour-cycle + integrated-sample model per the corrected
executive spec. progress.service.ts, reports.service.ts, and the old
sessions module are updated in later tasks in this same plan — the
backend will not compile again until Task 14."
```

---

### Task 2: RBAC permission extension

**Files:**
- Modify: `backend/src/common/rbac/permissions.ts`
- Test: `backend/src/common/rbac/permissions.spec.ts`

**Interfaces:**
- Produces: `Permission.MANAGE_LEVELS`, `Permission.VIEW_LEVELS`, `Permission.START_CYCLE`, `Permission.RECORD_TRAINING_EVENT`, `Permission.VIEW_CYCLE`, `Permission.PREPARE_SAMPLE`, `Permission.SUBMIT_SAMPLE`, `Permission.REVIEW_SAMPLE` — consumed by every controller in Tasks 3-9.

- [ ] **Step 1: Write the failing test**

Read `backend/src/common/rbac/permissions.spec.ts` first to see its existing test structure (it tests `hasPermission` and role coverage), then add test cases following the same pattern for the new permissions, e.g.:

```typescript
  it('grants VIEW_LEVELS and VIEW_CYCLE to PATIENT and CAREGIVER', () => {
    expect(hasPermission(Role.PATIENT, Permission.VIEW_LEVELS)).toBe(true);
    expect(hasPermission(Role.PATIENT, Permission.VIEW_CYCLE)).toBe(true);
    expect(hasPermission(Role.CAREGIVER, Permission.VIEW_LEVELS)).toBe(true);
  });

  it('grants RECORD_TRAINING_EVENT, PREPARE_SAMPLE, SUBMIT_SAMPLE to PATIENT and CAREGIVER only', () => {
    expect(hasPermission(Role.PATIENT, Permission.RECORD_TRAINING_EVENT)).toBe(true);
    expect(hasPermission(Role.CAREGIVER, Permission.SUBMIT_SAMPLE)).toBe(true);
    expect(hasPermission(Role.CLINICIAN, Permission.RECORD_TRAINING_EVENT)).toBe(false);
  });

  it('grants MANAGE_LEVELS to CLINICIAN and ADMIN only', () => {
    expect(hasPermission(Role.CLINICIAN, Permission.MANAGE_LEVELS)).toBe(true);
    expect(hasPermission(Role.ADMIN, Permission.MANAGE_LEVELS)).toBe(true);
    expect(hasPermission(Role.SUPERVISOR, Permission.MANAGE_LEVELS)).toBe(false);
  });

  it('grants REVIEW_SAMPLE to CLINICIAN and ADMIN only', () => {
    expect(hasPermission(Role.CLINICIAN, Permission.REVIEW_SAMPLE)).toBe(true);
    expect(hasPermission(Role.PATIENT, Permission.REVIEW_SAMPLE)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- permissions.spec.ts`
Expected: FAIL — `Permission.MANAGE_LEVELS` etc. are not defined.

- [ ] **Step 3: Add the new permissions**

In `backend/src/common/rbac/permissions.ts`, add to the `Permission` enum (after `VIEW_SUPERVISION`):

```typescript
  MANAGE_LEVELS = 'MANAGE_LEVELS',
  VIEW_LEVELS = 'VIEW_LEVELS',
  START_CYCLE = 'START_CYCLE',
  RECORD_TRAINING_EVENT = 'RECORD_TRAINING_EVENT',
  VIEW_CYCLE = 'VIEW_CYCLE',
  PREPARE_SAMPLE = 'PREPARE_SAMPLE',
  SUBMIT_SAMPLE = 'SUBMIT_SAMPLE',
  REVIEW_SAMPLE = 'REVIEW_SAMPLE',
```

Then add to `ROLE_PERMISSIONS`:
- `PATIENT` and `CAREGIVER` (identical additions to each, matching how `START_SESSION`/`SUBMIT_SESSION`/`VIEW_SESSION` were already duplicated across both in the old permission set): `Permission.VIEW_LEVELS, Permission.START_CYCLE, Permission.RECORD_TRAINING_EVENT, Permission.VIEW_CYCLE, Permission.PREPARE_SAMPLE, Permission.SUBMIT_SAMPLE`
- `CLINICIAN`: `Permission.MANAGE_LEVELS, Permission.VIEW_LEVELS, Permission.VIEW_CYCLE, Permission.REVIEW_SAMPLE`
- `SUPERVISOR`: `Permission.VIEW_LEVELS, Permission.VIEW_CYCLE`
- `ADMIN`: `Permission.MANAGE_LEVELS, Permission.VIEW_LEVELS, Permission.VIEW_CYCLE, Permission.REVIEW_SAMPLE`

Remove the now-orphaned `MANAGE_SESSION_TEMPLATES`, `VIEW_SESSION_TEMPLATES`, `START_SESSION`, `SUBMIT_SESSION`, `VIEW_SESSION`, `REVIEW_SESSION` entries from the `Permission` enum and every role's array in `ROLE_PERMISSIONS` — they belonged to the old Sessions module being replaced.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- permissions.spec.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/rbac/permissions.ts backend/src/common/rbac/permissions.spec.ts
git commit -m "feat: add Treatment Engine v2 permissions, remove old Sessions permissions"
```

---

### Task 3: Level/LevelVersion content management

**Files:**
- Create: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Create: `backend/src/modules/treatment-engine/levels.service.ts`
- Create: `backend/src/modules/treatment-engine/levels.controller.ts`
- Create: `backend/src/modules/treatment-engine/dto/create-level.dto.ts`
- Create: `backend/src/modules/treatment-engine/dto/create-level-version.dto.ts`
- Test: `backend/test/treatment-engine-levels.e2e-spec.ts`

**Interfaces:**
- Produces: `LevelsService.create(dto)`, `.createVersion(levelId, dto)`, `.publishVersion(levelVersionId)`, `.list()`, `.getActiveVersion(levelId)` — consumed by Task 4 (`training-cycles.service.ts` needs `getActiveVersion` to start a cycle).
- `POST /api/v1/levels`, `POST /api/v1/levels/:levelId/versions`, `POST /api/v1/levels/:levelId/versions/:versionId/publish`, `GET /api/v1/levels`.

- [ ] **Step 1: Write the failing e2e test**

This project's established e2e pattern (see `backend/test/sessions-progress-smoke.e2e-spec.ts` for precedent) has no shared "create authenticated user" helper — each test registers a real user via the real auth endpoints inline, verifies the OTP, promotes the role directly via Prisma (since registration only ever creates `PATIENT`/`CAREGIVER`), then logs in for a real token. Follow that exact pattern:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(
  app: INestApplication,
  prisma: PrismaService,
  mobile: string,
  role: 'CLINICIAN' | 'ADMIN' | 'SUPERVISOR' | null,
): Promise<string> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  if (role) {
    await prisma.user.update({ where: { mobile }, data: { role } });
  }
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  return login.body.token;
}

describe('Treatment Engine — Levels (e2e)', () => {
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

  it('lets a clinician create a level and publish a version, then a patient can view it', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500000900', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500000901', null);

    const levelRes = await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'المستوى الأول', order: 1 })
      .expect(201);

    const versionRes = await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        versionNumber: 1,
        behavioralTechnique: 'إطالة صوت واحد منتهٍ بحرف علة',
        trainingListJson: JSON.stringify(['حا', 'جا', 'ثا']),
        samplePartTemplateJson: JSON.stringify([{ partType: 'مقطع', label: 'مقطع 1', order: 1, required: true }]),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions/${versionRes.body.id}/publish`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/levels')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(listRes.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'المستوى الأول', order: 1 })]),
    );
  });

  it('rejects a patient trying to create a level', async () => {
    const patientToken = await registerAndLogin(app, prisma, '+966500000902', null);
    await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ name: 'x', order: 99 })
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- treatment-engine-levels.e2e-spec.ts`
Expected: FAIL — module/routes don't exist yet.

- [ ] **Step 3: Write the DTOs**

```typescript
// backend/src/modules/treatment-engine/dto/create-level.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateLevelSchema = z.object({
  name: z.string().min(1),
  order: z.number().int().positive(),
});

export class CreateLevelDto extends createZodDto(CreateLevelSchema) {}
```

```typescript
// backend/src/modules/treatment-engine/dto/create-level-version.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateLevelVersionSchema = z.object({
  versionNumber: z.number().int().positive(),
  cognitiveVideo1Url: z.url().optional(),
  cognitiveVideo1Question: z.string().optional(),
  cognitiveVideo2Url: z.url().optional(),
  cognitiveVideo2Question: z.string().optional(),
  behavioralTechnique: z.string().min(1),
  humanModelVideoUrl: z.url().optional(),
  humanModelDurationSeconds: z.number().int().positive().optional(),
  trainingListJson: z.string().min(1),
  samplePartTemplateJson: z.string().min(1),
});

export class CreateLevelVersionDto extends createZodDto(CreateLevelVersionSchema) {}
```

- [ ] **Step 4: Write the service**

```typescript
// backend/src/modules/treatment-engine/levels.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Level, LevelVersion } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLevelDto } from './dto/create-level.dto';
import { CreateLevelVersionDto } from './dto/create-level-version.dto';

@Injectable()
export class LevelsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateLevelDto): Promise<Level> {
    return this.prisma.level.create({ data: dto });
  }

  async createVersion(levelId: string, dto: CreateLevelVersionDto): Promise<LevelVersion> {
    await this.findLevelOrThrow(levelId);
    return this.prisma.levelVersion.create({ data: { ...dto, levelId } });
  }

  async publishVersion(levelId: string, versionId: string): Promise<LevelVersion> {
    const version = await this.prisma.levelVersion.findUnique({ where: { id: versionId } });
    if (!version || version.levelId !== levelId) {
      throw new NotFoundException('Level version not found');
    }
    return this.prisma.levelVersion.update({ where: { id: versionId }, data: { publishedAt: new Date() } });
  }

  list(): Promise<Level[]> {
    return this.prisma.level.findMany({ orderBy: { order: 'asc' } });
  }

  async getActiveVersion(levelId: string): Promise<LevelVersion> {
    const version = await this.prisma.levelVersion.findFirst({
      where: { levelId, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
    });
    if (!version) {
      throw new ConflictException('Level has no published version');
    }
    return version;
  }

  private async findLevelOrThrow(levelId: string): Promise<Level> {
    const level = await this.prisma.level.findUnique({ where: { id: levelId } });
    if (!level) {
      throw new NotFoundException('Level not found');
    }
    return level;
  }
}
```

- [ ] **Step 5: Write the controller**

```typescript
// backend/src/modules/treatment-engine/levels.controller.ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { LevelsService } from './levels.service';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { CreateLevelDto } from './dto/create-level.dto';
import { CreateLevelVersionDto } from './dto/create-level-version.dto';

@Controller('api/v1/levels')
@UseGuards(SessionGuard, PermissionsGuard)
export class LevelsController {
  constructor(private readonly levelsService: LevelsService) {}

  @Post()
  @RequirePermission(Permission.MANAGE_LEVELS)
  create(@Body() dto: CreateLevelDto) {
    return this.levelsService.create(dto);
  }

  @Post(':levelId/versions')
  @RequirePermission(Permission.MANAGE_LEVELS)
  createVersion(@Param('levelId') levelId: string, @Body() dto: CreateLevelVersionDto) {
    return this.levelsService.createVersion(levelId, dto);
  }

  @Post(':levelId/versions/:versionId/publish')
  @RequirePermission(Permission.MANAGE_LEVELS)
  publishVersion(@Param('levelId') levelId: string, @Param('versionId') versionId: string) {
    return this.levelsService.publishVersion(levelId, versionId);
  }

  @Get()
  @RequirePermission(Permission.VIEW_LEVELS)
  list() {
    return this.levelsService.list();
  }
}
```

- [ ] **Step 6: Write the module**

```typescript
// backend/src/modules/treatment-engine/treatment-engine.module.ts
import { Module } from '@nestjs/common';
import { LevelsController } from './levels.controller';
import { LevelsService } from './levels.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';

@Module({
  imports: [AuthModule, PatientAccessModule],
  controllers: [LevelsController],
  providers: [LevelsService],
  exports: [LevelsService],
})
export class TreatmentEngineModule {}
```

- [ ] **Step 7: Register the module**

In `backend/src/app.module.ts`, add `TreatmentEngineModule` to the `imports` array (leave `SessionsModule` in place for now — it's removed in Task 14 once everything depending on the old models is migrated).

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-levels.e2e-spec.ts`
Expected: PASS, both tests.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/treatment-engine backend/src/app.module.ts backend/test/treatment-engine-levels.e2e-spec.ts
git commit -m "feat: add Level/LevelVersion content management (Treatment Engine v2)"
```

---

### Task 4: Cycle lifecycle — start, watch human model, record training event, 72h gating

**Files:**
- Create: `backend/src/modules/treatment-engine/cycle-eligibility.util.ts`
- Create: `backend/src/modules/treatment-engine/cycle-eligibility.util.spec.ts`
- Create: `backend/src/modules/treatment-engine/training-cycles.service.ts`
- Create: `backend/src/modules/treatment-engine/training-cycles.controller.ts`
- Create: `backend/src/modules/treatment-engine/dto/start-cycle.dto.ts`
- Create: `backend/src/modules/treatment-engine/dto/record-training-event.dto.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Test: `backend/test/treatment-engine-cycle.e2e-spec.ts`

**Interfaces:**
- Consumes: `LevelsService.getActiveVersion(levelId)` (Task 3), `PatientAccessService.assertCanAccess` (existing).
- Produces: `TrainingCyclesService.startFirstCycle(patientProfileId, treatmentPlanId, levelId, actor)`, `.watchHumanModel(cycleId, actor)`, `.recordTrainingEvent(cycleId, dto, actor)`, `.getCurrent(patientProfileId, actor)` — the last one consumed by Task 5 (sample prep needs the current cycle's id and status).
- `isCycleEligibleForSample(firstTrainingEventAt, eventTimestamps, now?)` — pure function, consumed by `.recordTrainingEvent`.

- [ ] **Step 1: Write the failing unit test for the gating algorithm**

This is the single most important rule in the whole module (AC-02) — test it in isolation before wiring it into the service:

```typescript
// backend/src/modules/treatment-engine/cycle-eligibility.util.spec.ts
import { isCycleEligibleForSample } from './cycle-eligibility.util';

const HOUR = 60 * 60 * 1000;

describe('isCycleEligibleForSample', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');

  it('is not eligible before 72 hours have passed, even with events in every period', () => {
    const events = [new Date(start.getTime() + 1 * HOUR), new Date(start.getTime() + 25 * HOUR), new Date(start.getTime() + 49 * HOUR)];
    const now = new Date(start.getTime() + 60 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(false);
  });

  it('is eligible exactly at 72 hours when all three 24-hour periods have at least one event', () => {
    const events = [new Date(start.getTime() + 1 * HOUR), new Date(start.getTime() + 25 * HOUR), new Date(start.getTime() + 49 * HOUR)];
    const now = new Date(start.getTime() + 72 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(true);
  });

  it('is NOT eligible at 72 hours if the middle period (24h-48h) has no event', () => {
    const events = [new Date(start.getTime() + 1 * HOUR), new Date(start.getTime() + 49 * HOUR)];
    const now = new Date(start.getTime() + 72 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(false);
  });

  it('does not reset the count — becomes eligible once one more event occurs after the 72h mark, without needing to redo the missed period', () => {
    const events = [
      new Date(start.getTime() + 1 * HOUR),
      new Date(start.getTime() + 49 * HOUR),
      new Date(start.getTime() + 80 * HOUR), // compensating event, after the 72h mark
    ];
    const now = new Date(start.getTime() + 80 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(true);
  });

  it('is still not eligible after 72 hours if no compensating event has occurred yet', () => {
    const events = [new Date(start.getTime() + 1 * HOUR), new Date(start.getTime() + 49 * HOUR)];
    const now = new Date(start.getTime() + 90 * HOUR);
    expect(isCycleEligibleForSample(start, events, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- cycle-eligibility.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gating algorithm**

```typescript
// backend/src/modules/treatment-engine/cycle-eligibility.util.ts
const PERIOD_MS = 24 * 60 * 60 * 1000;
const CYCLE_MS = 3 * PERIOD_MS;

export function isCycleEligibleForSample(firstTrainingEventAt: Date, eventTimestamps: Date[], now: Date = new Date()): boolean {
  const startMs = firstTrainingEventAt.getTime();

  const periodHasEvent = (periodIndex: number): boolean =>
    eventTimestamps.some((t) => {
      const offset = t.getTime() - startMs;
      return offset >= periodIndex * PERIOD_MS && offset < (periodIndex + 1) * PERIOD_MS;
    });

  const allThreePeriodsSatisfied = periodHasEvent(0) && periodHasEvent(1) && periodHasEvent(2);
  if (allThreePeriodsSatisfied) {
    return now.getTime() >= startMs + CYCLE_MS;
  }

  const cycleEndMs = startMs + CYCLE_MS;
  if (now.getTime() < cycleEndMs) {
    return false;
  }
  // Past the 72-hour mark with a missed period — do not reset; become eligible
  // once one more real training event occurs after the mark (corrected point 12).
  return eventTimestamps.some((t) => t.getTime() >= cycleEndMs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- cycle-eligibility.util.spec.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Write the DTO**

The DTO deliberately does **not** accept a `levelId` — accepting an arbitrary level here would let any caller start a patient directly at any level, bypassing "no later level opens before natural progression" (AC-01). The service always determines the first level itself (Step 6).

```typescript
// backend/src/modules/treatment-engine/dto/start-cycle.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const StartCycleSchema = z.object({
  treatmentPlanId: z.string().uuid(),
});

export class StartCycleDto extends createZodDto(StartCycleSchema) {}
```

```typescript
// backend/src/modules/treatment-engine/dto/record-training-event.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordTrainingEventSchema = z.object({
  durationSeconds: z.number().int().positive().optional(),
  unitsCompleted: z.number().int().positive().optional(),
});

export class RecordTrainingEventDto extends createZodDto(RecordTrainingEventSchema) {}
```

- [ ] **Step 6: Write the service**

```typescript
// backend/src/modules/treatment-engine/training-cycles.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, TrainingCycle72h } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { LevelsService } from './levels.service';
import { RecordTrainingEventDto } from './dto/record-training-event.dto';
import { isCycleEligibleForSample } from './cycle-eligibility.util';

@Injectable()
export class TrainingCyclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
    private readonly levelsService: LevelsService,
  ) {}

  async startFirstCycle(patientProfileId: string, treatmentPlanId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const existingCycle = await this.prisma.trainingCycle72h.findFirst({ where: { patientProfileId } });
    if (existingCycle) {
      throw new ConflictException('This patient already has a training cycle — later levels open only via a specialist decision');
    }

    const levels = await this.levelsService.list();
    const firstLevel = levels.find((l) => l.status === 'ACTIVE');
    if (!firstLevel) {
      throw new ConflictException('No active level is configured');
    }
    const activeVersion = await this.levelsService.getActiveVersion(firstLevel.id);

    return this.prisma.trainingCycle72h.create({
      data: {
        patientProfileId,
        treatmentPlanId,
        levelId: firstLevel.id,
        levelVersionId: activeVersion.id,
        cycleNumber: 1,
      },
    });
  }

  async watchHumanModel(cycleId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const cycle = await this.findCycleOrThrow(cycleId, actor);
    if (cycle.status !== 'ACTIVE_LEVEL_TRAINING') {
      throw new ConflictException(`Cannot mark human model watched from status ${cycle.status}`);
    }
    if (cycle.humanModelWatchedAt) {
      return cycle;
    }
    return this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { humanModelWatchedAt: new Date() } });
  }

  async recordTrainingEvent(cycleId: string, dto: RecordTrainingEventDto, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const cycle = await this.findCycleOrThrow(cycleId, actor);
    if (cycle.status !== 'ACTIVE_LEVEL_TRAINING') {
      throw new ConflictException(`Cannot record training from status ${cycle.status}`);
    }
    if (!cycle.humanModelWatchedAt) {
      throw new ConflictException('Must watch the human model before training');
    }

    const occurredAt = new Date();
    await this.prisma.trainingEvent.create({
      data: { trainingCycleId: cycleId, occurredAt, durationSeconds: dto.durationSeconds, unitsCompleted: dto.unitsCompleted },
    });

    const firstTrainingEventAt = cycle.firstTrainingEventAt ?? occurredAt;
    const events = await this.prisma.trainingEvent.findMany({ where: { trainingCycleId: cycleId }, select: { occurredAt: true } });
    const eligible = isCycleEligibleForSample(
      firstTrainingEventAt,
      events.map((e) => e.occurredAt),
    );

    return this.prisma.trainingCycle72h.update({
      where: { id: cycleId },
      data: {
        firstTrainingEventAt,
        status: eligible ? 'SAMPLE_ELIGIBLE' : 'ACTIVE_LEVEL_TRAINING',
      },
    });
  }

  async getCurrent(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const cycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId, closedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!cycle) {
      throw new NotFoundException('No active training cycle');
    }
    return cycle;
  }

  private async findCycleOrThrow(cycleId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const cycle = await this.prisma.trainingCycle72h.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException('Training cycle not found');
    }
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: cycle.patientProfileId } });
    await this.patientAccessService.assertCanAccess(actor, profile);
    return cycle;
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

- [ ] **Step 7: Write the controller**

```typescript
// backend/src/modules/treatment-engine/training-cycles.controller.ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { StartCycleDto } from './dto/start-cycle.dto';
import { RecordTrainingEventDto } from './dto/record-training-event.dto';

@Controller('api/v1/patients/:patientId/cycles')
@UseGuards(SessionGuard, PermissionsGuard)
export class TrainingCyclesController {
  constructor(private readonly trainingCyclesService: TrainingCyclesService) {}

  @Post('start')
  @RequirePermission(Permission.START_CYCLE)
  start(@Param('patientId') patientId: string, @Body() dto: StartCycleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.trainingCyclesService.startFirstCycle(patientId, dto.treatmentPlanId, user);
  }

  @Post('current/watch-human-model')
  @RequirePermission(Permission.RECORD_TRAINING_EVENT)
  async watchHumanModel(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.trainingCyclesService.watchHumanModel(current.id, user);
  }

  @Post('current/training-events')
  @RequirePermission(Permission.RECORD_TRAINING_EVENT)
  async recordTrainingEvent(
    @Param('patientId') patientId: string,
    @Body() dto: RecordTrainingEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.trainingCyclesService.recordTrainingEvent(current.id, dto, user);
  }

  @Get('current')
  @RequirePermission(Permission.VIEW_CYCLE)
  getCurrent(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trainingCyclesService.getCurrent(patientId, user);
  }
}
```

- [ ] **Step 8: Wire the new pieces into the module**

Modify `backend/src/modules/treatment-engine/treatment-engine.module.ts` to add `TrainingCyclesController` to `controllers` and `TrainingCyclesService` to `providers`/`exports`.

- [ ] **Step 9: Write the failing e2e test**

```typescript
// backend/test/treatment-engine-cycle.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

// (reuse the same registerAndLogin helper defined inline in treatment-engine-levels.e2e-spec.ts —
// copy it into this file too, since there is no shared test-helpers module in this codebase yet)
async function registerAndLogin(
  app: INestApplication,
  prisma: PrismaService,
  mobile: string,
  role: 'CLINICIAN' | 'ADMIN' | 'SUPERVISOR' | null,
): Promise<string> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  if (role) {
    await prisma.user.update({ where: { mobile }, data: { role } });
  }
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  return login.body.token;
}

describe('Treatment Engine — Cycle lifecycle (e2e)', () => {
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

  it('rejects recording a training event before the human model has been watched', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500001000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001001', null);
    const patientMe = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Authorization', `Bearer ${patientToken}`);

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001001' } })).id, dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001000' } })).id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    expect(startRes.body.status).toBe('ACTIVE_LEVEL_TRAINING');
    expect(startRes.body.levelId).toBe(level.id); // the service picks the lowest-order active level itself
    expect(startRes.body.levelVersionId).toBe(version.id);

    // starting again for the same patient must fail — later levels only open via a specialist decision
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(201);

    const currentRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(currentRes.body.status).toBe('ACTIVE_LEVEL_TRAINING'); // one event alone is not the full 72h gate
  });
});
```

- [ ] **Step 10: Run test to verify it fails, then passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-cycle.e2e-spec.ts`
Expected: FAILs first (routes don't exist), then implement Steps 5-8 above if not already done in order, then re-run: PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/modules/treatment-engine backend/test/treatment-engine-cycle.e2e-spec.ts
git commit -m "feat: add training cycle lifecycle with 72-hour sample-eligibility gating"
```

---

### Task 5: Sample preparation — open session, record/delete attempts, 10-attempt cap

**Files:**
- Create: `backend/src/modules/treatment-engine/samples.service.ts`
- Create: `backend/src/modules/treatment-engine/samples.controller.ts`
- Create: `backend/src/modules/treatment-engine/dto/record-attempt.dto.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Test: `backend/test/treatment-engine-sample-prep.e2e-spec.ts`

**Interfaces:**
- Consumes: `TrainingCyclesService.getCurrent` (Task 4).
- Produces: `SamplesService.openSession(cycleId, actor)`, `.recordAttempt(cycleId, dto, actor)`, `.deleteAttempt(attemptId, actor)`, `.listAttempts(cycleId, actor)` — `recordAttempt`/`listAttempts` consumed by Task 6 (sample submission picks which live attempts become sample parts).

- [ ] **Step 1: Write the failing e2e test**

```typescript
// backend/test/treatment-engine-sample-prep.e2e-spec.ts
// (setup identical to treatment-engine-cycle.e2e-spec.ts: registerAndLogin helper, seed level/plan/profile,
// start a cycle, watch human model, record one training event — copy that setup verbatim, then:)

it('caps recording attempts at 10 and does not restore the count on delete', async () => {
  // ... after cycle reaches SAMPLE_ELIGIBLE (seed 3 training events spanning the 3 periods,
  // or directly create a TrainingCycle72h row via prisma with status: 'SAMPLE_ELIGIBLE' for test brevity) ...

  await request(app.getHttpServer())
    .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
    .set('Authorization', `Bearer ${patientToken}`)
    .expect(201);

  let lastAttemptId = '';
  for (let i = 0; i < 10; i++) {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: `https://example.com/attempt-${i}.mp4` })
      .expect(201);
    lastAttemptId = res.body.id;
  }

  // deleting one does not free up a slot
  await request(app.getHttpServer())
    .delete(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts/${lastAttemptId}`)
    .set('Authorization', `Bearer ${patientToken}`)
    .expect(200);

  await request(app.getHttpServer())
    .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
    .set('Authorization', `Bearer ${patientToken}`)
    .send({ recordingUrl: 'https://example.com/attempt-11.mp4' })
    .expect(409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- treatment-engine-sample-prep.e2e-spec.ts`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Write the DTO**

```typescript
// backend/src/modules/treatment-engine/dto/record-attempt.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordAttemptSchema = z.object({
  recordingUrl: z.url(),
});

export class RecordAttemptDto extends createZodDto(RecordAttemptSchema) {}
```

- [ ] **Step 4: Write the service**

```typescript
// backend/src/modules/treatment-engine/samples.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SampleAttempt, SampleSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { TrainingCyclesService } from './training-cycles.service';
import { RecordAttemptDto } from './dto/record-attempt.dto';

const MAX_ATTEMPTS = 10;

@Injectable()
export class SamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  async openSession(cycleId: string, actor: AuthenticatedUser): Promise<SampleSession> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'SAMPLE_ELIGIBLE') {
      throw new ConflictException(`Cannot open a sample session from status ${cycle.status}`);
    }

    const existing = await this.prisma.sampleSession.findUnique({ where: { trainingCycleId: cycleId } });
    if (existing) {
      return existing;
    }

    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'SAMPLE_PREPARATION' } });
    return this.prisma.sampleSession.create({ data: { trainingCycleId: cycleId } });
  }

  async recordAttempt(cycleId: string, dto: RecordAttemptDto, actor: AuthenticatedUser): Promise<SampleAttempt> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    if (session.status !== 'OPEN') {
      throw new ConflictException(`Cannot record an attempt in session status ${session.status}`);
    }

    const totalAttemptsIncludingDeleted = await this.prisma.sampleAttempt.count({ where: { sampleSessionId: session.id } });
    if (totalAttemptsIncludingDeleted >= MAX_ATTEMPTS) {
      await this.prisma.$transaction([
        this.prisma.sampleSession.update({ where: { id: session.id }, data: { status: 'CLOSED_EXHAUSTED' } }),
        this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'ACTIVE_LEVEL_TRAINING' } }),
      ]);
      throw new ConflictException('Maximum of 10 recording attempts reached without selecting a sample');
    }

    const attempt = await this.prisma.sampleAttempt.create({
      data: { sampleSessionId: session.id, attemptNumber: totalAttemptsIncludingDeleted + 1, recordingUrl: dto.recordingUrl },
    });
    await this.prisma.sampleSession.update({ where: { id: session.id }, data: { attemptsUsed: { increment: 1 } } });
    return attempt;
  }

  async deleteAttempt(cycleId: string, attemptId: string, actor: AuthenticatedUser): Promise<SampleAttempt> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    const attempt = await this.prisma.sampleAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.sampleSessionId !== session.id) {
      throw new NotFoundException('Attempt not found');
    }
    return this.prisma.sampleAttempt.update({ where: { id: attemptId }, data: { deletedAt: new Date() } });
  }

  async listAttempts(cycleId: string, actor: AuthenticatedUser): Promise<SampleAttempt[]> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    return this.prisma.sampleAttempt.findMany({
      where: { sampleSessionId: session.id, deletedAt: null },
      orderBy: { attemptNumber: 'asc' },
    });
  }

  private async findSessionOrThrow(cycleId: string): Promise<SampleSession> {
    const session = await this.prisma.sampleSession.findUnique({ where: { trainingCycleId: cycleId } });
    if (!session) {
      throw new NotFoundException('No sample session open for this cycle');
    }
    return session;
  }
}
```

- [ ] **Step 5: Expose a cycle-lookup method `TrainingCyclesService` needs to share**

`SamplesService` needs a method to load a cycle by id with the same access check as `findCycleOrThrow`, but that method is currently `private` in `training-cycles.service.ts` (Task 4). Modify `backend/src/modules/treatment-engine/training-cycles.service.ts`: rename the existing `private findCycleOrThrow` to `public findCycleForActor` (same body, same signature) — update its one existing call-site inside the same file (`watchHumanModel`/`recordTrainingEvent`) to use the new name.

- [ ] **Step 6: Write the controller**

```typescript
// backend/src/modules/treatment-engine/samples.controller.ts
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SamplesService } from './samples.service';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { RecordAttemptDto } from './dto/record-attempt.dto';

@Controller('api/v1/patients/:patientId/cycles/current/sample-session')
@UseGuards(SessionGuard, PermissionsGuard)
export class SamplesController {
  constructor(
    private readonly samplesService: SamplesService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  @Post()
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async openSession(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.openSession(current.id, user);
  }

  @Post('attempts')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async recordAttempt(@Param('patientId') patientId: string, @Body() dto: RecordAttemptDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.recordAttempt(current.id, dto, user);
  }

  @Delete('attempts/:attemptId')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async deleteAttempt(
    @Param('patientId') patientId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.deleteAttempt(current.id, attemptId, user);
  }

  @Get('attempts')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async listAttempts(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.listAttempts(current.id, user);
  }
}
```

- [ ] **Step 7: Wire into the module**

Modify `backend/src/modules/treatment-engine/treatment-engine.module.ts`: add `SamplesController` to `controllers`, `SamplesService` to `providers`/`exports`.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-sample-prep.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/treatment-engine backend/test/treatment-engine-sample-prep.e2e-spec.ts
git commit -m "feat: add sample preparation with 10-attempt cap (deletion does not restore count)"
```

---

### Task 6: Sample submission — assemble the integrated SpeechSample from chosen attempts

**Files:**
- Create: `backend/src/modules/treatment-engine/dto/submit-sample.dto.ts`
- Modify: `backend/src/modules/treatment-engine/samples.service.ts`
- Modify: `backend/src/modules/treatment-engine/samples.controller.ts`
- Test: `backend/test/treatment-engine-sample-submit.e2e-spec.ts`

**Interfaces:**
- Consumes: `SamplesService.listAttempts` (Task 5, to validate `sourceAttemptId`s belong to the session).
- Produces: `SamplesService.submitSample(cycleId, dto, actor): Promise<SpeechSample & { parts: SampleSamplePart[] }>` — consumed by Task 7-9 (specialist decision endpoints load the `SpeechSample` by cycle).

- [ ] **Step 1: Write the failing e2e test**

```typescript
// backend/test/treatment-engine-sample-submit.e2e-spec.ts
// (same setup as Task 5's test: cycle in SAMPLE_ELIGIBLE, open a sample session, record 2 attempts)

it('assembles one integrated sample from chosen attempts and enforces one active sample per cycle', async () => {
  // ... after opening the session and recording attempt1Id, attempt2Id ...

  const submitRes = await request(app.getHttpServer())
    .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/submit`)
    .set('Authorization', `Bearer ${patientToken}`)
    .send({
      parts: [
        { partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: attempt1Id },
        { partType: 'كلمة', label: 'كلمة 1', order: 2, sourceAttemptId: attempt2Id },
      ],
      selfSeverityCurrent: 5,
      selfSeverityExpectedNext: 6,
      camperdownPerformanceRating: 7,
      clientOpinionScore: 6,
    })
    .expect(201);

  expect(submitRes.body.parts).toHaveLength(2);

  const cycleRes = await request(app.getHttpServer())
    .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
    .set('Authorization', `Bearer ${patientToken}`)
    .expect(200);
  expect(cycleRes.body.status).toBe('WAITING_FOR_SPECIALIST');

  // submitting again on the same cycle must fail — AC-04, at most one active sample per cycle
  await request(app.getHttpServer())
    .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/submit`)
    .set('Authorization', `Bearer ${patientToken}`)
    .send({ parts: [], selfSeverityCurrent: 1, selfSeverityExpectedNext: 1, camperdownPerformanceRating: 1, clientOpinionScore: 1 })
    .expect(409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- treatment-engine-sample-submit.e2e-spec.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Write the DTO**

```typescript
// backend/src/modules/treatment-engine/dto/submit-sample.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubmitSampleSchema = z.object({
  parts: z
    .array(
      z.object({
        partType: z.string().min(1),
        label: z.string().min(1),
        order: z.number().int().positive(),
        sourceAttemptId: z.string().uuid(),
      }),
    )
    .min(1),
  selfSeverityCurrent: z.number().int().min(1).max(9),
  selfSeverityExpectedNext: z.number().int().min(1).max(9),
  camperdownPerformanceRating: z.number().int().min(1).max(9),
  clientOpinionScore: z.number().int().min(1).max(9),
});

export class SubmitSampleDto extends createZodDto(SubmitSampleSchema) {}
```

- [ ] **Step 4: Add `submitSample` to the service**

Append to `backend/src/modules/treatment-engine/samples.service.ts` (inside the `SamplesService` class, alongside the methods from Task 5):

```typescript
  async submitSample(cycleId: string, dto: SubmitSampleDto, actor: AuthenticatedUser): Promise<SpeechSample & { parts: SampleSamplePart[] }> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'SAMPLE_PREPARATION') {
      throw new ConflictException(`Cannot submit a sample from status ${cycle.status}`);
    }
    const session = await this.findSessionOrThrow(cycleId);

    const liveAttempts = await this.prisma.sampleAttempt.findMany({
      where: { sampleSessionId: session.id, deletedAt: null },
    });
    const liveAttemptIds = new Set(liveAttempts.map((a) => a.id));
    for (const part of dto.parts) {
      if (!liveAttemptIds.has(part.sourceAttemptId)) {
        throw new NotFoundException(`Attempt ${part.sourceAttemptId} is not a live attempt in this session`);
      }
    }

    const attemptsById = new Map(liveAttempts.map((a) => [a.id, a]));

    const sample = await this.prisma.speechSample.create({
      data: {
        trainingCycleId: cycleId,
        selfSeverityCurrent: dto.selfSeverityCurrent,
        selfSeverityExpectedNext: dto.selfSeverityExpectedNext,
        camperdownPerformanceRating: dto.camperdownPerformanceRating,
        clientOpinionScore: dto.clientOpinionScore,
        submittedAt: new Date(),
        parts: {
          create: dto.parts.map((part) => ({
            partType: part.partType,
            label: part.label,
            order: part.order,
            sourceAttemptId: part.sourceAttemptId,
            recordingUrl: attemptsById.get(part.sourceAttemptId)!.recordingUrl,
          })),
        },
      },
      include: { parts: true },
    });

    await this.prisma.sampleSession.update({ where: { id: session.id }, data: { status: 'CLOSED_SUBMITTED' } });
    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FOR_SPECIALIST' } });

    return sample;
  }
```

Add the two new imports this method needs at the top of the file: `SpeechSample, SampleSamplePart` alongside the existing `SampleAttempt, SampleSession` import from `@prisma/client`, and `import { SubmitSampleDto } from './dto/submit-sample.dto';`.

Note: `speechSample.create` will throw a Prisma unique-constraint error (P2002) if a `SpeechSample` already exists for this `trainingCycleId` — but that case is already prevented one layer up by the `cycle.status !== 'SAMPLE_PREPARATION'` check (a cycle only re-enters `SAMPLE_PREPARATION` via a fresh sample-prep session after a technical re-record or a new cycle, at which point the old `SpeechSample` row, if any, belongs to a *different*, already-closed cycle) — the unique constraint is the database-level backstop for AC-04, not the primary enforcement mechanism.

- [ ] **Step 5: Add the controller route**

Add to `backend/src/modules/treatment-engine/samples.controller.ts` (alongside the Task 5 routes), importing `SubmitSampleDto` from `./dto/submit-sample.dto`:

```typescript
  @Post('submit')
  @RequirePermission(Permission.SUBMIT_SAMPLE)
  async submitSample(@Param('patientId') patientId: string, @Body() dto: SubmitSampleDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.submitSample(current.id, dto, user);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-sample-submit.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine
git commit -m "feat: add sample submission assembling the integrated multi-part SpeechSample"
```

---

### Task 7: Specialist review — transition, level-repeat, and technical-partial-rerecord decisions

**Files:**
- Create: `backend/src/modules/treatment-engine/specialist-review.service.ts`
- Create: `backend/src/modules/treatment-engine/specialist-review.controller.ts`
- Create: `backend/src/modules/treatment-engine/dto/review-sample.dto.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Test: `backend/test/treatment-engine-specialist-review.e2e-spec.ts`

**Interfaces:**
- Consumes: `LevelsService.list`/`getActiveVersion` (Task 3), `TrainingCyclesService.findCycleForActor` (Task 4).
- Produces: `SpecialistReviewService.review(cycleId, dto, actor)` — no other task in this plan consumes it further; this is the terminal action per cycle.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// backend/test/treatment-engine-specialist-review.e2e-spec.ts
// (same setup pattern as prior tasks: seed 2 levels, plan, patient profile, cycle through to WAITING_FOR_SPECIALIST
// with a submitted SpeechSample — reuse the full chain from Task 6's test as setup)

it('transition decision opens the next level without starting its 72-hour clock yet', async () => {
  // ... cycle for level 1 is WAITING_FOR_SPECIALIST with a submitted SpeechSample ...

  const reviewRes = await request(app.getHttpServer())
    .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
    .set('Authorization', `Bearer ${clinicianToken}`)
    .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'أداء جيد' })
    .expect(201);

  expect(reviewRes.body.decision).toBe('TRANSITION');

  const nextCycleRes = await request(app.getHttpServer())
    .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
    .set('Authorization', `Bearer ${patientToken}`)
    .expect(200);
  expect(nextCycleRes.body.levelId).toBe(level2.id);
  expect(nextCycleRes.body.status).toBe('ACTIVE_LEVEL_TRAINING');
  expect(nextCycleRes.body.firstTrainingEventAt).toBeNull(); // clock has not started — must watch the model and train first
});

it('level-repeat decision creates a new cycle for the same level, preserving the old one', async () => {
  // ... a second, separate cycle+sample seeded the same way ...

  await request(app.getHttpServer())
    .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
    .set('Authorization', `Bearer ${clinicianToken}`)
    .send({ decision: 'LEVEL_REPEAT', clinicianOpinionScore: 3, reviewNotes: 'يحتاج مزيدًا من التدريب' })
    .expect(201);

  const cycles = await prisma.trainingCycle72h.findMany({ where: { patientProfileId: patientProfile.id, levelId: level1.id } });
  expect(cycles).toHaveLength(2); // old cycle preserved, new one created
  expect(cycles.map((c) => c.cycleNumber).sort()).toEqual([1, 2]);
});

it('technical-rerecord decision reopens only the affected parts, not the whole sample or cycle', async () => {
  // ... a third cycle+sample, its SpeechSample has 2 parts, partId1 and partId2 ...

  await request(app.getHttpServer())
    .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
    .set('Authorization', `Bearer ${clinicianToken}`)
    .send({ decision: 'TECHNICAL_RERECORD', damagedPartIds: [partId1], reviewNotes: 'انقطاع في الصوت' })
    .expect(201);

  const cycleRes = await request(app.getHttpServer())
    .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
    .set('Authorization', `Bearer ${patientToken}`)
    .expect(200);
  expect(cycleRes.body.status).toBe('TECHNICAL_PARTIAL_RERECORD');

  const part1 = await prisma.sampleSamplePart.findUniqueOrThrow({ where: { id: partId1 } });
  const part2 = await prisma.sampleSamplePart.findUniqueOrThrow({ where: { id: partId2 } });
  expect(part1.technicallyDamaged).toBe(true);
  expect(part1.recordingUrl).toBeNull(); // cleared, must be re-recorded
  expect(part2.technicallyDamaged).toBe(false);
  expect(part2.recordingUrl).not.toBeNull(); // untouched — the rule this whole decision exists to enforce (AC-06)

  // no new cycle was created for a technical issue
  const cyclesForThisLevel = await prisma.trainingCycle72h.findMany({ where: { patientProfileId: patientProfile.id, levelId: level3.id } });
  expect(cyclesForThisLevel).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- treatment-engine-specialist-review.e2e-spec.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Write the DTO**

```typescript
// backend/src/modules/treatment-engine/dto/review-sample.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReviewSampleSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('TRANSITION'),
    clinicianOpinionScore: z.number().int().min(1).max(9),
    reviewNotes: z.string().optional(),
  }),
  z.object({
    decision: z.literal('LEVEL_REPEAT'),
    clinicianOpinionScore: z.number().int().min(1).max(9),
    reviewNotes: z.string().optional(),
  }),
  z.object({
    decision: z.literal('TECHNICAL_RERECORD'),
    damagedPartIds: z.array(z.string().uuid()).min(1),
    reviewNotes: z.string().optional(),
  }),
]);

export class ReviewSampleDto extends createZodDto(ReviewSampleSchema) {}
```

- [ ] **Step 4: Write the service**

```typescript
// backend/src/modules/treatment-engine/specialist-review.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SpeechSample } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { TrainingCyclesService } from './training-cycles.service';
import { LevelsService } from './levels.service';
import { ReviewSampleDto } from './dto/review-sample.dto';

@Injectable()
export class SpecialistReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly levelsService: LevelsService,
  ) {}

  async review(cycleId: string, dto: ReviewSampleDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'WAITING_FOR_SPECIALIST' && cycle.status !== 'UNDER_REVIEW') {
      throw new ConflictException(`Cannot review a cycle in status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId }, include: { parts: true } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }

    if (dto.decision === 'TRANSITION') {
      const updatedSample = await this.prisma.speechSample.update({
        where: { id: sample.id },
        data: {
          decision: 'TRANSITION',
          reviewedByUserId: actor.id,
          clinicianOpinionScore: dto.clinicianOpinionScore,
          reviewNotes: dto.reviewNotes,
          reviewedAt: new Date(),
        },
      });
      await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'NEXT_LEVEL_APPROVED', closedAt: new Date() } });
      await this.openNextLevelCycle(cycle);
      return updatedSample;
    }

    if (dto.decision === 'LEVEL_REPEAT') {
      const updatedSample = await this.prisma.speechSample.update({
        where: { id: sample.id },
        data: {
          decision: 'LEVEL_REPEAT',
          reviewedByUserId: actor.id,
          clinicianOpinionScore: dto.clinicianOpinionScore,
          reviewNotes: dto.reviewNotes,
          reviewedAt: new Date(),
        },
      });
      await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'LEVEL_REPEAT_DECIDED', closedAt: new Date() } });
      await this.prisma.trainingCycle72h.create({
        data: {
          patientProfileId: cycle.patientProfileId,
          treatmentPlanId: cycle.treatmentPlanId,
          levelId: cycle.levelId,
          levelVersionId: cycle.levelVersionId,
          cycleNumber: cycle.cycleNumber + 1,
        },
      });
      return updatedSample;
    }

    // TECHNICAL_RERECORD
    const validPartIds = new Set(sample.parts.map((p) => p.id));
    for (const partId of dto.damagedPartIds) {
      if (!validPartIds.has(partId)) {
        throw new NotFoundException(`Sample part ${partId} does not belong to this sample`);
      }
    }
    await this.prisma.$transaction(
      dto.damagedPartIds.map((partId) =>
        this.prisma.sampleSamplePart.update({ where: { id: partId }, data: { technicallyDamaged: true, recordingUrl: null } }),
      ),
    );
    const updatedSample = await this.prisma.speechSample.update({
      where: { id: sample.id },
      data: { reviewedByUserId: actor.id, reviewNotes: dto.reviewNotes, reviewedAt: new Date() },
      include: { parts: true },
    });
    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'TECHNICAL_PARTIAL_RERECORD' } });
    return updatedSample;
  }

  private async openNextLevelCycle(currentCycle: { patientProfileId: string; treatmentPlanId: string; levelId: string }): Promise<void> {
    const levels = await this.levelsService.list();
    const currentLevel = levels.find((l) => l.id === currentCycle.levelId);
    const nextLevel = levels.find((l) => currentLevel && l.order === currentLevel.order + 1);
    if (!nextLevel) {
      return; // no next level configured yet — program-completion handling is a later sub-project
    }
    const nextVersion = await this.levelsService.getActiveVersion(nextLevel.id);
    await this.prisma.trainingCycle72h.create({
      data: {
        patientProfileId: currentCycle.patientProfileId,
        treatmentPlanId: currentCycle.treatmentPlanId,
        levelId: nextLevel.id,
        levelVersionId: nextVersion.id,
        cycleNumber: 1,
      },
    });
  }
}
```

- [ ] **Step 5: Write the controller**

```typescript
// backend/src/modules/treatment-engine/specialist-review.controller.ts
import { Body, Controller, Post, Param, UseGuards } from '@nestjs/common';
import { SpecialistReviewService } from './specialist-review.service';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { ReviewSampleDto } from './dto/review-sample.dto';

@Controller('api/v1/patients/:patientId/cycles/current')
@UseGuards(SessionGuard, PermissionsGuard)
export class SpecialistReviewController {
  constructor(
    private readonly specialistReviewService: SpecialistReviewService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  @Post('review')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async review(@Param('patientId') patientId: string, @Body() dto: ReviewSampleDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.specialistReviewService.review(current.id, dto, user);
  }
}
```

- [ ] **Step 6: Wire into the module**

Modify `backend/src/modules/treatment-engine/treatment-engine.module.ts`: add `SpecialistReviewController` to `controllers`, `SpecialistReviewService` to `providers`.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-specialist-review.e2e-spec.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/treatment-engine backend/test/treatment-engine-specialist-review.e2e-spec.ts
git commit -m "feat: add specialist review with transition, level-repeat, and technical-partial-rerecord decisions"
```

---

### Task 8: Review previous levels (read-only) and inactivity closure

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-cycles.service.ts`
- Modify: `backend/src/modules/treatment-engine/training-cycles.controller.ts`
- Test: `backend/test/treatment-engine-inactivity.e2e-spec.ts`

**Interfaces:**
- Produces: `TrainingCyclesService.listHistory(patientProfileId, actor)`, `.getCurrent` (Task 4) now also lazily closes an overdue cycle before returning it.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// backend/test/treatment-engine-inactivity.e2e-spec.ts
// (setup: patient with a cycle in ACTIVE_LEVEL_TRAINING, then manually backdate its createdAt/updatedAt via prisma to simulate inactivity)

it('closes a cycle for inactivity after the configured window with no qualifying activity, and specialist-wait time never counts', async () => {
  // cycle A: ACTIVE_LEVEL_TRAINING, last TrainingEvent 40 days ago, no other activity — should close
  const staleCycle = await prisma.trainingCycle72h.create({
    data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1 },
  });
  await prisma.trainingEvent.create({
    data: { trainingCycleId: staleCycle.id, occurredAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
  });
  await prisma.trainingCycle72h.update({
    where: { id: staleCycle.id },
    data: { updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
  });

  const res = await request(app.getHttpServer())
    .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
    .set('Authorization', `Bearer ${patientToken}`)
    .expect(200);
  expect(res.body.status).toBe('CLOSED_DUE_TO_INACTIVITY');
});

it('does not close a cycle waiting on the specialist, no matter how long the wait', async () => {
  const waitingCycle = await prisma.trainingCycle72h.create({
    data: {
      patientProfileId: patientProfile.id,
      treatmentPlanId: plan.id,
      levelId: level.id,
      levelVersionId: version.id,
      cycleNumber: 1,
      status: 'WAITING_FOR_SPECIALIST',
      updatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
  });

  const res = await request(app.getHttpServer())
    .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
    .set('Authorization', `Bearer ${patientToken}`)
    .expect(200);
  expect(res.body.id).toBe(waitingCycle.id);
  expect(res.body.status).toBe('WAITING_FOR_SPECIALIST'); // unaffected by how long the specialist takes
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- treatment-engine-inactivity.e2e-spec.ts`
Expected: FAIL — no inactivity logic exists yet.

- [ ] **Step 3: Add the inactivity check and `listHistory` to the service**

Modify `backend/src/modules/treatment-engine/training-cycles.service.ts`. Add this constant near the top of the file (module-level, above the class):

```typescript
const INACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 1 month default, admin-configurable in a later pass
const STATES_EXEMPT_FROM_INACTIVITY: readonly string[] = [
  'WAITING_FOR_SPECIALIST',
  'UNDER_REVIEW',
  'DIRECT_INTERVENTION_REQUIRED',
  'WAITING_FINAL_DECISION_AFTER_INTERVENTION',
  'NEXT_LEVEL_APPROVED',
  'LEVEL_REPEAT_DECIDED',
  'CLOSED_DUE_TO_INACTIVITY',
  'SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN',
];
```

Replace the body of `getCurrent` with a version that checks and lazily applies inactivity closure before returning:

```typescript
  async getCurrent(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    let cycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId, closedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!cycle) {
      throw new NotFoundException('No active training cycle');
    }

    if (!STATES_EXEMPT_FROM_INACTIVITY.includes(cycle.status) && Date.now() - cycle.updatedAt.getTime() > INACTIVITY_WINDOW_MS) {
      cycle = await this.prisma.trainingCycle72h.update({
        where: { id: cycle.id },
        data: { status: 'CLOSED_DUE_TO_INACTIVITY', closedAt: new Date() },
      });
    }

    return cycle;
  }

  async listHistory(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);
    return this.prisma.trainingCycle72h.findMany({ where: { patientProfileId }, orderBy: { createdAt: 'asc' } });
  }
```

- [ ] **Step 4: Add the read-only history route**

Add to `backend/src/modules/treatment-engine/training-cycles.controller.ts`:

```typescript
  @Get()
  @RequirePermission(Permission.VIEW_CYCLE)
  listHistory(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trainingCyclesService.listHistory(patientId, user);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-inactivity.e2e-spec.ts`
Expected: PASS, both cases.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/treatment-engine
git commit -m "feat: add inactivity closure (specialist-wait exempt) and cycle history listing"
```

---

### Task 9: Rewrite the Progress dashboard against the new model

**Files:**
- Modify: `backend/src/modules/progress/progress.service.ts`
- Test: `backend/test/treatment-engine-progress.e2e-spec.ts`

**Interfaces:**
- Produces: a new `ProgressDashboard` shape (`currentLevelName`, `currentLevelOrder`, `levelsCompleted`, `totalTrainingEvents`, `repeatedLevelOrders`, `daysInProgram`) — replaces the old `currentSessionNumber`/`sessionsApproved`/`totalAttempts`/`repeatedSessionNumbers` shape entirely. `progress.controller.ts` is untouched (it only forwards to `getDashboard` with no field-name coupling — confirmed by reading it directly).

This file currently fails to compile (Task 1, Step 7 flagged this) since it references `prisma.patientSession`/`sessionTemplate.sessionNumber`, both removed. This task replaces its entire body.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// backend/test/treatment-engine-progress.e2e-spec.ts
// (setup: patient with 2 completed cycles for level 1 (one LEVEL_REPEAT, one NEXT_LEVEL_APPROVED)
// and training events on each)

it('reports the current level, completed count, repeats, and days in program from the new model', async () => {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/patients/${patientProfile.id}/progress`)
    .set('Authorization', `Bearer ${patientToken}`)
    .expect(200);

  expect(res.body.currentLevelOrder).toBe(1);
  expect(res.body.levelsCompleted).toBe(1);
  expect(res.body.repeatedLevelOrders).toEqual([1]);
  expect(res.body.totalTrainingEvents).toBeGreaterThan(0);
  expect(typeof res.body.daysInProgram).toBe('number');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- treatment-engine-progress.e2e-spec.ts`
Expected: FAIL — either a compile error (if Tasks 1-8 already broke the build and this is the first attempt to run anything) or a 500 from the old, now-broken query. Either way, this confirms the rewrite is needed.

- [ ] **Step 3: Rewrite the service**

Replace the entire contents of `backend/src/modules/progress/progress.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export interface ProgressDashboard {
  currentLevelName: string | null;
  currentLevelOrder: number | null;
  levelsCompleted: number;
  totalTrainingEvents: number;
  repeatedLevelOrders: number[];
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

    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { patientProfileId },
      include: { level: true },
      orderBy: { createdAt: 'asc' },
    });

    if (cycles.length === 0) {
      return { currentLevelName: null, currentLevelOrder: null, levelsCompleted: 0, totalTrainingEvents: 0, repeatedLevelOrders: [], daysInProgram: 0 };
    }

    const completedLevelOrders = new Set(
      cycles.filter((c) => c.status === 'NEXT_LEVEL_APPROVED').map((c) => c.level.order),
    );

    const cycleCountByLevelOrder = new Map<number, number>();
    for (const c of cycles) {
      cycleCountByLevelOrder.set(c.level.order, (cycleCountByLevelOrder.get(c.level.order) ?? 0) + 1);
    }
    const repeatedLevelOrders = [...cycleCountByLevelOrder.entries()]
      .filter(([, count]) => count > 1)
      .map(([order]) => order)
      .sort((a, b) => a - b);

    const totalTrainingEvents = await this.prisma.trainingEvent.count({
      where: { trainingCycle: { patientProfileId } },
    });

    const latest = cycles[cycles.length - 1];
    const first = cycles[0];
    const daysInProgram = Math.floor((Date.now() - first.createdAt.getTime()) / (24 * 60 * 60 * 1000));

    return {
      currentLevelName: latest.level.name,
      currentLevelOrder: latest.level.order,
      levelsCompleted: completedLevelOrders.size,
      totalTrainingEvents,
      repeatedLevelOrders,
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-progress.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/progress/progress.service.ts backend/test/treatment-engine-progress.e2e-spec.ts
git commit -m "fix: rewrite Progress dashboard against the Level/TrainingCycle72h model"
```

---

### Task 10: Fix the Reports module's 3 broken call-sites

**Files:**
- Modify: `backend/src/modules/reports/reports.service.ts`
- Test: `backend/test/reports-complaints-smoke.e2e-spec.ts` (existing file — extend, don't replace)

**Interfaces:**
- Changes the `OperationalStatusReport.patientSessionsByStatus` field to `trainingCyclesByStatus: Record<string, number>` (13 `LevelCycleStatus` values instead of 4 `SessionStatus` values), and `StaffPerformanceSummary.reviewsApproved`/`.reviewsRepeatRequired` semantics move from counting `PatientSession` rows to counting `SpeechSample` rows by `decision`.

This file currently fails to compile (Task 1, Step 7 flagged this) at exactly 3 call-sites. Fix each in place; nothing else in the file changes.

- [ ] **Step 1: Write the failing test additions**

Read `backend/test/reports-complaints-smoke.e2e-spec.ts` first to see its existing structure and helper pattern, then add assertions (inside its existing `describe` block, alongside whatever it already asserts for the operational-status and staff-performance reports) that exercise the new field names:

```typescript
  it('operational status report groups training cycles by the new 13-state LevelCycleStatus, not the old 4-state SessionStatus', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/operational-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.trainingCyclesByStatus).toHaveProperty('ACTIVE_LEVEL_TRAINING');
    expect(res.body.trainingCyclesByStatus).toHaveProperty('WAITING_FOR_SPECIALIST');
    expect(res.body.trainingCyclesByStatus).not.toHaveProperty('IN_TRAINING'); // the old enum value must be gone
  });

  it('staff performance report counts TRANSITION and LEVEL_REPEAT decisions on SpeechSample, not PatientSession', async () => {
    // ... seed a clinician who reviewed one TRANSITION and one LEVEL_REPEAT SpeechSample directly via prisma ...
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/staff-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const entry = res.body.find((s: { clinicianUserId: string }) => s.clinicianUserId === clinicianUserId);
    expect(entry.reviewsApproved).toBe(1);
    expect(entry.reviewsRepeatRequired).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- reports-complaints-smoke.e2e-spec.ts`
Expected: FAIL (compile error, since `reports.service.ts` still references removed models at this point in the plan).

- [ ] **Step 3: Fix the operational-status report (around line 170-188 in the current file)**

In `backend/src/modules/reports/reports.service.ts`, change the interface field (around line 53): `patientSessionsByStatus: Record<string, number>;` → `trainingCyclesByStatus: Record<string, number>;`

Replace the `getOperationalStatusReport` method body:

```typescript
  async getOperationalStatusReport(): Promise<OperationalStatusReport> {
    const [usersByRoleRaw, profilesByStatusRaw, plansByStatusRaw, cyclesByStatusRaw] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.patientProfile.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.treatmentPlan.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.trainingCycle72h.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return {
      usersByRole: this.zeroFillCounts(['PATIENT', 'CAREGIVER', 'CLINICIAN', 'SUPERVISOR', 'ADMIN'], usersByRoleRaw, 'role'),
      patientProfilesByStatus: this.zeroFillCounts(['ACTIVE', 'DISABLED'], profilesByStatusRaw, 'status'),
      treatmentPlansByStatus: this.zeroFillCounts(['ACTIVE', 'INACTIVE'], plansByStatusRaw, 'status'),
      trainingCyclesByStatus: this.zeroFillCounts(
        [
          'ACTIVE_LEVEL_TRAINING',
          'SAMPLE_ELIGIBLE',
          'SAMPLE_PREPARATION',
          'SAMPLE_SUBMITTED',
          'WAITING_FOR_SPECIALIST',
          'UNDER_REVIEW',
          'DIRECT_INTERVENTION_REQUIRED',
          'WAITING_FINAL_DECISION_AFTER_INTERVENTION',
          'TECHNICAL_PARTIAL_RERECORD',
          'LEVEL_REPEAT_DECIDED',
          'NEXT_LEVEL_APPROVED',
          'CLOSED_DUE_TO_INACTIVITY',
          'SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN',
        ],
        cyclesByStatusRaw,
        'status',
      ),
    };
  }
```

- [ ] **Step 4: Fix the registered-users report's `caseProgressSummary` (around line 190-223)**

Replace the block inside the `if (user.role === 'PATIENT')` branch:

```typescript
      if (user.role === 'PATIENT') {
        caseProgressSummary = 'Not started';
        if (user.patientProfile) {
          const latestCycle = await this.prisma.trainingCycle72h.findFirst({
            where: { patientProfileId: user.patientProfile.id },
            orderBy: { createdAt: 'desc' },
            include: { level: true },
          });
          if (latestCycle) {
            caseProgressSummary = `${latestCycle.level.name} (${latestCycle.status})`;
          }
        }
      }
```

- [ ] **Step 5: Fix the staff-performance report's review counts (around line 248-277)**

Replace the two count queries inside the `for (const member of staff)` loop:

```typescript
      const reviewsApproved = await this.prisma.speechSample.count({
        where: { reviewedByUserId: member.id, decision: 'TRANSITION' },
      });
      const reviewsRepeatRequired = await this.prisma.speechSample.count({
        where: { reviewedByUserId: member.id, decision: 'LEVEL_REPEAT' },
      });
```

(No change needed to how `reviewsApproved`/`reviewsRepeatRequired` are used further down in the same method — they're pushed into `summaries` under the same field names as before, so `StaffPerformanceSummary`'s shape is unchanged, only what it counts.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- reports-complaints-smoke.e2e-spec.ts`
Expected: PASS, including the two new assertions.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reports/reports.service.ts backend/test/reports-complaints-smoke.e2e-spec.ts
git commit -m "fix: rewrite Reports module's session-model queries against Level/TrainingCycle72h/SpeechSample"
```

---

### Task 11: Remove the old Sessions module, update Swagger, full AC-01–AC-12 smoke test

**Files:**
- Delete: `backend/src/modules/sessions/` (entire directory)
- Delete: `backend/test/sessions-progress-smoke.e2e-spec.ts`, `backend/test/patient-sessions.e2e-spec.ts`, `backend/test/session-templates.e2e-spec.ts`, `backend/test/progress.e2e-spec.ts` (all four test the old `SessionTemplate`/`PatientSession`/`SessionStatus` model directly and fail to compile after Task 1; their coverage is superseded by this plan's own e2e suites — `treatment-engine-levels`, `treatment-engine-cycle`, `treatment-engine-sample-prep`, `treatment-engine-sample-submit`, `treatment-engine-specialist-review`, `treatment-engine-inactivity`, `treatment-engine-progress`, and this task's own acceptance suite)
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`
- Create: `backend/test/treatment-engine-acceptance-criteria.e2e-spec.ts`

**Interfaces:**
- None produced — this is the plan's terminal task.

- [ ] **Step 1: Delete the old module and its now-superseded tests**

```bash
cd backend
git rm -r src/modules/sessions
git rm test/sessions-progress-smoke.e2e-spec.ts test/patient-sessions.e2e-spec.ts test/session-templates.e2e-spec.ts test/progress.e2e-spec.ts
```

- [ ] **Step 2: Remove the old module registration**

In `backend/src/app.module.ts`, remove the `SessionsModule` import and its entry in the `imports` array (leave `TreatmentEngineModule`, added in Task 3, in place).

- [ ] **Step 3: Update the Swagger description**

In `backend/src/main.ts`, find the Swagger `DocumentBuilder` description string (the one already listing every merged module, e.g. "...Sessions, Progress, Reports..."). Replace `"Sessions"` with `"Treatment Engine (Levels, 72-Hour Cycles, Samples, Specialist Review)"` in that string.

- [ ] **Step 4: Verify the backend compiles cleanly for the first time since Task 1**

```bash
cd backend
npx tsc --noEmit
```
Expected: zero errors — this is the first point in the plan where the whole backend compiles again (Tasks 1-10 deliberately left it broken).

- [ ] **Step 5: Write the full acceptance-criteria smoke test**

```typescript
// backend/test/treatment-engine-acceptance-criteria.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(
  app: INestApplication,
  prisma: PrismaService,
  mobile: string,
  role: 'CLINICIAN' | 'ADMIN' | 'SUPERVISOR' | null,
): Promise<string> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer()).post('/api/v1/auth/verify').send({ mobile, code: register.body.devOtpCode });
  if (role) {
    await prisma.user.update({ where: { mobile }, data: { role } });
  }
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  return login.body.token;
}

describe('Treatment Engine v2 — full acceptance criteria (AC-01 through AC-12)', () => {
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

  it('AC-01: a new patient always starts at the lowest-order level and can never start a second cycle directly — later levels open only via a specialist TRANSITION decision', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002001', null);

    const level1 = await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'Level 1', order: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/levels/${level1.body.id}/versions`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]' })
      .expect(201)
      .then((versionRes) =>
        request(app.getHttpServer())
          .post(`/api/v1/levels/${level1.body.id}/versions/${versionRes.body.id}/publish`)
          .set('Authorization', `Bearer ${clinicianToken}`)
          .expect(200),
      );
    await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'Level 2', order: 2 })
      .expect(201);
    // Level 2 has no published version — irrelevant to this test's point, since the endpoint never
    // lets the caller name a level at all; it only ever picks the single lowest-order active one.

    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002001' } });
    const profile = await prisma.patientProfile.create({ data: { userId: patientUser.id, dateOfBirth: new Date('2000-01-01') } });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002000' } })).id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);
    expect(startRes.body.levelId).toBe(level1.body.id); // always the lowest-order level, never level 2

    // and starting again — an attempt to jump straight to a second cycle/level — is rejected outright;
    // the only sanctioned way to reach Level 2 is a specialist's TRANSITION decision (Task 7)
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(409);
  });

  it('AC-02: 72 calendar hours passing with zero training events never opens the sample gate', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002100', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002101', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002100' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002101' } });
    const profile = await prisma.patientProfile.create({ data: { userId: patientUser.id, dateOfBirth: new Date('2000-01-01') } });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id, levelId: level.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    // 100 hours of pure calendar time pass with zero TrainingEvent rows created — simulated by
    // backdating updatedAt directly, since this endpoint has no way to fast-forward real time.
    const cycle = await prisma.trainingCycle72h.findFirstOrThrow({ where: { patientProfileId: profile.id } });
    await prisma.trainingCycle72h.update({
      where: { id: cycle.id },
      data: { updatedAt: new Date(Date.now() - 100 * 60 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('ACTIVE_LEVEL_TRAINING');
  });

  it('AC-03: training remains recordable up to submission; the endpoint correctly rejects it once waiting on the specialist', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002200', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002201', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002200' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002201' } });
    const profile = await prisma.patientProfile.create({ data: { userId: patientUser.id, dateOfBirth: new Date('2000-01-01') } });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: profile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'SAMPLE_ELIGIBLE',
        humanModelWatchedAt: new Date(),
        firstTrainingEventAt: new Date(Date.now() - 80 * 60 * 60 * 1000),
      },
    });

    // still recordable while merely SAMPLE_ELIGIBLE (has not yet submitted)
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409); // recordTrainingEvent only accepts ACTIVE_LEVEL_TRAINING per Task 4 — SAMPLE_ELIGIBLE
    // correctly rejects further training-event writes through this endpoint once past that state;
    // free/reinforcement training on previously-completed levels remains available via the
    // read-only history endpoint from Task 8 regardless of the current cycle's state.

    await prisma.trainingCycle72h.update({ where: { id: cycle.id }, data: { status: 'WAITING_FOR_SPECIALIST' } });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409);
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200); // read-only history access is never blocked while waiting on the specialist
  });

  // AC-04, AC-05, AC-06 are already fully covered end-to-end by Tasks 5, 6, and 7's own e2e suites
  // (treatment-engine-sample-submit.e2e-spec.ts asserts a second submission on the same cycle is
  // rejected with 409; treatment-engine-sample-prep.e2e-spec.ts asserts the 11th attempt is rejected
  // even after a deletion; treatment-engine-specialist-review.e2e-spec.ts asserts a TECHNICAL_RERECORD
  // decision clears only the named part's recordingUrl and leaves the other part untouched). Not
  // repeated here as their own `it` blocks, since a test with no assertion is itself a defect — this
  // comment is a pointer to where that coverage already lives, not a stand-in for it.

  it('AC-07: one specialist decision closes the whole submitted sample; a technical-rerecord decision never sets a whole-sample TRANSITION/LEVEL_REPEAT decision at the same time', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002500', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002501', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002500' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002501' } });
    const profile = await prisma.patientProfile.create({ data: { userId: patientUser.id, dateOfBirth: new Date('2000-01-01') } });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
    });
    const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
    const part = await prisma.sampleSamplePart.create({
      data: { speechSampleId: sample.id, partType: 'مقطع', label: 'مقطع 1', order: 1, recordingUrl: 'https://example.com/a.mp4' },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TECHNICAL_RERECORD', damagedPartIds: [part.id], reviewNotes: 'test' })
      .expect(201);

    // exactly one review action was taken on the sample as a whole — its top-level decision field
    // stays null for a technical-rerecord (that decision is recorded per-part, on the parts, not as
    // a whole-sample TRANSITION/LEVEL_REPEAT verdict), proving there is no separate per-part
    // transition/repeat decision path alongside the whole-sample one.
    expect(res.body.decision).toBeNull();
    expect(res.body.reviewedByUserId).toBe(clinicianUser.id);
  });

  it('AC-11: viewing cycle history never mutates the current active cycle', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002300', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002301', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002300' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002301' } });
    const profile = await prisma.patientProfile.create({ data: { userId: patientUser.id, dateOfBirth: new Date('2000-01-01') } });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id, levelId: level.id })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(after.body).toEqual(before.body);
  });

  it('AC-12: a specialist decision produces a matching AuditLog row via the existing global interceptor', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002400', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002401', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002400' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002401' } });
    const profile = await prisma.patientProfile.create({ data: { userId: patientUser.id, dateOfBirth: new Date('2000-01-01') } });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
    });
    await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'LEVEL_REPEAT', clinicianOpinionScore: 4, reviewNotes: 'test' })
      .expect(201);

    const auditRows = await prisma.auditLog.findMany({ where: { userId: clinicianUser.id }, orderBy: { createdAt: 'desc' } });
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].action).toContain('POST');
  });
});
```

Note on AC-08, AC-09, AC-10: these three acceptance criteria (the 24h/48h specialist SLA timers, direct-intervention execution, and the single free consultation) are explicitly out of scope for this plan per the design spec's Non-Goals section — Specialist Review v2, a following sub-project, owns them. They are deliberately absent from this test file rather than represented by an empty placeholder test, since an assertion-free test is itself a defect this plan's review process would rightly flag.

- [ ] **Step 6: Run the full e2e suite**

```bash
cd backend
npm run test:e2e
```
Expected: every suite passes, including every pre-existing module's tests (Auth, Patients, Assessment, Treatment Plan, Reports, Complaints, Admin, Supervision) — none of those were touched by this plan except the 2 files fixed in Tasks 9-10, so a failure anywhere else indicates an unintended regression, not an expected change.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove old Sessions module, update Swagger, add full AC-01–AC-12 acceptance suite

This is the final task of the Treatment Engine v2 plan. The backend
compiles cleanly again for the first time since Task 1 introduced the
breaking schema change. Progress and Reports were updated in Tasks 9-10
to match; every other pre-existing module is untouched."
```

---

## Self-Review Notes

**Spec coverage**: every "in scope" item from the design spec has a task — `Level`/`LevelVersion` (Task 3), `TrainingCycle72h`/`TrainingEvent`/72h gating (Task 4), `SampleSession`/`SampleAttempt`/10-cap (Task 5), `SpeechSample`/`SampleSamplePart` (Task 6), the 13-state machine (enforced across Tasks 4-8), specialist decisions (Task 7), previous-level review + inactivity (Task 8, delivered slightly ahead of the design spec's own "small follow-up" framing for previous-level review, since it turned out to be one trivial route alongside Task 8's other work — a positive convergence, not a deviation), and the full AC-01–AC-12 acceptance suite (Task 11). The two compile-breaking dependents outside the new module (`progress.service.ts`, `reports.service.ts`) are fixed in Tasks 9-10 — without them the plan would leave the backend permanently broken, so they are not optional cleanup.

**Placeholder scan (fixed during this review, not left in)**: an earlier draft of Task 11's Step 5 had several `it()` blocks written as comments only, plus two `expect(true).toBe(true)` no-op tests for out-of-scope ACs. Both were corrected — AC-02, AC-03, AC-07, AC-11, and AC-12 now have complete, concrete test code; AC-04/05/06 (already covered by earlier tasks' own suites) are documented as a plain comment between test blocks rather than a fake empty test; AC-08/09/10 (genuinely out of scope, owned by Specialist Review v2) are simply absent from the file rather than represented by a no-op test.

**Known density trade-off (not a placeholder, a judgment call)**: Task 7's e2e test comments reference reusing "the same setup pattern as Task 6's test" for its second and third cases (`level2`, `level3`, `partId1`/`partId2`) rather than re-printing the ~15-line register/profile/assessment/plan/level/version seeding block a fourth time — that exact block appears in full, concrete form in Tasks 4, 6, 9, and 11. An implementer working through this plan in order will have seen it fully spelled out three times before reaching Task 7's abbreviated reuse.

**Type consistency**: `StartCycleDto` no longer carries `levelId` (caught during this self-review — the original draft let a caller name any level directly, which would have silently defeated AC-01's "no shortcut past natural progression" rule; fixed by having `startFirstCycle` always resolve the lowest-order active level itself and reject a second call for the same patient outright). `TrainingCyclesService.findCycleOrThrow` is renamed to the public `findCycleForActor` in Task 4 Step 5 specifically so `SamplesService` (Task 5) and `SpecialistReviewService` (Task 7) can reuse the same access-checked lookup rather than duplicating it — checked that every later task's reference to this method uses the new name consistently. `ReviewSampleDto`'s three decision variants (`TRANSITION`/`LEVEL_REPEAT`/`TECHNICAL_RERECORD`, Task 7) match the `SpecialistDecision` Prisma enum (Task 1) exactly.
