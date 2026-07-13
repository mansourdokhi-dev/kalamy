# Specialist Review v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the review-queue mechanics, 24h/48h SLA timers, direct intervention, responsibility transfer, and the one free consultation — the pieces Treatment Engine v2 deliberately deferred (design spec `docs/superpowers/specs/2026-07-08-treatment-engine-v2-design.md`), governed by `docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md` §9, §11, §12, §63–§71.

**Architecture:** Extend `SpeechSample` with reservation/escalation/intervention fields (same model that already holds the basic decision fields) and a new cross-patient `SpecialistReviewQueueController` for actions that aren't scoped to one patient (list available samples, reserve, intervention, transfer). A new standalone `Consultation` model + module handles the one free consultation, reusing the existing `PatientAccessService`/DTO/permission conventions. SLA deadlines are evaluated lazily inside a single shared helper method, called at the top of every service method that touches a reviewable sample — mirroring the existing `CLOSED_DUE_TO_INACTIVITY` lazy-check pattern in `training-cycles.service.ts`.

**Tech Stack:** NestJS + Prisma + Zod (`nestjs-zod`) — unchanged libraries, matching every prior backend module in this project.

## Global Constraints

- Backend DTOs use `nestjs-zod`'s `createZodDto` pattern exactly as existing DTOs do; for discriminated unions, use the type-alias + const pattern already established in `dto/review-sample.dto.ts` (a `class extends` on a discriminated-union base doesn't type-check).
- Every backend endpoint is guarded by `@UseGuards(SessionGuard, PermissionsGuard)` at the controller level and `@RequirePermission(Permission.X)` per method.
- Backend e2e tests live in `backend/test/*.e2e-spec.ts`, run against a real Postgres via `npm run test:e2e -- <pattern>`. Each `describe` block re-declares its own local `registerAndLogin`-style helper rather than sharing a utils file (see `test/treatment-engine-specialist-review.e2e-spec.ts` for the exact pattern to copy).
- Time-based tests backdate a real timestamp field directly via `prisma.<model>.update({ data: { someDateField: new Date(Date.now() - N * 60 * 60 * 1000) } })` — this codebase has no fake-timer convention for e2e tests (confirmed in `test/treatment-engine-acceptance-criteria.e2e-spec.ts` and `test/treatment-engine-inactivity.e2e-spec.ts`).
- `CLINICIAN`, `SUPERVISOR`, and `ADMIN` roles already have unconditional cross-patient access via `PatientAccessService.assertCanAccess` (confirmed by reading `backend/src/common/patient-access/patient-access.service.ts` — those three roles return immediately with no per-patient assignment check). This means the "any qualified specialist, no pre-assignment" rule (§9) requires no new access-control mechanism — the existing `PatientAccessService`/`findCycleForActor` already behaves this way for staff roles.
- No real-time video/voice call infrastructure, no in-app messaging, no paid consultations, no background job scheduler — all four were explicitly ruled out of scope during brainstorming (see the design spec's "Scope decisions made with the founder" section). Do not add any of these.
- `SpeechSample` already has a `submittedAt: DateTime?` field (distinct from `createdAt`) — use it as the 24h-before-reservation clock start. Do not add a duplicate field.

---

### Task 1: Prisma schema — reservation/escalation/intervention fields + Consultation model

**Files:**
- Modify: `backend/prisma/schema.prisma` (`SpeechSample` model, `User` model — adding required relation names to an *existing* relation is part of this task, not optional)
- Test: none (schema/migration only — exercised by every later task's e2e tests)

**Interfaces:**
- Produces: `SpeechSample.reservedByUserId/reservedAt/reviewDeadlineAt/escalatedAt/interventionType/interventionRequestedAt/interventionDeadlineAt/interventionExecutedByUserId/interventionCompletedAt/interventionOutcomeNotes`; new `InterventionType` enum; new `Consultation` model with `ConsultationType`/`ConsultationStatus` enums. Task 3 onward consume these exact field names.

- [ ] **Step 1: Add the relation-name to the existing `reviewedByUser` relation and its `User` back-reference**

Adding two more `User` foreign keys to `SpeechSample` (below) means Prisma requires *every* relation between the same two models to be explicitly named — including the one that already exists unnamed. In `backend/prisma/schema.prisma`, find the current `SpeechSample` model's line:

```prisma
  reviewedByUserId            String?
  reviewedByUser               User?              @relation(fields: [reviewedByUserId], references: [id])
```

Replace with:

```prisma
  reviewedByUserId            String?
  reviewedByUser               User?              @relation("SpeechSampleReviewedBy", fields: [reviewedByUserId], references: [id])
```

In the `User` model, find:

```prisma
  reviewedSpeechSamples   SpeechSample[]
```

Replace with:

```prisma
  reviewedSpeechSamples   SpeechSample[] @relation("SpeechSampleReviewedBy")
```

- [ ] **Step 2: Add the new `SpeechSample` fields and their `User` relations**

In `backend/prisma/schema.prisma`, add these fields to the `SpeechSample` model (anywhere after the existing `reviewedAt` field, before `createdAt`):

```prisma
  reservedByUserId             String?
  reservedByUser                User?              @relation("SpeechSampleReservedBy", fields: [reservedByUserId], references: [id])
  reservedAt                    DateTime?
  reviewDeadlineAt              DateTime?
  escalatedAt                   DateTime?

  interventionType              InterventionType?
  interventionRequestedAt       DateTime?
  interventionDeadlineAt        DateTime?
  interventionExecutedByUserId  String?
  interventionExecutedByUser     User?              @relation("SpeechSampleInterventionExecutedBy", fields: [interventionExecutedByUserId], references: [id])
  interventionCompletedAt       DateTime?
  interventionOutcomeNotes      String?
```

Add the new enum near `SpecialistDecision`:

```prisma
enum InterventionType {
  VIDEO_MEETING
  VOICE_CONSULTATION
  TARGETED_MESSAGE
  CLINICAL_ACTION
}
```

In the `User` model, add the two new back-relation arrays (alongside `reviewedSpeechSamples`):

```prisma
  reservedSpeechSamples        SpeechSample[] @relation("SpeechSampleReservedBy")
  interventionsExecuted        SpeechSample[] @relation("SpeechSampleInterventionExecutedBy")
```

- [ ] **Step 3: Add the `Consultation` model**

In `backend/prisma/schema.prisma`, add a new model (e.g. after `SampleSamplePart`):

```prisma
model Consultation {
  id                  String             @id @default(uuid())
  patientProfileId    String
  patientProfile      PatientProfile     @relation(fields: [patientProfileId], references: [id])
  requestedByUserId   String
  requestedByUser     User               @relation("ConsultationRequestedBy", fields: [requestedByUserId], references: [id])
  type                ConsultationType
  status              ConsultationStatus @default(REQUESTED)
  reasonNote          String?
  scheduledAt         DateTime?
  externalMeetingLink String?
  specialistUserId    String?
  specialistUser      User?              @relation("ConsultationSpecialist", fields: [specialistUserId], references: [id])
  outcomeNotes        String?
  completedAt         DateTime?
  cancelledAt         DateTime?
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  @@index([patientProfileId])
}

enum ConsultationType {
  VIDEO
  VOICE
}

enum ConsultationStatus {
  REQUESTED
  SCHEDULING
  SCHEDULED
  COMPLETED
  CANCELLED
}
```

In the `PatientProfile` model, add the back-relation (unnamed is fine — only one relation exists between `PatientProfile` and `Consultation`):

```prisma
  consultations Consultation[]
```

In the `User` model, add the two new back-relation arrays:

```prisma
  consultationsRequested       Consultation[] @relation("ConsultationRequestedBy")
  consultationsAsSpecialist    Consultation[] @relation("ConsultationSpecialist")
```

- [ ] **Step 4: Generate and apply the migration**

Run (from `backend/`): `npx prisma migrate dev --name add_specialist_review_v2`
Expected: a new migration folder under `backend/prisma/migrations/`, applied cleanly with no data-loss warnings (all new fields/model are nullable or have defaults, all relation renames are metadata-only and don't affect stored data).

- [ ] **Step 5: Regenerate the Prisma client and confirm the project still builds**

Run: `npm run prisma:generate` (from `backend/`)
Expected: "Generated Prisma Client" with no errors.
Run: `npm run build` (from `backend/`)
Expected: builds successfully.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add reservation/escalation/intervention fields to SpeechSample and a Consultation model"
```

---

### Task 2: RBAC — `TRANSFER_REVIEW_RESPONSIBILITY` permission

**Files:**
- Modify: `backend/src/common/rbac/permissions.ts`
- Test: `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts` (new file, created in Task 3 — this task's permission grant is exercised there since Task 3 is the first task to add e2e coverage for this module)

**Interfaces:**
- Produces: `Permission.TRANSFER_REVIEW_RESPONSIBILITY`, granted only to `SUPERVISOR`. Task 6 (transfer endpoint) consumes this.

- [ ] **Step 1: Add the permission**

In `backend/src/common/rbac/permissions.ts`, add to the `Permission` enum (after `REVIEW_SAMPLE`):

```typescript
  REVIEW_SAMPLE = 'REVIEW_SAMPLE',
  TRANSFER_REVIEW_RESPONSIBILITY = 'TRANSFER_REVIEW_RESPONSIBILITY',
```

Add it to the `SUPERVISOR` array in `ROLE_PERMISSIONS` only (after `Permission.VIEW_CYCLE`):

```typescript
  SUPERVISOR: [
    Permission.VIEW_PATIENT_PROFILE,
    Permission.SEARCH_PATIENTS,
    Permission.VIEW_EXERCISE,
    Permission.VIEW_ASSESSMENT,
    Permission.VIEW_TREATMENT_PLAN,
    Permission.VIEW_PROGRESS,
    Permission.VIEW_COMPLAINT,
    Permission.MANAGE_COMPLAINTS,
    Permission.VIEW_PATIENT_REPORTS,
    Permission.VIEW_ADMIN_REPORTS,
    Permission.VIEW_SUPERVISION,
    Permission.VIEW_LEVELS,
    Permission.VIEW_CYCLE,
    Permission.TRANSFER_REVIEW_RESPONSIBILITY,
  ],
```

Do **not** add it to `CLINICIAN` or `ADMIN` — per §12, only a supervisor executes a responsibility transfer.

- [ ] **Step 2: Run the existing RBAC/permission unit test (if any) and the full backend build**

Run: `npm run build` (from `backend/`)
Expected: builds successfully — confirms the enum addition compiles everywhere it's referenced.

- [ ] **Step 3: Commit**

```bash
git add backend/src/common/rbac/permissions.ts
git commit -m "feat: add TRANSFER_REVIEW_RESPONSIBILITY permission for supervisors"
```

---

### Task 3: SLA deadline evaluation + available-samples queue + reserve

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts` (add `evaluateReviewDeadlines`, `listAvailableSamples`, `reserve`)
- Create: `backend/src/modules/treatment-engine/specialist-review-queue.controller.ts`
- Test: Create `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`

**Interfaces:**
- Consumes: `TrainingCyclesService` (existing), `PrismaService` (existing).
- Produces: `SpecialistReviewService.evaluateReviewDeadlines(cycleId: string): Promise<{ cycle: TrainingCycle72h; sample: SpeechSample }>` (fetches fresh, applies any due escalation/auto-release, returns the up-to-date rows — Task 4/5/6 all call this first, before acting); `listAvailableSamples(): Promise<Array<TrainingCycle72h & { speechSample: SpeechSample; patientProfile: { id: string; fullName: string } }>>`; `reserve(cycleId: string, actor: AuthenticatedUser): Promise<SpeechSample>`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`:

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

async function createSubmittedSampleCycle(prisma: PrismaService, patientProfileId: string, treatmentPlanId: string, clinicianUserId: string) {
  const level = await prisma.level.create({ data: { name: `Level ${Date.now()}`, order: Math.floor(Math.random() * 100000) } });
  const levelVersion = await prisma.levelVersion.create({
    data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
  });
  const cycle = await prisma.trainingCycle72h.create({
    data: {
      patientProfileId,
      treatmentPlanId,
      levelId: level.id,
      levelVersionId: levelVersion.id,
      cycleNumber: 1,
      status: 'WAITING_FOR_SPECIALIST',
    },
  });
  const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
  return { cycle, sample };
}

describe('Treatment Engine — Specialist review queue (e2e)', () => {
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

  async function setupPatientAndPlan(prisma: PrismaService, patientMobile: string, clinicianUserId: string) {
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Queue Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `QUEUE-${Date.now()}-${Math.random()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    return { patientToken, patientProfile, plan };
  }

  it('lists a submitted sample as available to any clinician, with no pre-assignment', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005000', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005000' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005001', clinicianUserId);
    const { cycle } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);

    const res = await request(app.getHttpServer())
      .get('/api/v1/specialist-review/available-samples')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    expect(res.body.map((c: any) => c.id)).toContain(cycle.id);
  });

  it('escalates a sample still unreserved after 24 hours', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005010', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005010' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005011', clinicianUserId);
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);
    await prisma.speechSample.update({ where: { id: sample.id }, data: { submittedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    const res = await request(app.getHttpServer())
      .get('/api/v1/specialist-review/available-samples')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    const entry = res.body.find((c: any) => c.id === cycle.id);
    expect(entry.speechSample.escalatedAt).not.toBeNull();
  });

  it('reserves a sample for the first clinician to open it, and blocks a second', async () => {
    const clinicianAToken = await registerAndLogin(app, prisma, '+966500005020', 'CLINICIAN');
    const clinicianBToken = await registerAndLogin(app, prisma, '+966500005021', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005020' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005022', clinicianUserId);
    const { cycle } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);

    const reserveRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .expect(201);
    expect(reserveRes.body.reservedByUserId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianBToken}`)
      .expect(409);

    const afterReserve = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(afterReserve.status).toBe('UNDER_REVIEW');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-specialist-review-queue` (from `backend/`)
Expected: FAIL — the route `GET /api/v1/specialist-review/available-samples` and `POST /api/v1/specialist-review/cycles/:cycleId/reserve` don't exist yet (404s).

- [ ] **Step 3: Add the SLA constants and `evaluateReviewDeadlines` to `specialist-review.service.ts`**

In `backend/src/modules/treatment-engine/specialist-review.service.ts`, add near the top (after imports):

```typescript
const REVIEW_BOOKING_WINDOW_MS = 24 * 60 * 60 * 1000; // §9: escalate if unreserved 24h after submission
const REVIEW_DECISION_WINDOW_MS = 48 * 60 * 60 * 1000; // §9: auto-release if undecided 48h after reservation
```

Add this method to the `SpecialistReviewService` class:

```typescript
  /**
   * Applies any SLA transition that is due as of now (escalation or auto-release),
   * then returns the fresh cycle+sample. Called first by every method that acts on
   * a reviewable sample, mirroring the lazy CLOSED_DUE_TO_INACTIVITY check in
   * TrainingCyclesService.getCurrent — no background job exists for this (see design
   * spec's scope decision on lazy SLA evaluation).
   */
  async evaluateReviewDeadlines(cycleId: string): Promise<{ cycle: TrainingCycle72h; sample: SpeechSample }> {
    const cycle = await this.prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
    if (!sample) {
      // Every status this method is ever called for (WAITING_FOR_SPECIALIST onward) implies a
      // submitted sample already exists — this is a genuine invariant violation, not a normal
      // "not found" a caller should handle differently, so every caller's own re-fetch-and-throw
      // never actually needs to run. Fail loudly rather than silently returning a fake value.
      throw new NotFoundException('No submitted sample found for this cycle');
    }

    if (
      cycle.status === 'WAITING_FOR_SPECIALIST' &&
      sample.submittedAt &&
      !sample.reservedByUserId &&
      !sample.escalatedAt &&
      Date.now() - sample.submittedAt.getTime() > REVIEW_BOOKING_WINDOW_MS
    ) {
      const updatedSample = await this.prisma.speechSample.update({ where: { id: sample.id }, data: { escalatedAt: new Date() } });
      return { cycle, sample: updatedSample };
    }

    const inDecisionWindow = cycle.status === 'UNDER_REVIEW' || cycle.status === 'WAITING_FINAL_DECISION_AFTER_INTERVENTION';
    if (inDecisionWindow && sample.reviewDeadlineAt && Date.now() > sample.reviewDeadlineAt.getTime()) {
      const releasedFromUserId = sample.reservedByUserId;
      const { updatedCycle, updatedSample } = await this.prisma.$transaction(async (tx) => {
        const updatedCycle = await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FOR_SPECIALIST' } });
        const updatedSample = await tx.speechSample.update({
          where: { id: sample.id },
          data: { reservedByUserId: null, reservedAt: null, reviewDeadlineAt: null },
        });
        await tx.auditLog.create({
          data: {
            userId: releasedFromUserId,
            action: 'REVIEW_RESERVATION_AUTO_RELEASED',
            entity: 'SpeechSample',
            entityId: sample.id,
            before: { reservedByUserId: releasedFromUserId },
            after: { reservedByUserId: null },
          },
        });
        return { updatedCycle, updatedSample };
      });
      return { cycle: updatedCycle, sample: updatedSample };
    }

    if (
      cycle.status === 'DIRECT_INTERVENTION_REQUIRED' &&
      sample.interventionDeadlineAt &&
      !sample.escalatedAt &&
      Date.now() > sample.interventionDeadlineAt.getTime()
    ) {
      const updatedSample = await this.prisma.speechSample.update({ where: { id: sample.id }, data: { escalatedAt: new Date() } });
      return { cycle, sample: updatedSample };
    }

    return { cycle, sample };
  }
```

- [ ] **Step 4: Add `listAvailableSamples` and `reserve` to `specialist-review.service.ts`**

Add these methods to the same class:

```typescript
  async listAvailableSamples(): Promise<Array<TrainingCycle72h & { speechSample: SpeechSample | null; patientProfile: { id: string; fullName: string } }>> {
    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { status: 'WAITING_FOR_SPECIALIST' },
      include: { speechSample: true, patientProfile: { select: { id: true, fullName: true } } },
      orderBy: { updatedAt: 'asc' },
    });
    const evaluated = await Promise.all(cycles.map((c) => this.evaluateReviewDeadlines(c.id)));
    return cycles.map((c, i) => ({ ...c, speechSample: evaluated[i].sample }));
  }

  async reserve(cycleId: string, actor: AuthenticatedUser): Promise<SpeechSample> {
    await this.evaluateReviewDeadlines(cycleId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "TrainingCycle72h" WHERE id = ${cycleId} FOR UPDATE`;

      const cycle = await tx.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
      if (cycle.status !== 'WAITING_FOR_SPECIALIST') {
        throw new ConflictException(`Cannot reserve a cycle in status ${cycle.status}`);
      }
      const sample = await tx.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
      if (!sample) {
        throw new NotFoundException('No submitted sample found for this cycle');
      }
      if (sample.reservedByUserId) {
        throw new ConflictException('This sample is already reserved by another specialist');
      }

      await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'UNDER_REVIEW' } });
      return tx.speechSample.update({
        where: { id: sample.id },
        data: {
          reservedByUserId: actor.id,
          reservedAt: new Date(),
          reviewDeadlineAt: new Date(Date.now() + REVIEW_DECISION_WINDOW_MS),
          escalatedAt: null,
        },
      });
    });
  }
