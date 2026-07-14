# §102 Sample Submission Delay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when a patient hasn't submitted their sample within 2 days of it becoming due, flag the cycle as delayed, notify both the patient and supervisors, and let the patient still submit normally afterward.

**Architecture:** A new `LevelCycleStatus` value (`SAMPLE_SUBMISSION_DELAYED`) and a new `sampleEligibleAt` timestamp field, evaluated lazily inside the existing `TrainingCyclesService.getCurrent` — the same pattern already used for 30-day inactivity closure, no new scheduling infrastructure. `SamplesService.openSession`/`submitSample` are widened to accept the new status as a valid predecessor so the patient's flow is unaffected once they act.

**Tech Stack:** NestJS, Prisma, Jest + Supertest (e2e against a real Postgres, no mocks).

## Global Constraints

- Grace period is a hardcoded 2-day constant (`SAMPLE_SUBMISSION_GRACE_MS = 2 * 24 * 60 * 60 * 1000`) — no admin-configurability in this pass, matching every other timing constant in this project.
- `SAMPLE_SUBMISSION_DELAYED` is evaluated the same way the existing inactivity check is: lazily, inside `getCurrent`, on read — no background job, no cron.
- `SAMPLE_SUBMISSION_DELAYED` is NOT added to `STATES_EXEMPT_FROM_INACTIVITY` — the 30-day inactivity backstop still applies on top.
- Notifications go to **both** the patient (`SAMPLE_SUBMISSION_REMINDER`) and `SUPERVISOR` role (`SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR`) — not `CLINICIAN`/`ADMIN`, matching the existing supervisor-escalation precedent.
- Every notification call site wraps the `notificationsService` call in `try/catch` with `Logger.error(...)` on failure — established convention, never break or mask the business operation it's attached to.
- The transition must be idempotent: it fires exactly once per cycle (after transitioning, the cycle's status is no longer one the check matches, so a second read cannot re-fire it).
- Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`.

---

### Task 1: Schema, templates, and reports

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/notifications/notifications.service.ts:12-37`
- Modify: `backend/src/modules/reports/reports.service.ts:182-200`
- Test: `backend/test/reports-admin.e2e-spec.ts`

**Interfaces:**
- Produces: `LevelCycleStatus` value `'SAMPLE_SUBMISSION_DELAYED'`, `TrainingCycle72h.sampleEligibleAt: DateTime | null`, `NotificationType` values `'SAMPLE_SUBMISSION_REMINDER'` and `'SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR'` — all consumed by Tasks 2 and 3.

- [ ] **Step 1: Add the new `LevelCycleStatus` value and `sampleEligibleAt` field**

In `backend/prisma/schema.prisma`, change the `LevelCycleStatus` enum (currently lines 87-101) to add the new value right after `SAMPLE_PREPARATION`:

```prisma
enum LevelCycleStatus {
  ACTIVE_LEVEL_TRAINING
  SAMPLE_ELIGIBLE
  SAMPLE_PREPARATION
  SAMPLE_SUBMISSION_DELAYED
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
```

In the `TrainingCycle72h` model (currently lines 392-416), add the new field right after `firstTrainingEventAt`:

```prisma
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
  cycleNumber          Int // 1 for the first attempt at this level, 2+ for repeats
  status               LevelCycleStatus @default(ACTIVE_LEVEL_TRAINING)
  humanModelWatchedAt  DateTime?
  firstTrainingEventAt DateTime?
  sampleEligibleAt     DateTime?
  closedAt             DateTime?
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt

  trainingEvents TrainingEvent[]
  speechSample   SpeechSample?
  sampleSession  SampleSession?

  @@index([patientProfileId, createdAt])
  @@index([treatmentPlanId, levelId])
}
```

Add the two new `NotificationType` values (currently lines 565-571), after `SAMPLE_AVAILABLE_FOR_REVIEW`:

```prisma
enum NotificationType {
  SAMPLE_ESCALATED_TO_SUPERVISOR
  SPECIALIST_DECISION_ISSUED
  INTERVENTION_TIMED_OUT
  SAMPLE_ELIGIBLE_FOR_RECORDING
  SAMPLE_AVAILABLE_FOR_REVIEW
  SAMPLE_SUBMISSION_REMINDER
  SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR
}
```

Run: `npx prisma migrate dev --name add_sample_submission_delayed_status` (from `backend/`)
Expected: A new migration folder is created and the command reports success; the Prisma client is regenerated with the new enum values and field.

- [ ] **Step 2: Add the two new notification templates**

In `backend/src/modules/notifications/notifications.service.ts`, add these two entries to `NOTIFICATION_TEMPLATES` (currently lines 12-37), after the existing `SAMPLE_AVAILABLE_FOR_REVIEW` entry:

```typescript
  SAMPLE_SUBMISSION_REMINDER: (ctx) => ({
    title: 'تذكير بإرسال العينة',
    body: `لم ترسل عينتك الصوتية بعد في المستوى ${ctx.levelName}. يمكنك إرسالها الآن.`,
  }),
  SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR: (ctx) => ({
    title: 'تأخر في إرسال عينة مريض',
    body: `لم يرسل المريض ${ctx.patientName} عينته في المستوى ${ctx.levelName} خلال المهلة المحددة.`,
  }),
```

- [ ] **Step 3: Add the new status to the operational report's zero-fill list**

In `backend/src/modules/reports/reports.service.ts`, change the `trainingCyclesByStatus` array (currently lines 182-197) to add the new status right after `'SAMPLE_PREPARATION'`:

```typescript
      trainingCyclesByStatus: this.zeroFillCounts(
        [
          'ACTIVE_LEVEL_TRAINING',
          'SAMPLE_ELIGIBLE',
          'SAMPLE_PREPARATION',
          'SAMPLE_SUBMISSION_DELAYED',
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
```

- [ ] **Step 4: Write a test confirming the new status is zero-filled**

Add this test to `backend/test/reports-admin.e2e-spec.ts`, near the existing test that checks `trainingCyclesByStatus.ACTIVE_LEVEL_TRAINING`/`.WAITING_FOR_SPECIALIST` (read that test first to match its exact setup style — same describe block, same auth pattern):

```typescript
  it('zero-fills SAMPLE_SUBMISSION_DELAYED in the operational status report when no cycle has that status', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500004000', 'ADMIN');

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/operational-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.trainingCyclesByStatus.SAMPLE_SUBMISSION_DELAYED).toBe(0);
  });
```

Before writing this, open `backend/test/reports-admin.e2e-spec.ts` and confirm the exact route path and `registerAndLogin` helper signature already used by its neighboring tests — reuse them exactly rather than guessing; adjust the route path in the snippet above if the file's existing tests use a different one.

- [ ] **Step 5: Run the test and the full suite**

Run: `npm run test:e2e -- reports-admin` (from `backend/`)
Expected: PASS.

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES — this task only adds new enum values/fields/templates, nothing consumes them yet, so no existing behavior should change.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/notifications/notifications.service.ts backend/src/modules/reports/reports.service.ts backend/test/reports-admin.e2e-spec.ts
git commit -m "feat: add SAMPLE_SUBMISSION_DELAYED status, sampleEligibleAt field, and notification types"
```

---

### Task 2: Detect and flag delayed submissions

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-cycles.service.ts`
- Test: `backend/test/treatment-engine-cycle.e2e-spec.ts`

**Interfaces:**
- Consumes: `LevelCycleStatus.SAMPLE_SUBMISSION_DELAYED`, `NotificationType.SAMPLE_SUBMISSION_REMINDER`/`.SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR` (Task 1).
- Produces: `TrainingCycle72h.sampleEligibleAt` is now populated whenever a cycle becomes `SAMPLE_ELIGIBLE` (used by Task 2's own `getCurrent` check — no other task depends on this directly, but it's the field the whole delay mechanism is built on).

- [ ] **Step 1: Write the failing tests**

Add these tests to `backend/test/treatment-engine-cycle.e2e-spec.ts`, inside the existing `describe('Treatment Engine — Cycle lifecycle (e2e)', ...)` block, after the existing tests. All four share nearly identical setup — write them as shown, each self-contained:

```typescript
  it('flags a cycle SAMPLE_SUBMISSION_DELAYED and notifies patient + supervisors when 2 days pass without submission from SAMPLE_ELIGIBLE', async () => {
    await registerAndLogin(app, prisma, '+966500001700', 'CLINICIAN');
    const supervisorToken = await registerAndLogin(app, prisma, '+966500001701', 'SUPERVISOR');
    const patientToken = await registerAndLogin(app, prisma, '+966500001702', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001700' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001702' } })).id, fullName: 'Delay Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'DELAY-TEST-1' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const sampleEligibleAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago — past the 2-day grace period
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'SAMPLE_ELIGIBLE', sampleEligibleAt,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('SAMPLE_SUBMISSION_DELAYED');

    const patientNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(patientNotifications.body.find((n: { type: string }) => n.type === 'SAMPLE_SUBMISSION_REMINDER')).toBeTruthy();

    const supervisorNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);
    const found = supervisorNotifications.body.find((n: { type: string }) => n.type === 'SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR');
    expect(found).toBeTruthy();
    expect(found.body).toContain('Level 1');
  });

  it('flags a cycle SAMPLE_SUBMISSION_DELAYED when 2 days pass from SAMPLE_PREPARATION (session opened but never submitted)', async () => {
    await registerAndLogin(app, prisma, '+966500001703', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001704', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001703' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001704' } })).id, fullName: 'Delay Test Patient 2', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'DELAY-TEST-2' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const sampleEligibleAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'SAMPLE_PREPARATION', sampleEligibleAt,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('SAMPLE_SUBMISSION_DELAYED');
  });

  it('does not flag a cycle as delayed if sampleEligibleAt is less than 2 days old', async () => {
    await registerAndLogin(app, prisma, '+966500001705', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001706', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001705' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001706' } })).id, fullName: 'Not Delayed Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'DELAY-TEST-3' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const sampleEligibleAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // only 1 day ago — inside the grace period
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'SAMPLE_ELIGIBLE', sampleEligibleAt,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.status).toBe('SAMPLE_ELIGIBLE');
  });

  it('does not create duplicate notifications on a second read after already being flagged delayed', async () => {
    await registerAndLogin(app, prisma, '+966500001707', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500001708', 'SUPERVISOR');
    const patientToken = await registerAndLogin(app, prisma, '+966500001709', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001707' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001709' } })).id, fullName: 'Idempotent Delay Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: 'DELAY-TEST-4' },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const sampleEligibleAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'SAMPLE_ELIGIBLE', sampleEligibleAt,
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const patientNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const reminders = patientNotifications.body.filter((n: { type: string }) => n.type === 'SAMPLE_SUBMISSION_REMINDER');
    expect(reminders).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-cycle` (from `backend/`)
Expected: The four new tests FAIL — `sampleEligibleAt` isn't consumed anywhere yet, so cycles stay in their seeded status and no notifications are created.

- [ ] **Step 3: Set `sampleEligibleAt` when a cycle becomes eligible**

In `backend/src/modules/treatment-engine/training-cycles.service.ts`, change `recordTrainingEvent`'s cycle-update call (currently lines 155-161):

```typescript
    const updatedCycle = await this.prisma.trainingCycle72h.update({
      where: { id: cycleId },
      data: {
        firstTrainingEventAt,
        status: eligible ? 'SAMPLE_ELIGIBLE' : 'ACTIVE_LEVEL_TRAINING',
      },
    });
```

to:

```typescript
    const updatedCycle = await this.prisma.trainingCycle72h.update({
      where: { id: cycleId },
      data: {
        firstTrainingEventAt,
        status: eligible ? 'SAMPLE_ELIGIBLE' : 'ACTIVE_LEVEL_TRAINING',
        sampleEligibleAt: eligible ? new Date() : undefined,
      },
    });
```

- [ ] **Step 4: Add the delay-detection check to `getCurrent`**

In `backend/src/modules/treatment-engine/training-cycles.service.ts`, add two new module-level constants right after the existing `STATES_EXEMPT_FROM_INACTIVITY` array (currently lines 12-21):

```typescript
const SAMPLE_SUBMISSION_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const STATES_AWAITING_SAMPLE_SUBMISSION: readonly string[] = ['SAMPLE_ELIGIBLE', 'SAMPLE_PREPARATION'];
```

Add the import for `getNotificationContext`:

```typescript
import { getNotificationContext } from '../notifications/notification-context.util';
```

In `getCurrent` (currently lines 189-224), insert a new block right after the initial `let cycle = await this.prisma.trainingCycle72h.findFirst(...)` call and before the existing inactivity-check `if` block:

```typescript
    if (
      cycle &&
      STATES_AWAITING_SAMPLE_SUBMISSION.includes(cycle.status) &&
      cycle.sampleEligibleAt &&
      Date.now() - cycle.sampleEligibleAt.getTime() > SAMPLE_SUBMISSION_GRACE_MS
    ) {
      cycle = await this.prisma.trainingCycle72h.update({
        where: { id: cycle.id },
        data: { status: 'SAMPLE_SUBMISSION_DELAYED' },
        include: { speechSample: { include: { parts: true } } },
      });

      const [patientProfile, { patientName, levelName }] = await Promise.all([
        this.prisma.patientProfile.findUniqueOrThrow({ where: { id: cycle.patientProfileId } }),
        getNotificationContext(this.prisma, cycle),
      ]);
      try {
        await this.notificationsService.create(
          patientProfile.userId,
          'SAMPLE_SUBMISSION_REMINDER',
          { levelName },
          { entity: 'TrainingCycle72h', entityId: cycle.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send SAMPLE_SUBMISSION_REMINDER notification for cycle ${cycle.id}: ${err}`);
      }
      try {
        await this.notificationsService.notifyRole(
          'SUPERVISOR',
          'SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR',
          { patientName, levelName },
          { entity: 'TrainingCycle72h', entityId: cycle.id },
        );
      } catch (err) {
        this.logger.error(`Failed to notify SUPERVISOR role of SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR for cycle ${cycle.id}: ${err}`);
      }
    }
