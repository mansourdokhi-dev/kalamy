# §104 Specialist Workload Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remind the specialist holding a sample-review reservation before their 48h review-decision deadline or 7-day intervention deadline lapses into the existing (already-built) supervisor escalation / auto-release.

**Architecture:** A new `@Interval`-based sweep service (`SpecialistWorkloadReminderSweepService`), following the exact shape of `TrainingReminderSweepService` (§100), scans reserved samples with an active, un-reminded deadline every 15 minutes. Four existing `SpecialistReviewService` methods (`reserve`, `completeIntervention`, `requestIntervention`, `transferResponsibility`) gain one extra field reset each so the reminder re-arms whenever a new deadline becomes active or the reservation changes hands.

**Tech Stack:** NestJS, `@nestjs/schedule` (`@Interval`, already installed and registered via `ScheduleModule.forRoot()`), Prisma, Jest + Supertest e2e (no mocks).

## Global Constraints

- Sweep interval: `SWEEP_INTERVAL_MS = 15 * 60 * 1000` (15 minutes) — hardcoded, matching §100's sweep cadence.
- `REVIEW_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000` — reminder fires once 24h remain in the 48h review-decision window (`reviewDeadlineAt`).
- `INTERVENTION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000` — reminder fires once 24h remain in the 7-day intervention window (`interventionDeadlineAt`).
- A reminder must NOT be sent before its lead-time window opens, and must NOT be sent once the deadline itself has passed (the existing lazy `evaluateReviewDeadlines` auto-release/escalation is the backstop for that — this sweep never touches escalation).
- A reminder must NOT be sent more than once per active deadline: tracked via `SpeechSample.deadlineReminderSentAt`, reset to `null` whenever a new deadline becomes active (`reserve`, `completeIntervention`, `requestIntervention`) or the reservation is transferred to a different specialist (`transferResponsibility`).
- New `NotificationType` value: `SPECIALIST_WORKLOAD_REMINDER`, sent directly to `sample.reservedByUserId`, never to `SUPERVISOR`/`ADMIN` (that stays the existing, untouched escalation path).
- Notification failures must never stop the sweep from evaluating the rest of the samples: wrap each `notificationsService.create` call in its own try/catch + `Logger.error`, exactly matching `TrainingReminderSweepService`'s existing pattern.
- Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`. Current baseline on this branch: 66 unit tests (9 suites), 258 e2e tests (36 suites) — all passing before Task 1 starts.

---

### Task 1: Schema and notification template

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/notifications/notifications.service.ts:12-58`

**Interfaces:**
- Produces: `SpeechSample.deadlineReminderSentAt: DateTime | null`, `NotificationType.SPECIALIST_WORKLOAD_REMINDER` — both consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the new field to `SpeechSample`**

In `backend/prisma/schema.prisma`, the `SpeechSample` model currently reads (lines 480-514):

```prisma
model SpeechSample {
  id                          String              @id @default(uuid())
  trainingCycleId             String              @unique
  trainingCycle               TrainingCycle72h    @relation(fields: [trainingCycleId], references: [id])
  selfSeverityCurrent         Int?
  selfSeverityExpectedNext    Int?
  camperdownPerformanceRating Int?
  clientOpinionScore          Int?
  submittedAt                 DateTime?
  reviewedByUserId            String?
  reviewedByUser              User?               @relation("SpeechSampleReviewedBy", fields: [reviewedByUserId], references: [id])
  clinicianOpinionScore       Int?
  reviewNotes                 String?
  reviewedAt                  DateTime?
  decision                    SpecialistDecision?

  reservedByUserId String?
  reservedByUser   User?     @relation("SpeechSampleReservedBy", fields: [reservedByUserId], references: [id])
  reservedAt       DateTime?
  reviewDeadlineAt DateTime?
  escalatedAt      DateTime?

  interventionType             InterventionType?
  interventionRequestedAt      DateTime?
  interventionDeadlineAt       DateTime?
  interventionExecutedByUserId String?
  interventionExecutedByUser   User?             @relation("SpeechSampleInterventionExecutedBy", fields: [interventionExecutedByUserId], references: [id])
  interventionCompletedAt      DateTime?
  interventionOutcomeNotes     String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  parts SampleSamplePart[]
}
```