```

Add the missing import at the top of the file: `import { AuthenticatedUser } from '../../common/auth/session.guard';` (if not already imported — check first, `ReviewSampleDto`'s file already imports this type elsewhere in this module, but `specialist-review.service.ts` itself needs its own import).

- [ ] **Step 5: Create the queue controller**

Create `backend/src/modules/treatment-engine/specialist-review-queue.controller.ts`:

```typescript
import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { SpecialistReviewService } from './specialist-review.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/specialist-review')
@UseGuards(SessionGuard, PermissionsGuard)
export class SpecialistReviewQueueController {
  constructor(private readonly specialistReviewService: SpecialistReviewService) {}

  @Get('available-samples')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async listAvailable() {
    return this.specialistReviewService.listAvailableSamples();
  }

  @Post('cycles/:cycleId/reserve')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async reserve(@Param('cycleId') cycleId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.specialistReviewService.reserve(cycleId, user);
  }
}
```

This controller is deliberately separate from `SpecialistReviewController` (which stays scoped under `api/v1/patients/:patientId/cycles/current`) because these actions are cross-patient — a specialist browsing the queue doesn't know the patient ID in advance.

- [ ] **Step 6: Register the controller in `treatment-engine.module.ts`**

In `backend/src/modules/treatment-engine/treatment-engine.module.ts`, add the import:

```typescript
import { SpecialistReviewQueueController } from './specialist-review-queue.controller';
```

Add it to the `controllers` array:

```typescript
  controllers: [LevelsController, TrainingCyclesController, SamplesController, SampleMediaController, SpecialistReviewController, SpecialistReviewQueueController],
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-specialist-review-queue` (from `backend/`)
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-review.service.ts backend/src/modules/treatment-engine/specialist-review-queue.controller.ts backend/src/modules/treatment-engine/treatment-engine.module.ts backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts
git commit -m "feat: add specialist review queue — list available samples, reserve with 24h escalation and 48h auto-release"
```