```

Note this block fetches `patientProfile` directly (for `userId`, same reasoning as the §101 call site) AND calls `getNotificationContext` (for `patientName`/`levelName`, since this call site — unlike §101's — needs both patient and level names for the supervisor message). This is a deliberate, small duplication of the `patientProfile` fetch (once directly, once inside the util) — acceptable here since, unlike §101, this call site genuinely needs both what the util returns AND the recipient id the util doesn't expose; introduce a second shared helper only if a fourth caller ever needs this exact combination.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-cycle` (from `backend/`)
Expected: All tests in the file PASS, including the four new ones.

- [ ] **Step 6: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/training-cycles.service.ts backend/test/treatment-engine-cycle.e2e-spec.ts
git commit -m "feat: detect and flag delayed sample submissions, notify patient and supervisors"
```

---

### Task 3: Let a delayed patient still submit normally

**Files:**
- Modify: `backend/src/modules/treatment-engine/samples.service.ts`
- Test: `backend/test/treatment-engine-sample-submit.e2e-spec.ts`

**Interfaces:**
- Consumes: `LevelCycleStatus.SAMPLE_SUBMISSION_DELAYED` (Task 1), the transition produced by Task 2's `getCurrent` check.
- Produces: no new exported interface — widens the existing status guards in `openSession` and `submitSample`, keeping their exact existing signatures.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `backend/test/treatment-engine-sample-submit.e2e-spec.ts`, inside the existing `describe('Treatment Engine — Sample submission (e2e)', ...)` block, after the existing tests:

```typescript
  it('allows opening a sample session from SAMPLE_SUBMISSION_DELAYED (never opened one before being flagged)', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003007', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003008', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003008' } })).id,
        fullName: 'Delayed Open Session Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'DELAYED-OPEN-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003007' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    await prisma.trainingCycle72h.update({ where: { id: startRes.body.id }, data: { status: 'SAMPLE_SUBMISSION_DELAYED' } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('SAMPLE_PREPARATION');
  });

  it('allows submitting a sample from SAMPLE_SUBMISSION_DELAYED (session was already open before being flagged)', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003009', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003010', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003010' } })).id,
        fullName: 'Delayed Submit Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'DELAYED-SUBMIT-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003009' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    await prisma.trainingCycle72h.update({ where: { id: startRes.body.id }, data: { status: 'SAMPLE_ELIGIBLE' } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const attempt1 = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/attempts`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ recordingUrl: 'delayed-attempt-1.mp4', mimeType: 'video/mp4', fileSizeBytes: 204800, durationSeconds: 12 })
      .expect(201);

    // Session is open (SAMPLE_PREPARATION); simulate the lazy-evaluation flag having fired.
    await prisma.trainingCycle72h.update({ where: { id: startRes.body.id }, data: { status: 'SAMPLE_SUBMISSION_DELAYED' } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/sample-session/submit`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        parts: [{ partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: attempt1.body.id }],
        selfSeverityCurrent: 5,
        selfSeverityExpectedNext: 6,
        camperdownPerformanceRating: 7,
        clientOpinionScore: 6,
      })
      .expect(201);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('WAITING_FOR_SPECIALIST');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-sample-submit` (from `backend/`)
Expected: Both new tests FAIL with 409 — the current guards reject `SAMPLE_SUBMISSION_DELAYED` outright.

- [ ] **Step 3: Widen the guards**

In `backend/src/modules/treatment-engine/samples.service.ts`, change `openSession`'s guard (currently lines 27-30):

```typescript
  async openSession(cycleId: string, actor: AuthenticatedUser): Promise<SampleSession> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'SAMPLE_ELIGIBLE') {
      throw new ConflictException(`Cannot open a sample session from status ${cycle.status}`);
    }
```

to:

```typescript
  async openSession(cycleId: string, actor: AuthenticatedUser): Promise<SampleSession> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'SAMPLE_ELIGIBLE' && cycle.status !== 'SAMPLE_SUBMISSION_DELAYED') {
      throw new ConflictException(`Cannot open a sample session from status ${cycle.status}`);
    }
```

Change `submitSample`'s guard (currently line 118, inside the method body — the first status check, before the transaction):

```typescript
    if (cycle.status !== 'SAMPLE_PREPARATION') {
      throw new ConflictException(`Cannot submit a sample from status ${cycle.status}`);
    }
```

to:

```typescript
    if (cycle.status !== 'SAMPLE_PREPARATION' && cycle.status !== 'SAMPLE_SUBMISSION_DELAYED') {
      throw new ConflictException(`Cannot submit a sample from status ${cycle.status}`);
    }
```

`submitSample` also has a second, in-transaction re-check (currently line 139) that must be widened the same way, or the second test above will fail there even after the first guard is widened. Change:

```typescript
      if (freshCycle.status !== 'SAMPLE_PREPARATION') {
        return { alreadyTransitioned: true as const, status: freshCycle.status };
      }
```

to:

```typescript
      if (freshCycle.status !== 'SAMPLE_PREPARATION' && freshCycle.status !== 'SAMPLE_SUBMISSION_DELAYED') {
        return { alreadyTransitioned: true as const, status: freshCycle.status };
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-sample-submit` (from `backend/`)
Expected: All tests in the file PASS, including the two new ones.

- [ ] **Step 5: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/treatment-engine/samples.service.ts backend/test/treatment-engine-sample-submit.e2e-spec.ts
git commit -m "feat: let a patient still submit a sample after being flagged SAMPLE_SUBMISSION_DELAYED"
```

---

## Self-Review Notes

- **Spec coverage:** Data model changes → Task 1. Lazy-evaluation detection + dual notifications → Task 2. Guard widening (patient can still submit) → Task 3. Reports zero-fill → Task 1. Idempotency → Task 2's fourth test. Both source states (`SAMPLE_ELIGIBLE` and `SAMPLE_PREPARATION`) → Task 2's first two tests. Not-yet-expired case → Task 2's third test.
- **No placeholders:** every step has complete, runnable code, including both of `submitSample`'s two status checks (the top-of-method guard and the in-transaction re-check) — a first draft of this plan only widened the first one, which would have left the second re-check silently rejecting `SAMPLE_SUBMISSION_DELAYED` and failing Task 3's second test; fixed during self-review.
- **Type consistency:** `sampleEligibleAt: DateTime?` (Task 1) is set in Task 2 Step 3 and read in Task 2 Step 4. `SAMPLE_SUBMISSION_DELAYED` (Task 1) is produced by Task 2 Step 4 and consumed by Task 3's widened guards. Notification types match Task 1's exact enum names in both Task 2 call sites.