Add `deadlineReminderSentAt` right before `createdAt` — it tracks whichever of `reviewDeadlineAt`/`interventionDeadlineAt` is currently active, never both at once (the state machine already guarantees only one is non-null at a time):

```prisma
model SpeechSample {
  id                          String              @id @default(uuid())
  trainingCycleId             String              @unique
  trainingCycle               TrainingCycle72h    @relation(fields: [trainingCycleId], references: [id])
  selfSeverityCurrent         Int?
  selfSeverityExpectedNext    Int?
  camperdownPerformanceRating Int?
  clientOpinionScore          Int?
  submittedAt                 DateTime?
  reviewedByUserId            String?
  reviewedByUser              User?               @relation("SpeechSampleReviewedBy", fields: [reviewedByUserId], references: [id])
  clinicianOpinionScore       Int?
  reviewNotes                 String?
  reviewedAt                  DateTime?
  decision                    SpecialistDecision?

  reservedByUserId String?
  reservedByUser   User?     @relation("SpeechSampleReservedBy", fields: [reservedByUserId], references: [id])
  reservedAt       DateTime?
  reviewDeadlineAt DateTime?
  escalatedAt      DateTime?

  interventionType             InterventionType?
  interventionRequestedAt      DateTime?
  interventionDeadlineAt       DateTime?
  interventionExecutedByUserId String?
  interventionExecutedByUser   User?             @relation("SpeechSampleInterventionExecutedBy", fields: [interventionExecutedByUserId], references: [id])
  interventionCompletedAt      DateTime?
  interventionOutcomeNotes     String?

  deadlineReminderSentAt DateTime? // §104: reminder for whichever deadline (review or intervention) is currently active

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  parts SampleSamplePart[]
}
```

- [ ] **Step 2: Add the new `NotificationType` value**

In `backend/prisma/schema.prisma`, the `NotificationType` enum currently reads (lines 589-599):

```prisma
enum NotificationType {
  SAMPLE_ESCALATED_TO_SUPERVISOR
  SPECIALIST_DECISION_ISSUED
  INTERVENTION_TIMED_OUT
  SAMPLE_ELIGIBLE_FOR_RECORDING
  SAMPLE_AVAILABLE_FOR_REVIEW
  SAMPLE_SUBMISSION_REMINDER
  SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR
  CONSULTATION_REMINDER
  DAILY_TRAINING_REMINDER
}
```

Add `SPECIALIST_WORKLOAD_REMINDER` at the end:

```prisma
enum NotificationType {
  SAMPLE_ESCALATED_TO_SUPERVISOR
  SPECIALIST_DECISION_ISSUED
  INTERVENTION_TIMED_OUT
  SAMPLE_ELIGIBLE_FOR_RECORDING
  SAMPLE_AVAILABLE_FOR_REVIEW
  SAMPLE_SUBMISSION_REMINDER
  SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR
  CONSULTATION_REMINDER
  DAILY_TRAINING_REMINDER
  SPECIALIST_WORKLOAD_REMINDER
}
```

- [ ] **Step 3: Format and run the migration**

Run: `npx prisma format` (from `backend/`) — realigns the `SpeechSample` model's column spacing after the new field, avoiding a cosmetic-drift cleanup commit later.
Run: `npx prisma migrate dev --name add_specialist_workload_reminder` (from `backend/`)
Expected: a new migration folder under `backend/prisma/migrations/` is created and applied with no errors; Prisma Client regenerates automatically as part of `migrate dev`.

- [ ] **Step 4: Add the notification template**

In `backend/src/modules/notifications/notifications.service.ts`, the `NOTIFICATION_TEMPLATES` object currently ends with the `DAILY_TRAINING_REMINDER` entry (lines 54-58):