---

### Task 4: Reservation ownership guard on `review()` + widen for post-intervention decisions

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts` (`review` method)
- Test: `backend/test/treatment-engine-specialist-review.e2e-spec.ts` (existing file — add new tests, update existing ones if they now need a `reserve` call first)

**Interfaces:**
- Consumes: `reserve` (Task 3).
- Produces: `review()` now (a) only allows the specialist holding the current reservation to submit a decision, and (b) accepts `WAITING_FINAL_DECISION_AFTER_INTERVENTION` as a valid starting status alongside `WAITING_FOR_SPECIALIST`/`UNDER_REVIEW`.

- [ ] **Step 1: Read the existing test file and update its fixtures**

Read `backend/test/treatment-engine-specialist-review.e2e-spec.ts` in full. Every existing test currently creates a cycle directly with `status: 'WAITING_FOR_SPECIALIST'` and calls `POST .../review` immediately — since `review()` will now require the calling clinician to hold the reservation, each existing test must first call the reserve endpoint (Task 3) as the same clinician before calling review, e.g. change:

```typescript
    const cycle = await prisma.trainingCycle72h.create({
      data: { /* ... */ status: 'WAITING_FOR_SPECIALIST' },
    });
    await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });

    const reviewRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
```

to:

```typescript
    const cycle = await prisma.trainingCycle72h.create({
      data: { /* ... */ status: 'WAITING_FOR_SPECIALIST' },
    });
    await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    const reviewRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