```typescript
  DAILY_TRAINING_REMINDER: (ctx) => ({
    title: 'تذكير بالتدريب اليومي',
    body: `أكملت ${ctx.completedToday} من ${ctx.targetPerDay} تدريبات اليوم. أكمل جرعتك اليومية للاستمرار في تقدمك.`,
  }),
};
```

Add a `SPECIALIST_WORKLOAD_REMINDER` entry right after it, before the closing `};`:

```typescript
  DAILY_TRAINING_REMINDER: (ctx) => ({
    title: 'تذكير بالتدريب اليومي',
    body: `أكملت ${ctx.completedToday} من ${ctx.targetPerDay} تدريبات اليوم. أكمل جرعتك اليومية للاستمرار في تقدمك.`,
  }),
  SPECIALIST_WORKLOAD_REMINDER: (ctx) => {
    const isIntervention = ctx.kind === 'INTERVENTION_OUTCOME';
    return {
      title: isIntervention ? 'تذكير: تدخل مباشر متأخر' : 'تذكير: مراجعة عينة متأخرة',
      body: isIntervention
        ? `لديك تدخل مباشر قيد التنفيذ لعينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} ينتظر توثيق النتيجة. يرجى استكماله قبل انتهاء المهلة المحددة.`
        : `لديك عينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} قيد المراجعة تنتظر قرارك. يرجى استكمال المراجعة قبل انتهاء المهلة المحددة.`,
    };
  },
};
```

- [ ] **Step 5: Verify the app still builds and existing tests pass**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: all existing tests still pass unchanged (no new behavior yet) — 66 unit, 258 e2e.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/notifications/notifications.service.ts
git commit -m "feat: add deadlineReminderSentAt field and SPECIALIST_WORKLOAD_REMINDER notification type"
```

---

### Task 2: Reset the reminder stamp whenever a deadline changes or a reservation transfers

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts:265-334, 336-389`
- Test: `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`

**Interfaces:**
- Consumes: `SpeechSample.deadlineReminderSentAt` (Task 1).
- Produces: nothing new consumed by Task 3 — this task only guarantees the field is `null` whenever Task 3's sweep should treat a sample as "not yet reminded for its current deadline."

- [ ] **Step 1: Write the failing e2e tests**

Open `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`. It already has `registerAndLogin`, `createSubmittedSampleCycle`, and `setupPatientAndPlan` helpers used by the existing tests in this file — reuse them exactly, do not redefine them. Add these four tests inside the existing `describe('Treatment Engine — Specialist review queue (e2e)', ...)` block, after the last existing `it(...)`:

```typescript
  it('reserve() clears a stale deadlineReminderSentAt from a previous reservation cycle', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005090', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005090' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005091', clinicianUserId);
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);
    // Simulate a stale reminder stamp left over from a prior reservation that was auto-released
    // (evaluateReviewDeadlines's 48h auto-release clears reservedByUserId/reviewDeadlineAt but not this field).
    await prisma.speechSample.update({ where: { id: sample.id }, data: { deadlineReminderSentAt: new Date(Date.now() - 60 * 60 * 1000) } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    const updated = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(updated.deadlineReminderSentAt).toBeNull();
  });

  it('requestIntervention() clears a reminder stamp left over from the review-decision window', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005092', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005092' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005093', clinicianUserId);
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);
    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);
    // Simulate a reminder having already fired during the review-decision window.
    await prisma.speechSample.update({ where: { id: sample.id }, data: { deadlineReminderSentAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ interventionType: 'VIDEO_MEETING', reasonNote: 'Need to observe the patient directly' })
      .expect(201);

    const updated = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(updated.deadlineReminderSentAt).toBeNull();
  });

  it('completeIntervention() clears a reminder stamp left over from the intervention window', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005094', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005094' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005095', clinicianUserId);
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);
    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ interventionType: 'VIDEO_MEETING', reasonNote: 'Need to observe the patient directly' })
      .expect(201);
    // Simulate a reminder having already fired during the intervention window.
    await prisma.speechSample.update({ where: { id: sample.id }, data: { deadlineReminderSentAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention/complete`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ outcomeNotes: 'Observed session, patient is progressing well' })
      .expect(201);

    const updated = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(updated.deadlineReminderSentAt).toBeNull();
  });

  it('transferResponsibility() clears a reminder stamp so the new specialist gets their own reminder', async () => {
    const clinicianAToken = await registerAndLogin(app, prisma, '+966500005096', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500005097', 'CLINICIAN');
    const supervisorToken = await registerAndLogin(app, prisma, '+966500005098', 'SUPERVISOR');
    const clinicianAUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005096' } })).id;
    const clinicianBUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005097' } })).id;
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005099', clinicianAUserId);
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianAUserId);
    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianAToken}`)
      .expect(201);
    // Simulate clinician A having already been reminded about this deadline.
    await prisma.speechSample.update({ where: { id: sample.id }, data: { deadlineReminderSentAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/transfer`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ toUserId: clinicianBUserId, reason: 'Clinician A is on leave' })
      .expect(201);

    const updated = await prisma.speechSample.findUniqueOrThrow({ where: { id: sample.id } });
    expect(updated.deadlineReminderSentAt).toBeNull();
    expect(updated.reservedByUserId).toBe(clinicianBUserId);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-specialist-review-queue` (from `backend/`)
Expected: FAIL — all four new tests fail because `deadlineReminderSentAt` is never reset by any of these four methods yet (it stays at the manually-seeded non-null value).

- [ ] **Step 3: Reset the field in all four call sites**

In `backend/src/modules/treatment-engine/specialist-review.service.ts`:

In `reserve()` (around line 283-292), the final update currently reads:

```typescript
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
```

Add `deadlineReminderSentAt: null` to the `data` object:

```typescript
      await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'UNDER_REVIEW' } });
      return tx.speechSample.update({
        where: { id: sample.id },
        data: {
          reservedByUserId: actor.id,
          reservedAt: new Date(),
          reviewDeadlineAt: new Date(Date.now() + REVIEW_DECISION_WINDOW_MS),
          escalatedAt: null,
          deadlineReminderSentAt: null,
        },
      });
```

In `requestIntervention()` (around line 350-362), the final update currently reads:

```typescript
    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'DIRECT_INTERVENTION_REQUIRED' } });
    return this.prisma.speechSample.update({
      where: { id: sample.id },
      data: {
        interventionType: dto.interventionType,
        interventionRequestedAt: new Date(),
        interventionDeadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        interventionOutcomeNotes: dto.reasonNote,
        reviewDeadlineAt: null,
      },
    });
```

Add `deadlineReminderSentAt: null`:

```typescript
    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'DIRECT_INTERVENTION_REQUIRED' } });
    return this.prisma.speechSample.update({
      where: { id: sample.id },
      data: {
        interventionType: dto.interventionType,
        interventionRequestedAt: new Date(),
        interventionDeadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        interventionOutcomeNotes: dto.reasonNote,
        reviewDeadlineAt: null,
        deadlineReminderSentAt: null,
      },
    });
```

In `completeIntervention()` (around line 379-388), the final update currently reads:

```typescript
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
```

Add `deadlineReminderSentAt: null`:

```typescript
    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FINAL_DECISION_AFTER_INTERVENTION' } });
    return this.prisma.speechSample.update({
      where: { id: sample.id },
      data: {
        interventionExecutedByUserId: actor.id,
        interventionCompletedAt: new Date(),
        interventionOutcomeNotes: dto.outcomeNotes,
        reviewDeadlineAt: new Date(Date.now() + REVIEW_DECISION_WINDOW_MS),
        deadlineReminderSentAt: null,
      },
    });
```

In `transferResponsibility()` (around line 319-332), the transaction currently reads:

```typescript
    const previousReviewerUserId = sample.reservedByUserId;
    const [, updatedSample] = await this.prisma.$transaction([
      this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          action: 'REVIEW_RESPONSIBILITY_TRANSFERRED',
          entity: 'SpeechSample',
          entityId: sample.id,
          before: { reservedByUserId: previousReviewerUserId },
          after: { reservedByUserId: dto.toUserId, reason: dto.reason },
        },
      }),
      this.prisma.speechSample.update({ where: { id: sample.id }, data: { reservedByUserId: dto.toUserId } }),
    ]);
    return updatedSample;
```

Add `deadlineReminderSentAt: null` to the `speechSample.update` call's `data` (the deadline itself is untouched by a transfer — only who holds the reservation, and now also whether they've been reminded about it):

```typescript
    const previousReviewerUserId = sample.reservedByUserId;
    const [, updatedSample] = await this.prisma.$transaction([
      this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          action: 'REVIEW_RESPONSIBILITY_TRANSFERRED',
          entity: 'SpeechSample',
          entityId: sample.id,
          before: { reservedByUserId: previousReviewerUserId },
          after: { reservedByUserId: dto.toUserId, reason: dto.reason },
        },
      }),
      this.prisma.speechSample.update({ where: { id: sample.id }, data: { reservedByUserId: dto.toUserId, deadlineReminderSentAt: null } }),
    ]);
    return updatedSample;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-specialist-review-queue` (from `backend/`)
Expected: all tests in this file PASS, including the 4 new ones.

- [ ] **Step 5: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 262 e2e (258 + 4 new).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-review.service.ts backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts
git commit -m "fix: reset deadlineReminderSentAt whenever a new deadline starts or a reservation transfers"
```

---

### Task 3: Specialist workload reminder sweep