```

Apply this same `reserve`-before-`review` change to every test in the file that currently calls `POST .../review` directly from a freshly-created `WAITING_FOR_SPECIALIST` cycle.

- [ ] **Step 2: Add new failing tests for the ownership guard**

Add to the same file:

```typescript
  it('rejects a review decision from a clinician who does not hold the reservation', async () => {
    const clinicianAToken = await registerAndLogin(app, prisma, '+966500004100', 'CLINICIAN');
    const clinicianBToken = await registerAndLogin(app, prisma, '+966500004101', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004100' } })).id;
    const patientToken = await registerAndLogin(app, prisma, '+966500004102', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500004102' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Ownership Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'OWNERSHIP-TEST-1' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Ownership Level', order: 90001 } });
    const levelVersion = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
    });
    await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianBToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'x' })
      .expect(403);
  });
```

- [ ] **Step 3: Run tests to verify the new one fails, and the updated existing ones fail too**

Run: `npm run test:e2e -- treatment-engine-specialist-review` (from `backend/` — note this matches both `treatment-engine-specialist-review.e2e-spec.ts` and `treatment-engine-specialist-review-queue.e2e-spec.ts`; that's fine, both should be exercised)
Expected: FAIL — `review()` doesn't check reservation ownership yet, so the ownership test gets 201 instead of 403; the updated existing tests should still pass at this point since they only added a reserve call, not changed behavior yet — if any of those fail, re-check the diff against this step, don't proceed until only the new ownership test fails.

- [ ] **Step 4: Update `review()`'s guard**

In `backend/src/modules/treatment-engine/specialist-review.service.ts`, find:

```typescript
  async review(cycleId: string, dto: ReviewSampleDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'WAITING_FOR_SPECIALIST' && cycle.status !== 'UNDER_REVIEW') {
      throw new ConflictException(`Cannot review a cycle in status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId }, include: { parts: true } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }
```

Replace with:

```typescript
  async review(cycleId: string, dto: ReviewSampleDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    await this.evaluateReviewDeadlines(cycleId);
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const reviewableStatuses = ['WAITING_FOR_SPECIALIST', 'UNDER_REVIEW', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'];
    if (!reviewableStatuses.includes(cycle.status)) {
      throw new ConflictException(`Cannot review a cycle in status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId }, include: { parts: true } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }
    if (sample.reservedByUserId && sample.reservedByUserId !== actor.id) {
      throw new ForbiddenException('This sample is reserved by a different specialist');
    }
```

Add `ForbiddenException` to the existing `@nestjs/common` import at the top of the file:

```typescript
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
```

Note: a `WAITING_FOR_SPECIALIST` cycle with no reservation yet is still reviewable directly (the pre-Task-3 behavior — a clinician can call `review()` without having called `reserve()` first, since `reserve()` is a new convenience/locking step, not a hard requirement to review at all). Only *block* a decision when the sample is reserved by *someone else*.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-specialist-review` (from `backend/`)
Expected: PASS (all tests in both `treatment-engine-specialist-review.e2e-spec.ts` and `treatment-engine-specialist-review-queue.e2e-spec.ts`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-review.service.ts backend/test/treatment-engine-specialist-review.e2e-spec.ts
git commit -m "feat: enforce reservation ownership on review decisions, allow deciding after intervention"
```

---

### Task 5: Direct intervention — request and complete

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts` (add `requestIntervention`, `completeIntervention`)
- Modify: `backend/src/modules/treatment-engine/specialist-review-queue.controller.ts` (add two endpoints)
- Create: `backend/src/modules/treatment-engine/dto/request-intervention.dto.ts`
- Create: `backend/src/modules/treatment-engine/dto/complete-intervention.dto.ts`
- Test: `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`

**Interfaces:**
- Consumes: `evaluateReviewDeadlines` (Task 3).
- Produces: `requestIntervention(cycleId, dto: RequestInterventionDto, actor): Promise<SpeechSample>`; `completeIntervention(cycleId, dto: CompleteInterventionDto, actor): Promise<SpeechSample>`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`:

```typescript
  it('pauses the review deadline during a direct intervention, then starts a fresh one on completion', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005030', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005030' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005031', clinicianUserId);
    const { cycle } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    const interventionRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ interventionType: 'VOICE_CONSULTATION', reasonNote: 'Needs clarification on hand-sync' })
      .expect(201);
    expect(interventionRes.body.interventionType).toBe('VOICE_CONSULTATION');
    expect(interventionRes.body.reviewDeadlineAt).toBeNull();

    const afterRequest = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(afterRequest.status).toBe('DIRECT_INTERVENTION_REQUIRED');

    const completeRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention/complete`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ outcomeNotes: 'Patient understands hand-sync now' })
      .expect(201);
    expect(completeRes.body.interventionCompletedAt).not.toBeNull();
    expect(completeRes.body.reviewDeadlineAt).not.toBeNull();

    const afterComplete = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(afterComplete.status).toBe('WAITING_FINAL_DECISION_AFTER_INTERVENTION');
  });

  it('escalates an intervention not executed within 7 days', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005040', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005040' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005041', clinicianUserId);
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ interventionType: 'VIDEO_MEETING', reasonNote: 'x' })
      .expect(201);

    await prisma.speechSample.update({
      where: { id: sample.id },
      data: { interventionRequestedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), interventionDeadlineAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
    });

    // Nothing has triggered a lazy evaluation yet, so the 7-day-overdue intervention
    // hasn't been flagged — confirm the starting state before the action that does trigger it.
    const sampleBefore = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(sampleBefore.escalatedAt).toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention/complete`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ outcomeNotes: 'late but done' })
      .expect(201);

    const sampleAfterComplete = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(sampleAfterComplete.escalatedAt).not.toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-specialist-review-queue` (from `backend/`)
Expected: FAIL — the two new routes don't exist (404s).

- [ ] **Step 3: Create the DTOs**

Create `backend/src/modules/treatment-engine/dto/request-intervention.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RequestInterventionSchema = z.object({
  interventionType: z.enum(['VIDEO_MEETING', 'VOICE_CONSULTATION', 'TARGETED_MESSAGE', 'CLINICAL_ACTION']),
  reasonNote: z.string().min(1),
});

export class RequestInterventionDto extends createZodDto(RequestInterventionSchema) {}
```

Create `backend/src/modules/treatment-engine/dto/complete-intervention.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CompleteInterventionSchema = z.object({
  outcomeNotes: z.string().min(1),
});

export class CompleteInterventionDto extends createZodDto(CompleteInterventionSchema) {}
```

- [ ] **Step 4: Add `requestIntervention` and `completeIntervention` to `specialist-review.service.ts`**

Add near `reserve`:

```typescript
  async requestIntervention(cycleId: string, dto: RequestInterventionDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    await this.evaluateReviewDeadlines(cycleId);
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'UNDER_REVIEW') {
      throw new ConflictException(`Cannot request intervention from status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }
    if (sample.reservedByUserId !== actor.id) {
      throw new ForbiddenException('Only the specialist holding the reservation can request intervention');
    }

    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'DIRECT_INTERVENTION_REQUIRED' } });
    return this.prisma.speechSample.update({
      where: { id: sample.id },
      data: {
        interventionType: dto.interventionType,
        interventionRequestedAt: new Date(),
        interventionDeadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        interventionOutcomeNotes: dto.reasonNote,
        // §11: the first review deadline is paused, not extended — a fresh 48h starts only once
        // the intervention is documented complete (see completeIntervention below).
        reviewDeadlineAt: null,
      },
    });
  }

  async completeIntervention(cycleId: string, dto: CompleteInterventionDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    await this.evaluateReviewDeadlines(cycleId);
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'DIRECT_INTERVENTION_REQUIRED') {
      throw new ConflictException(`Cannot complete intervention from status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }

    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FINAL_DECISION_AFTER_INTERVENTION' } });
    return this.prisma.speechSample.update({
      where: { id: sample.id },
      data: {
        interventionExecutedByUserId: actor.id,
        interventionCompletedAt: new Date(),
        interventionOutcomeNotes: dto.outcomeNotes,
        reviewDeadlineAt: new Date(Date.now() + REVIEW_DECISION_WINDOW_MS),
      },
    });
  }