**Files:**
- Create: `backend/src/modules/treatment-engine/specialist-workload-reminder-sweep.service.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Test: `backend/test/treatment-engine-specialist-workload-reminder.e2e-spec.ts`

**Interfaces:**
- Consumes: `SpeechSample.deadlineReminderSentAt` (Task 1, kept accurate by Task 2), `NotificationType.SPECIALIST_WORKLOAD_REMINDER` (Task 1), `NotificationsService.create(recipientUserId: string, type: NotificationType, context: Record<string, string>, related?: { entity: string; entityId: string }): Promise<Notification>`, `getNotificationContext(prisma: PrismaService, cycle: { patientProfileId: string; levelId: string }): Promise<{ patientName: string; levelName: string }>` (existing shared utility in `backend/src/modules/notifications/notification-context.util.ts`).
- Produces: nothing consumed by a later task — this is the final task in the plan.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/treatment-engine-specialist-workload-reminder.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { SpecialistWorkloadReminderSweepService } from '../src/modules/treatment-engine/specialist-workload-reminder-sweep.service';

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

async function createSubmittedSampleCycle(prisma: PrismaService, patientProfileId: string, treatmentPlanId: string) {
  const level = await prisma.level.create({ data: { name: `Level ${Date.now()}`, order: Math.floor(Math.random() * 100000) } });
  const levelVersion = await prisma.levelVersion.create({
    data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
  });
  const cycle = await prisma.trainingCycle72h.create({
    data: { patientProfileId, treatmentPlanId, levelId: level.id, levelVersionId: levelVersion.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
  });
  const sample = await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });
  return { cycle, sample };
}

describe('Specialist Workload Reminder sweep (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweepService: SpecialistWorkloadReminderSweepService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sweepService = app.get(SpecialistWorkloadReminderSweepService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function setupReservedSample(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Workload Reminder Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `WORKLOAD-${Date.now()}-${Math.random()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const { cycle, sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    return { clinicianToken, clinicianUserId, patientToken, patientProfile, cycleId: cycle.id, sampleId: sample.id };
  }

  it('sends a reminder once the review-decision deadline is within its 24h lead window', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006000', '+966500006001');
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 18 * 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('تذكير: مراجعة عينة متأخرة');
    const updatedSample = await prisma.speechSample.findUniqueOrThrow({ where: { id: sampleId } });
    expect(updatedSample.deadlineReminderSentAt).not.toBeNull();
  });

  it('does not send a reminder before the 24h lead window opens', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006002', '+966500006003');
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 40 * 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a reminder once the review-decision deadline has already passed', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006004', '+966500006005');
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() - 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a second reminder on a repeated sweep for the same active deadline', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006006', '+966500006007');
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 18 * 60 * 60 * 1000) } });

    await sweepService.runSweep();
    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(1);
  });

  it('sends an intervention-worded reminder once the 7-day intervention deadline is within its 24h lead window', async () => {
    const { clinicianToken, clinicianUserId, cycleId, sampleId } = await setupReservedSample('+966500006008', '+966500006009');
    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycleId}/intervention`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ interventionType: 'VIDEO_MEETING', reasonNote: 'Need to observe the patient directly' })
      .expect(201);
    await prisma.speechSample.update({ where: { id: sampleId }, data: { interventionDeadlineAt: new Date(Date.now() + 18 * 60 * 60 * 1000) } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('تذكير: تدخل مباشر متأخر');
  });

  it('re-arms and reminds the new specialist after a transfer, even if the old specialist was already reminded', async () => {
    const { clinicianUserId: clinicianAUserId, cycleId, sampleId } = await setupReservedSample('+966500006010', '+966500006011');
    const supervisorToken = await registerAndLogin(app, prisma, '+966500006012', 'SUPERVISOR');
    await registerAndLogin(app, prisma, '+966500006013', 'CLINICIAN');
    const clinicianBUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500006013' } })).id;
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 18 * 60 * 60 * 1000) } });

    await sweepService.runSweep();
    let notifications = await prisma.notification.findMany({ where: { type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipientUserId).toBe(clinicianAUserId);

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycleId}/transfer`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ toUserId: clinicianBUserId, reason: 'Clinician A is on leave' })
      .expect(201);

    await sweepService.runSweep();
    notifications = await prisma.notification.findMany({ where: { type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(2);
    expect(notifications.some((n) => n.recipientUserId === clinicianBUserId)).toBe(true);
  });

  it('does not send a reminder for an unreserved sample (the §103/24h-escalation path stays untouched)', async () => {
    await registerAndLogin(app, prisma, '+966500006015', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500006015' } })).id;
    await registerAndLogin(app, prisma, '+966500006014', null);
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500006014' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: patientUserId, fullName: 'Unreserved Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `UNRESERVED-${Date.now()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id);

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-specialist-workload-reminder` (from `backend/`)
Expected: FAIL — `SpecialistWorkloadReminderSweepService` doesn't exist yet, so `app.get(SpecialistWorkloadReminderSweepService)` throws.

- [ ] **Step 3: Create the sweep service**

Create `backend/src/modules/treatment-engine/specialist-workload-reminder-sweep.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getNotificationContext } from '../notifications/notification-context.util';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const REVIEW_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // half of the 48h review-decision window
const INTERVENTION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // flat one-day-before on the 7-day intervention window

@Injectable()
export class SpecialistWorkloadReminderSweepService {
  private readonly logger = new Logger(SpecialistWorkloadReminderSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const samples = await this.prisma.speechSample.findMany({
      where: {
        reservedByUserId: { not: null },
        deadlineReminderSentAt: null,
        OR: [
          { trainingCycle: { status: { in: ['UNDER_REVIEW', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'] } }, reviewDeadlineAt: { not: null } },
          { trainingCycle: { status: 'DIRECT_INTERVENTION_REQUIRED' }, interventionDeadlineAt: { not: null } },
        ],
      },
      include: { trainingCycle: true },
    });

    const now = Date.now();
    for (const sample of samples) {
      const isIntervention = sample.trainingCycle.status === 'DIRECT_INTERVENTION_REQUIRED';
      const deadline = isIntervention ? sample.interventionDeadlineAt : sample.reviewDeadlineAt;
      if (!deadline) {
        continue;
      }
      const leadTimeMs = isIntervention ? INTERVENTION_REMINDER_LEAD_MS : REVIEW_REMINDER_LEAD_MS;
      const remindAt = deadline.getTime() - leadTimeMs;
      if (now < remindAt || now >= deadline.getTime()) {
        continue;
      }

      const { patientName, levelName } = await getNotificationContext(this.prisma, sample.trainingCycle);
      try {
        await this.notificationsService.create(
          sample.reservedByUserId!,
          'SPECIALIST_WORKLOAD_REMINDER',
          { kind: isIntervention ? 'INTERVENTION_OUTCOME' : 'REVIEW_DECISION', patientName, levelName },
          { entity: 'SpeechSample', entityId: sample.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send SPECIALIST_WORKLOAD_REMINDER for sample ${sample.id}: ${err}`);
      }
      await this.prisma.speechSample.update({ where: { id: sample.id }, data: { deadlineReminderSentAt: new Date() } });
    }
  }
}
```

- [ ] **Step 4: Wire the service into the module**

In `backend/src/modules/treatment-engine/treatment-engine.module.ts`, add the import after the `TrainingReminderSweepService` import:

```typescript
import { SpecialistWorkloadReminderSweepService } from './specialist-workload-reminder-sweep.service';
```

Change:

```typescript
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService, TrainingReminderSweepService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService, TrainingReminderSweepService],
```

to:

```typescript
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService, TrainingReminderSweepService, SpecialistWorkloadReminderSweepService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService, TrainingReminderSweepService, SpecialistWorkloadReminderSweepService],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-specialist-workload-reminder` (from `backend/`)
Expected: all 7 tests PASS.

- [ ] **Step 6: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 269 e2e (262 + 7 new).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-workload-reminder-sweep.service.ts backend/src/modules/treatment-engine/treatment-engine.module.ts backend/test/treatment-engine-specialist-workload-reminder.e2e-spec.ts
git commit -m "feat: add the specialist workload reminder sweep (§104)"
```

---

## Self-Review Notes

- **Spec coverage:** "إذا بقيت عينة... دون مراجعة خلال المدة التشغيلية، يرسل النظام تذكيرًا للأخصائي" (reminder to the specialist during the operational period) → Task 3's `runSweep` sending `SPECIALIST_WORKLOAD_REMINDER` once each deadline's lead window opens. "إذا تجاوز التأخير حدًا آخر تحدده الإدارة، يمكن تصعيد الحالة" (escalate past a further limit) → already fully implemented by the pre-existing, untouched `evaluateReviewDeadlines` (24h/48h/7-day transitions) — this plan deliberately does not modify it. "دون نقل المسؤولية السريرية تلقائيًا... إعادة إسناد تتم بإجراء رسمي موثق" (no automatic reassignment; transfer only via a formal documented procedure) → already true of the existing `transferResponsibility` (supervisor-only, audit-logged) — untouched by this plan except for the one added field reset.
- **No placeholders:** every step has complete, runnable code including the full new test file, the four exact before/after service-method diffs, and the new sweep service's complete implementation.
- **Type consistency:** `deadlineReminderSentAt` is spelled identically across the Task 1 schema field, all four Task 2 call sites, and Task 3's service and tests. `SPECIALIST_WORKLOAD_REMINDER` is spelled identically across the Task 1 enum value, Task 1's template, and Task 3's service/tests. The template's `ctx.kind` values (`'REVIEW_DECISION'` / `'INTERVENTION_OUTCOME'`) match exactly between Task 1's template branching and Task 3's `runSweep` context construction.
- **Cross-task ordering verified:** Task 2's tests seed `deadlineReminderSentAt` directly via Prisma (Task 1's field, no dependency on Task 3's sweep existing yet) — Task 2 is fully testable before Task 3 is built, matching the plan's task order.