```

Add the two new DTO imports at the top of `specialist-review.service.ts`:

```typescript
import { RequestInterventionDto } from './dto/request-intervention.dto';
import { CompleteInterventionDto } from './dto/complete-intervention.dto';
```

- [ ] **Step 5: Add the two endpoints to the queue controller**

In `backend/src/modules/treatment-engine/specialist-review-queue.controller.ts`, add the imports:

```typescript
import { Body } from '@nestjs/common';
import { RequestInterventionDto } from './dto/request-intervention.dto';
import { CompleteInterventionDto } from './dto/complete-intervention.dto';
```

(Merge `Body` into the existing `@nestjs/common` import line rather than adding a second one.)

Add the methods:

```typescript
  @Post('cycles/:cycleId/intervention')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async requestIntervention(@Param('cycleId') cycleId: string, @Body() dto: RequestInterventionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.specialistReviewService.requestIntervention(cycleId, dto, user);
  }

  @Post('cycles/:cycleId/intervention/complete')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async completeIntervention(@Param('cycleId') cycleId: string, @Body() dto: CompleteInterventionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.specialistReviewService.completeIntervention(cycleId, dto, user);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-specialist-review-queue` (from `backend/`)
Expected: PASS (5 tests total in this file so far).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-review.service.ts backend/src/modules/treatment-engine/specialist-review-queue.controller.ts backend/src/modules/treatment-engine/dto/request-intervention.dto.ts backend/src/modules/treatment-engine/dto/complete-intervention.dto.ts backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts
git commit -m "feat: add direct intervention request/complete with 7-day escalation"
```

---

### Task 6: Responsibility transfer (supervisor-only)

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts` (add `transferResponsibility`)
- Modify: `backend/src/modules/treatment-engine/specialist-review-queue.controller.ts` (add endpoint)
- Create: `backend/src/modules/treatment-engine/dto/transfer-review.dto.ts`
- Test: `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`

**Interfaces:**
- Consumes: `Permission.TRANSFER_REVIEW_RESPONSIBILITY` (Task 2).
- Produces: `transferResponsibility(cycleId, dto: TransferReviewDto, actor): Promise<SpeechSample>`. This is the first place in the codebase that writes to `AuditLog` for a supervisor-initiated action (the auto-release path in Task 3 was the first write overall).

- [ ] **Step 1: Write the failing test**

Add to `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`:

```typescript
  it('lets a supervisor transfer review responsibility to a different specialist, with an audit trail', async () => {
    const clinicianAToken = await registerAndLogin(app, prisma, '+966500005050', 'CLINICIAN');
    const clinicianBToken = await registerAndLogin(app, prisma, '+966500005051', 'CLINICIAN');
    const supervisorToken = await registerAndLogin(app, prisma, '+966500005052', 'SUPERVISOR');
    const clinicianAUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005050' } })).id;
    const clinicianBUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005051' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005053', clinicianAUserId);
    const { cycle } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianAUserId);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .expect(201);

    const transferRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/transfer`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ toUserId: clinicianBUserId, reason: 'Clinician A is on leave' })
      .expect(201);
    expect(transferRes.body.reservedByUserId).toBe(clinicianBUserId);

    // Clinician A can no longer decide; clinician B can.
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'x' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianBToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'x' })
      .expect(201);

    const auditEntries = await prisma.auditLog.findMany({ where: { action: 'REVIEW_RESPONSIBILITY_TRANSFERRED' } });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].before).toEqual({ reservedByUserId: clinicianAUserId });
    expect(auditEntries[0].after).toEqual({ reservedByUserId: clinicianBUserId });
  });

  it('rejects a transfer request from a clinician (not a supervisor)', async () => {
    const clinicianAToken = await registerAndLogin(app, prisma, '+966500005060', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500005061', 'CLINICIAN');
    const clinicianBUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005061' } })).id;
    const clinicianAUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005060' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005062', clinicianAUserId);
    const { cycle } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianAUserId);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/transfer`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .send({ toUserId: clinicianBUserId, reason: 'trying to self-transfer' })
      .expect(403);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-specialist-review-queue` (from `backend/`)
Expected: FAIL — the `POST .../transfer` route doesn't exist (404s).

- [ ] **Step 3: Create the DTO**

Create `backend/src/modules/treatment-engine/dto/transfer-review.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TransferReviewSchema = z.object({
  toUserId: z.string().uuid(),
  reason: z.string().min(1),
});

export class TransferReviewDto extends createZodDto(TransferReviewSchema) {}
```

- [ ] **Step 4: Add `transferResponsibility` to `specialist-review.service.ts`**

Add near `reserve`:

```typescript
  async transferResponsibility(cycleId: string, dto: TransferReviewDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }
    if (!['UNDER_REVIEW', 'DIRECT_INTERVENTION_REQUIRED', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'].includes(cycle.status)) {
      throw new ConflictException(`Cannot transfer responsibility from status ${cycle.status}`);
    }

    const previousReviewerUserId = sample.reservedByUserId;
    const [, updatedSample] = await this.prisma.$transaction([
      this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          action: 'REVIEW_RESPONSIBILITY_TRANSFERRED',
          entity: 'SpeechSample',
          entityId: sample.id,
          before: { reservedByUserId: previousReviewerUserId },
          after: { reservedByUserId: dto.toUserId },
        },
      }),
      this.prisma.speechSample.update({ where: { id: sample.id }, data: { reservedByUserId: dto.toUserId } }),
    ]);
    return updatedSample;
  }
```

Add the DTO import:

```typescript
import { TransferReviewDto } from './dto/transfer-review.dto';
```

- [ ] **Step 5: Add the endpoint to the queue controller**

In `backend/src/modules/treatment-engine/specialist-review-queue.controller.ts`, add the import:

```typescript
import { TransferReviewDto } from './dto/transfer-review.dto';
```

Add the method:

```typescript
  @Post('cycles/:cycleId/transfer')
  @RequirePermission(Permission.TRANSFER_REVIEW_RESPONSIBILITY)
  async transfer(@Param('cycleId') cycleId: string, @Body() dto: TransferReviewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.specialistReviewService.transferResponsibility(cycleId, dto, user);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-specialist-review-queue` (from `backend/`)
Expected: PASS (7 tests total in this file).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-review.service.ts backend/src/modules/treatment-engine/specialist-review-queue.controller.ts backend/src/modules/treatment-engine/dto/transfer-review.dto.ts backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts
git commit -m "feat: add supervisor-only responsibility transfer with audit trail"
```

---

### Task 7: Consultation module — request and manage the one free consultation

**Files:**
- Create: `backend/src/modules/consultations/consultations.service.ts`
- Create: `backend/src/modules/consultations/consultations.controller.ts`
- Create: `backend/src/modules/consultations/consultations.module.ts`
- Create: `backend/src/modules/consultations/dto/request-consultation.dto.ts`
- Create: `backend/src/modules/consultations/dto/update-consultation.dto.ts`
- Test: Create `backend/test/consultations.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientAccessService` (existing).
- Produces: `ConsultationsService.request(patientProfileId, dto: RequestConsultationDto, actor): Promise<Consultation>`; `ConsultationsService.update(consultationId, dto: UpdateConsultationDto, actor): Promise<Consultation>`; `ConsultationsService.listForPatient(patientProfileId, actor): Promise<Consultation[]>`.

- [ ] **Step 1: Add the two new permissions**

In `backend/src/common/rbac/permissions.ts`, add to the `Permission` enum:

```typescript
  REQUEST_CONSULTATION = 'REQUEST_CONSULTATION',
  MANAGE_CONSULTATION = 'MANAGE_CONSULTATION',
```

Add `Permission.REQUEST_CONSULTATION` to both `PATIENT` and `CAREGIVER` arrays (after `Permission.SUBMIT_SAMPLE` in each):

```typescript
    Permission.SUBMIT_SAMPLE,
    Permission.REQUEST_CONSULTATION,
```

Add `Permission.MANAGE_CONSULTATION` to `CLINICIAN`, `SUPERVISOR`, and `ADMIN` arrays (after `Permission.REVIEW_SAMPLE` where it exists, or after `Permission.VIEW_CYCLE` for `SUPERVISOR` which has no `REVIEW_SAMPLE`):

```typescript
    Permission.MANAGE_CONSULTATION,
```

- [ ] **Step 2: Write the failing tests**

Create `backend/test/consultations.e2e-spec.ts`:

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

describe('Consultations (e2e)', () => {
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

  async function setupPatient(mobile: string) {
    const token = await registerAndLogin(app, prisma, mobile, null);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
    const profile = await prisma.patientProfile.create({
      data: { userId, fullName: 'Consultation Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `CONSULT-${Date.now()}-${Math.random()}` },
    });
    return { token, profile };
  }

  it('lets a patient request their one free consultation, choosing video or voice', async () => {
    const { token, profile } = await setupPatient('+966500006000');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VOICE', reasonNote: 'Need help with hand-sync technique' })
      .expect(201);

    expect(res.body.type).toBe('VOICE');
    expect(res.body.status).toBe('REQUESTED');
  });

  it('rejects a second consultation request while one is still active', async () => {
    const { token, profile } = await setupPatient('+966500006010');

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VOICE', reasonNote: 'y' })
      .expect(409);
  });

  it('allows a new request after the previous consultation was cancelled, but not after it was completed', async () => {
    const { token, profile } = await setupPatient('+966500006020');
    const clinicianToken = await registerAndLogin(app, prisma, '+966500006021', 'CLINICIAN');

    const first = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${first.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VOICE', reasonNote: 'y' })
      .expect(201);

    const second = await prisma.consultation.findFirst({ where: { patientProfileId: profile.id, type: 'VOICE' } });
    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${second!.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'COMPLETED', outcomeNotes: 'Discussed technique, patient understands now' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'z' })
      .expect(409);
  });

  it('lets a clinician update scheduling details and the external meeting link', async () => {
    const { token, profile } = await setupPatient('+966500006030');
    const clinicianToken = await registerAndLogin(app, prisma, '+966500006031', 'CLINICIAN');

    const created = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${created.body.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), externalMeetingLink: 'https://meet.example.com/abc' })
      .expect(200);

    expect(updated.body.status).toBe('SCHEDULED');
    expect(updated.body.externalMeetingLink).toBe('https://meet.example.com/abc');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- consultations` (from `backend/`)
Expected: FAIL — no routes exist yet (404s).

- [ ] **Step 3: Create the DTOs**

Create `backend/src/modules/consultations/dto/request-consultation.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RequestConsultationSchema = z.object({
  type: z.enum(['VIDEO', 'VOICE']),
  reasonNote: z.string().min(1),
});

export class RequestConsultationDto extends createZodDto(RequestConsultationSchema) {}
```

Create `backend/src/modules/consultations/dto/update-consultation.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateConsultationSchema = z.object({
  status: z.enum(['SCHEDULING', 'SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  scheduledAt: z.string().datetime().optional(),
  externalMeetingLink: z.string().url().optional(),
  outcomeNotes: z.string().min(1).optional(),
});

export class UpdateConsultationDto extends createZodDto(UpdateConsultationSchema) {}
```

- [ ] **Step 4: Create the service**

Create `backend/src/modules/consultations/consultations.service.ts`:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Consultation, PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { RequestConsultationDto } from './dto/request-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';

@Injectable()
export class ConsultationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async request(patientProfileId: string, dto: RequestConsultationDto, actor: AuthenticatedUser): Promise<Consultation> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    return this.prisma.$transaction(async (tx) => {
      // Row-lock the patient profile so two concurrent requests can't both
      // pass the "no active consultation" check before either commits (§119).
      await tx.$queryRaw`SELECT id FROM "PatientProfile" WHERE id = ${patientProfileId} FOR UPDATE`;

      const activeOrCompleted = await tx.consultation.findFirst({
        where: { patientProfileId, status: { not: 'CANCELLED' } },
      });
      if (activeOrCompleted) {
        throw new ConflictException(
          activeOrCompleted.status === 'COMPLETED'
            ? 'The one free consultation has already been used'
            : `A consultation request is already ${activeOrCompleted.status.toLowerCase()}`,
        );
      }

      return tx.consultation.create({
        data: {
          patientProfileId,
          requestedByUserId: actor.id,
          type: dto.type,
          reasonNote: dto.reasonNote,
        },
      });
    });
  }

  async update(consultationId: string, dto: UpdateConsultationDto, actor: AuthenticatedUser): Promise<Consultation> {
    const consultation = await this.prisma.consultation.findUnique({ where: { id: consultationId } });
    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }
    const profile = await this.findPatientProfileOrThrow(consultation.patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    return this.prisma.consultation.update({
      where: { id: consultationId },
      data: {
        status: dto.status,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        externalMeetingLink: dto.externalMeetingLink,
        outcomeNotes: dto.outcomeNotes,
        specialistUserId: dto.status ? actor.id : undefined,
        completedAt: dto.status === 'COMPLETED' ? new Date() : undefined,
        cancelledAt: dto.status === 'CANCELLED' ? new Date() : undefined,
      },
    });
  }

  async listForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<Consultation[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);
    return this.prisma.consultation.findMany({ where: { patientProfileId }, orderBy: { createdAt: 'desc' } });
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

- [ ] **Step 5: Create the controller**

Create `backend/src/modules/consultations/consultations.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { RequestConsultationDto } from './dto/request-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';

@Controller('api/v1')
@UseGuards(SessionGuard, PermissionsGuard)
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  @Post('patients/:patientId/consultations')
  @RequirePermission(Permission.REQUEST_CONSULTATION)
  async request(@Param('patientId') patientId: string, @Body() dto: RequestConsultationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.consultationsService.request(patientId, dto, user);
  }

  @Get('patients/:patientId/consultations')
  @RequirePermission(Permission.REQUEST_CONSULTATION)
  async list(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.consultationsService.listForPatient(patientId, user);
  }

  @Patch('consultations/:consultationId')
  @RequirePermission(Permission.MANAGE_CONSULTATION)
  async update(@Param('consultationId') consultationId: string, @Body() dto: UpdateConsultationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.consultationsService.update(consultationId, dto, user);
  }
}
```

Note: `list` is guarded by `Permission.REQUEST_CONSULTATION` (the patient/caregiver permission) rather than a separate view permission — matching this module's minimal-scope pattern (a patient viewing their own consultation history is part of the same capability as requesting one; staff viewing/managing goes through `MANAGE_CONSULTATION` via the `update` endpoint and, if a later task needs a staff-side list, that can reuse `MANAGE_CONSULTATION` then).

- [ ] **Step 6: Create the module and register it**

Create `backend/src/modules/consultations/consultations.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';

@Module({
  imports: [AuthModule, PatientAccessModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
```

In `backend/src/app.module.ts`, add the import:

```typescript
import { ConsultationsModule } from './modules/consultations/consultations.module';
```

Add it to the `imports` array (after `TreatmentEngineModule`):

```typescript
    TreatmentEngineModule,
    ConsultationsModule,
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:e2e -- consultations` (from `backend/`)
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/consultations backend/src/common/rbac/permissions.ts backend/src/app.module.ts backend/test/consultations.e2e-spec.ts
git commit -m "feat: add Consultation module for the one free video/voice consultation"
```

---

### Task 8: Full acceptance-criteria suite (AC-08, AC-09, AC-10) + full backend verification

**Files:**
- Create: `backend/test/specialist-review-v2-acceptance-criteria.e2e-spec.ts`
- Test: none beyond this file (verification task)

**Interfaces:** N/A — this task is verification only, mirroring the pattern in `backend/test/treatment-engine-acceptance-criteria.e2e-spec.ts` for Treatment Engine v2's own AC-01–AC-07.

- [ ] **Step 1: Write the acceptance-criteria tests**

Create `backend/test/specialist-review-v2-acceptance-criteria.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(app: INestApplication, prisma: PrismaService, mobile: string, role: 'CLINICIAN' | 'SUPERVISOR' | null): Promise<string> {
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

async function fullSetup(app: INestApplication, prisma: PrismaService, suffix: string, clinicianUserId: string) {
  const patientToken = await registerAndLogin(app, prisma, `+96650000${suffix}0`, null);
  const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: `+96650000${suffix}0` } })).id;
  const profile = await prisma.patientProfile.create({
    data: { userId: patientUserId, fullName: 'AC Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `AC-TEST-${suffix}` },
  });
  const assessment = await prisma.assessment.create({ data: { patientProfileId: profile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' } });
  const plan = await prisma.treatmentPlan.create({
    data: { patientProfileId: profile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
  });
  const level = await prisma.level.create({ data: { name: `AC Level ${suffix}`, order: 70000 + Number(suffix) } });
  const levelVersion = await prisma.levelVersion.create({
    data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
  });
  const cycle = await prisma.trainingCycle72h.create({
    data: { patientProfileId: profile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
  });
  const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
  return { patientToken, profile, cycle, sample };
}

describe('Specialist Review v2 — Acceptance Criteria (e2e)', () => {
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

  it('AC-08: reservation auto-releases exactly at the 48-hour boundary, not before', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+9665000010', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+9665000010' } })).id;
    const { cycle, sample } = await fullSetup(app, prisma, '1', clinicianUserId);

    await request(app.getHttpServer()).post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`).set('Authorization', `Bearer ${clinicianToken}`).expect(201);

    // 47 hours: still reserved.
    await prisma.speechSample.update({ where: { id: sample.id }, data: { reservedAt: new Date(Date.now() - 47 * 60 * 60 * 1000), reviewDeadlineAt: new Date(Date.now() + 1 * 60 * 60 * 1000) } });
    let refreshed = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(refreshed.reservedByUserId).not.toBeNull();

    // 49 hours: released on next evaluation (triggered here by a second clinician's reserve attempt).
    await prisma.speechSample.update({ where: { id: sample.id }, data: { reservedAt: new Date(Date.now() - 49 * 60 * 60 * 1000), reviewDeadlineAt: new Date(Date.now() - 1 * 60 * 60 * 1000) } });
    const secondClinicianToken = await registerAndLogin(app, prisma, '+9665000011', 'CLINICIAN');
    await request(app.getHttpServer()).post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`).set('Authorization', `Bearer ${secondClinicianToken}`).expect(201);
    refreshed = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(refreshed.reservedByUserId).not.toBe(clinicianUserId);
  });

  it('AC-09: direct intervention pauses the review deadline, then a fresh 48h starts on completion', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+9665000020', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+9665000020' } })).id;
    const { cycle } = await fullSetup(app, prisma, '2', clinicianUserId);

    await request(app.getHttpServer()).post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`).set('Authorization', `Bearer ${clinicianToken}`).expect(201);
    const interventionRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ interventionType: 'TARGETED_MESSAGE', reasonNote: 'x' })
      .expect(201);
    expect(interventionRes.body.reviewDeadlineAt).toBeNull();

    const completeRes = await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention/complete`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ outcomeNotes: 'x' })
      .expect(201);
    const deadline = new Date(completeRes.body.reviewDeadlineAt).getTime();
    const expectedDeadline = Date.now() + 48 * 60 * 60 * 1000;
    expect(Math.abs(deadline - expectedDeadline)).toBeLessThan(60 * 1000);
  });

  it('AC-10: only one free consultation is ever available, video and voice draw from the same credit', async () => {
    const patientToken = await registerAndLogin(app, prisma, '+9665000030', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+9665000030' } })).id;
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Free Consult Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'AC-10-TEST' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ type: 'VIDEO', reasonNote: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/consultations`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ type: 'VOICE', reasonNote: 'y' })
      .expect(409);
  });
});
```

- [ ] **Step 2: Run this test file to verify it passes against the implementation from Tasks 1–7**

Run: `npm run test:e2e -- specialist-review-v2-acceptance-criteria` (from `backend/`)
Expected: PASS (3 tests). If any fail, the bug is in Tasks 1–7's implementation, not this test — go back and fix the relevant task rather than adjusting the acceptance test's asserted values (they're copied directly from the governing spec's AC-08/09/10).

- [ ] **Step 3: Run the full backend suite**

Run: `npm run test:e2e` (from `backend/`)
Expected: all suites pass, including every pre-existing suite plus this project's new/modified ones (`treatment-engine-specialist-review`, `treatment-engine-specialist-review-queue`, `consultations`, `specialist-review-v2-acceptance-criteria`). If Docker Desktop isn't running, `docker ps` will fail outright and every suite will fail — restart Docker Desktop and re-run before concluding anything is broken.

- [ ] **Step 4: Boot the app and confirm Swagger reflects the new routes**

Run: `npm run start:dev` (from `backend/`, in the background)
Once listening, fetch `http://localhost:3000/api/docs-json` and confirm these paths appear: `GET /api/v1/specialist-review/available-samples`, `POST /api/v1/specialist-review/cycles/{cycleId}/reserve`, `POST /api/v1/specialist-review/cycles/{cycleId}/intervention`, `POST /api/v1/specialist-review/cycles/{cycleId}/intervention/complete`, `POST /api/v1/specialist-review/cycles/{cycleId}/transfer`, `POST /api/v1/patients/{patientId}/consultations`, `GET /api/v1/patients/{patientId}/consultations`, `PATCH /api/v1/consultations/{consultationId}`. Stop the dev server afterward.

- [ ] **Step 5: Commit**

```bash
git add backend/test/specialist-review-v2-acceptance-criteria.e2e-spec.ts
git commit -m "test: add AC-08/09/10 acceptance criteria suite for Specialist Review v2"
```

No further commit for Steps 3–4 (verification only).

---

## After all tasks: whole-branch review

Once all 8 tasks pass individually, this plan's execution workflow (subagent-driven-development or executing-plans) should run a final whole-branch code review against `docs/superpowers/specs/2026-07-13-specialist-review-v2-design.md` before merging, per the same process every prior module in this project has gone through.
