# §100 Daily Training Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a patient a reminder to reach today's target of 7 trainings, but only while a training is actually available to start and only until today's target is met.

**Architecture:** A new `@Interval`-based sweep service (`TrainingReminderSweepService`), following the exact shape of the existing `ConsultationRemindersService` (§106), scans every active training cycle every 15 minutes and reuses the interval/day-period logic already built for §55-62's `TrainingSessionsService`.

**Tech Stack:** NestJS, `@nestjs/schedule` (`@Interval`, already installed and registered via `ScheduleModule.forRoot()` in `src/app.module.ts`), Prisma, Jest + Supertest e2e (no mocks).

## Global Constraints

- Sweep interval: `SWEEP_INTERVAL_MS = 15 * 60 * 1000` (15 minutes) — hardcoded, no admin configurability, matching every other timing constant in this project.
- A reminder must NOT be sent while `resolveIntervalStatus(cycleId).intervalActive` is `true` (training not yet available).
- A reminder must NOT be sent once `completedToday >= DAILY_TARGET_TRAININGS` (7) for the current day-period.
- A reminder must NOT be sent more than once per rolling 24-hour day-period (anchored the same way `getProgress`'s existing period math already anchors "today": to `firstTrainingEventAt`, or to `cycle.createdAt` when `firstTrainingEventAt` is still null).
- Only cycles with `status: 'ACTIVE_LEVEL_TRAINING'`, `closedAt: null`, and `humanModelWatchedAt` set are eligible — a cycle whose patient hasn't watched the human model yet can't start a session at all, so it must not be nagged either.
- New `NotificationType` value: `DAILY_TRAINING_REMINDER`, sent directly to the patient (`patientProfile.userId`), never to staff.
- Notification failures must never stop the sweep from evaluating the rest of the cycles: wrap each `notificationsService.create` call in its own try/catch + `Logger.error`, exactly matching `ConsultationRemindersService`'s and `TrainingSessionsService.completeAndCheckEligibility`'s existing pattern.
- Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`.

---

### Task 1: Schema and notification template

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/notifications/notifications.service.ts:12-38`

**Interfaces:**
- Produces: `TrainingCycle72h.lastDailyReminderSentAt: DateTime | null`, `NotificationType.DAILY_TRAINING_REMINDER` — both consumed by Task 3.

- [ ] **Step 1: Add the new field to `TrainingCycle72h`**

In `backend/prisma/schema.prisma`, the `TrainingCycle72h` model currently reads (lines 398-424):

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

  trainingEvents   TrainingEvent[]
  trainingSessions TrainingSession[]
  speechSample     SpeechSample?
  sampleSession    SampleSession?

  @@index([patientProfileId, createdAt])
  @@index([treatmentPlanId, levelId])
}
```

Add `lastDailyReminderSentAt` right after `sampleEligibleAt`:

```prisma
model TrainingCycle72h {
  id                      String           @id @default(uuid())
  patientProfileId        String
  patientProfile          PatientProfile   @relation(fields: [patientProfileId], references: [id])
  treatmentPlanId         String
  treatmentPlan           TreatmentPlan    @relation(fields: [treatmentPlanId], references: [id])
  levelId                 String
  level                   Level            @relation(fields: [levelId], references: [id])
  levelVersionId          String
  levelVersion            LevelVersion     @relation(fields: [levelVersionId], references: [id])
  cycleNumber             Int // 1 for the first attempt at this level, 2+ for repeats
  status                  LevelCycleStatus @default(ACTIVE_LEVEL_TRAINING)
  humanModelWatchedAt     DateTime?
  firstTrainingEventAt    DateTime?
  sampleEligibleAt        DateTime?
  lastDailyReminderSentAt DateTime?
  closedAt                DateTime?
  createdAt               DateTime         @default(now())
  updatedAt               DateTime         @updatedAt

  trainingEvents   TrainingEvent[]
  trainingSessions TrainingSession[]
  speechSample     SpeechSample?
  sampleSession    SampleSession?

  @@index([patientProfileId, createdAt])
  @@index([treatmentPlanId, levelId])
}
```

- [ ] **Step 2: Add the new `NotificationType` value**

In `backend/prisma/schema.prisma`, the `NotificationType` enum currently reads (lines 588-597):

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
}
```

Add `DAILY_TRAINING_REMINDER` at the end:

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

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name add_daily_training_reminder` (from `backend/`)
Expected: a new migration folder under `backend/prisma/migrations/` is created and applied with no errors; Prisma Client regenerates automatically as part of `migrate dev`.

- [ ] **Step 4: Add the notification template**

In `backend/src/modules/notifications/notifications.service.ts`, the `NOTIFICATION_TEMPLATES` object currently ends with the `CONSULTATION_REMINDER` entry (lines 12-38):

```typescript
  CONSULTATION_REMINDER: (ctx) => {
    const isDayBefore = ctx.leadTime === 'DAY_BEFORE';
    return {
      title: isDayBefore ? 'تذكير: استشارتك غدًا' : 'تذكير: استشارتك خلال ساعة',
      body: isDayBefore
        ? 'لديك موعد استشارة غدًا. يرجى الاستعداد لحضورها في الوقت المحدد.'
        : 'يبدأ موعد استشارتك خلال ساعة تقريبًا.',
    };
  },
};
```

Add a `DAILY_TRAINING_REMINDER` entry right after it, before the closing `};`:

```typescript
  CONSULTATION_REMINDER: (ctx) => {
    const isDayBefore = ctx.leadTime === 'DAY_BEFORE';
    return {
      title: isDayBefore ? 'تذكير: استشارتك غدًا' : 'تذكير: استشارتك خلال ساعة',
      body: isDayBefore
        ? 'لديك موعد استشارة غدًا. يرجى الاستعداد لحضورها في الوقت المحدد.'
        : 'يبدأ موعد استشارتك خلال ساعة تقريبًا.',
    };
  },
  DAILY_TRAINING_REMINDER: (ctx) => ({
    title: 'تذكير بالتدريب اليومي',
    body: `أكملت ${ctx.completedToday} من ${ctx.targetPerDay} تدريبات اليوم. أكمل جرعتك اليومية للاستمرار في تقدمك.`,
  }),
};
```

- [ ] **Step 5: Verify the app still builds and existing tests pass**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: all existing tests still pass unchanged (no new behavior yet) — 66 unit, 250 e2e.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/notifications/notifications.service.ts
git commit -m "feat: add lastDailyReminderSentAt field and DAILY_TRAINING_REMINDER notification type"
```

---

### Task 2: Extract shared day-period status computation

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-sessions.service.ts:127-155`

**Interfaces:**
- Consumes: nothing new — this is a pure internal refactor of existing code.
- Produces: `TrainingSessionsService.computeDailyStatus(cycleId: string, firstTrainingEventAt: Date | null, cycleCreatedAt: Date): Promise<{ completedToday: number; periodStart: Date }>` — consumed by Task 3, and by `getProgress` itself (refactored to delegate to it).

- [ ] **Step 1: Extract `computeDailyStatus` and refactor `getProgress` to use it**

In `backend/src/modules/treatment-engine/training-sessions.service.ts`, `getProgress` currently reads (lines 127-155):

```typescript
  async getProgress(
    cycleId: string,
    actor: AuthenticatedUser,
  ): Promise<{ completedToday: number; targetPerDay: number; intervalActive: boolean; nextAvailableAt: string | null; currentSessionId: string | null }> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const { intervalActive, nextAvailableAt } = await this.resolveIntervalStatus(cycleId);

    let completedToday = 0;
    if (cycle.firstTrainingEventAt) {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const startMs = cycle.firstTrainingEventAt.getTime();
      const currentPeriodIndex = Math.floor((Date.now() - startMs) / DAY_MS);
      const periodStart = new Date(startMs + currentPeriodIndex * DAY_MS);
      const periodEnd = new Date(startMs + (currentPeriodIndex + 1) * DAY_MS);
      completedToday = await this.prisma.trainingSession.count({
        where: { trainingCycleId: cycleId, status: 'COMPLETED', completedAt: { gte: periodStart, lt: periodEnd } },
      });
    }

    const inProgress = await this.prisma.trainingSession.findFirst({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });

    return {
      completedToday,
      targetPerDay: DAILY_TARGET_TRAININGS,
      intervalActive,
      nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
      currentSessionId: inProgress?.id ?? null,
    };
  }
```

Replace it with this (moves the period-boundary math into a new public method, `getProgress` now delegates to it):

```typescript
  async computeDailyStatus(
    cycleId: string,
    firstTrainingEventAt: Date | null,
    cycleCreatedAt: Date,
  ): Promise<{ completedToday: number; periodStart: Date }> {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const anchorMs = (firstTrainingEventAt ?? cycleCreatedAt).getTime();
    const currentPeriodIndex = Math.floor((Date.now() - anchorMs) / DAY_MS);
    const periodStart = new Date(anchorMs + currentPeriodIndex * DAY_MS);
    const periodEnd = new Date(anchorMs + (currentPeriodIndex + 1) * DAY_MS);

    let completedToday = 0;
    if (firstTrainingEventAt) {
      completedToday = await this.prisma.trainingSession.count({
        where: { trainingCycleId: cycleId, status: 'COMPLETED', completedAt: { gte: periodStart, lt: periodEnd } },
      });
    }

    return { completedToday, periodStart };
  }

  async getProgress(
    cycleId: string,
    actor: AuthenticatedUser,
  ): Promise<{ completedToday: number; targetPerDay: number; intervalActive: boolean; nextAvailableAt: string | null; currentSessionId: string | null }> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const { intervalActive, nextAvailableAt } = await this.resolveIntervalStatus(cycleId);
    const { completedToday } = await this.computeDailyStatus(cycleId, cycle.firstTrainingEventAt, cycle.createdAt);

    const inProgress = await this.prisma.trainingSession.findFirst({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });

    return {
      completedToday,
      targetPerDay: DAILY_TARGET_TRAININGS,
      intervalActive,
      nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
      currentSessionId: inProgress?.id ?? null,
    };
  }
```

This is a pure extraction: `completedToday`'s value for every existing scenario is computed by the exact same math as before (same anchor, same period-boundary formula, same query), only reached through a named method instead of being inlined. `periodStart` is new output the old code never returned — that's what Task 3 needs.

- [ ] **Step 2: Run the existing training-sessions e2e suite to confirm no regression**

Run: `npm run test:e2e -- treatment-engine-training-sessions` (from `backend/`)
Expected: all 13 existing tests in this file still PASS unchanged — in particular the two `getProgress`-covering tests ("counts only sessions completed within the current 24h period as completedToday" and "reports intervalActive and nextAvailableAt consistently with the start-session gate") must still pass with identical assertions, proving the refactor didn't change `getProgress`'s observable behavior.

- [ ] **Step 3: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 250 e2e (no new tests yet, this task adds no new behavior).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/treatment-engine/training-sessions.service.ts
git commit -m "refactor: extract computeDailyStatus from getProgress for reuse by the reminder sweep"
```

---

### Task 3: Daily training reminder sweep

**Files:**
- Create: `backend/src/modules/treatment-engine/training-reminder-sweep.service.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Test: `backend/test/treatment-engine-daily-training-reminder.e2e-spec.ts`

**Interfaces:**
- Consumes: `TrainingSessionsService.resolveIntervalStatus(cycleId: string): Promise<{ intervalActive: boolean; nextAvailableAt: Date | null }>` (Task from §55-62), `TrainingSessionsService.computeDailyStatus(cycleId: string, firstTrainingEventAt: Date | null, cycleCreatedAt: Date): Promise<{ completedToday: number; periodStart: Date }>` (Task 2), `DAILY_TARGET_TRAININGS` (exported constant from `training-sessions.service.ts`), `NotificationsService.create(recipientUserId: string, type: NotificationType, context: Record<string, string>, related?: { entity: string; entityId: string }): Promise<Notification>`, `TrainingCycle72h.lastDailyReminderSentAt` (Task 1).
- Produces: nothing consumed by a later task — this is the final task in the plan.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/treatment-engine-daily-training-reminder.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingReminderSweepService } from '../src/modules/treatment-engine/training-reminder-sweep.service';

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

describe('Daily Training Reminder sweep (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweepService: TrainingReminderSweepService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sweepService = app.get(TrainingReminderSweepService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function setupActiveCycle(clinicianMobile: string, patientMobile: string, watchHumanModel = true) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id, fullName: 'Reminder Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `REMINDER-${Date.now()}-${Math.random()}` },
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

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    if (watchHumanModel) {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(201);
    }

    return { clinicianToken, patientToken, patientProfile, cycleId: startRes.body.id as string };
  }

  it('sends a reminder when the interval has cleared and today\'s target has not been met', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009000', '+966500009001');
    const completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago — the 1h interval has cleared
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: completedAt } });
    await prisma.trainingSession.create({ data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(1);
    const updatedCycle = await prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
    expect(updatedCycle.lastDailyReminderSentAt).not.toBeNull();
  });

  it('does not send a reminder while the interval is still active', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009002', '+966500009003');
    const completedAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago — the 1h interval is still active
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: completedAt } });
    await prisma.trainingSession.create({ data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a reminder once today\'s target of 7 trainings is already met', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009004', '+966500009005');
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: start } });
    for (let i = 0; i < 7; i++) {
      // Spaced 1 minute apart, all within the last 3 hours — irrelevant to the interval gate here (the
      // last one is still well over an hour in the past), this test isolates the daily-target gate.
      await prisma.trainingSession.create({
        data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(start.getTime() + i * 60 * 1000) },
      });
    }

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a second reminder on a repeated sweep within the same day-period', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009006', '+966500009007');
    const completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: completedAt } });
    await prisma.trainingSession.create({ data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt } });

    await sweepService.runSweep();
    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(1);
  });

  it('sends again once a new day-period has rolled over past the last reminder', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009008', '+966500009009');
    const start = new Date(Date.now() - 26 * 60 * 60 * 1000); // 26 hours ago — currently in period 1 (24h-48h from start)
    await prisma.trainingCycle72h.update({
      where: { id: cycleId },
      data: { firstTrainingEventAt: start, lastDailyReminderSentAt: new Date(start.getTime() + 5 * 60 * 60 * 1000) }, // stamped during period 0
    });
    // One completed session in period 0 (so the interval gate resolves against a timestamp well over an hour old).
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(start.getTime() + 5 * 60 * 60 * 1000) },
    });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(1);
  });

  it('does not send a reminder for a cycle whose human model has not been watched yet', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009010', '+966500009011', false);

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('does not send a reminder for a cycle that is not ACTIVE_LEVEL_TRAINING', async () => {
    const { patientProfile, cycleId } = await setupActiveCycle('+966500009012', '+966500009013');
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'SAMPLE_ELIGIBLE' } });

    await sweepService.runSweep();

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: patientProfile.userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-daily-training-reminder` (from `backend/`)
Expected: FAIL — `TrainingReminderSweepService` doesn't exist yet, so `app.get(TrainingReminderSweepService)` throws.

- [ ] **Step 3: Create the sweep service**

Create `backend/src/modules/treatment-engine/training-reminder-sweep.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrainingSessionsService, DAILY_TARGET_TRAININGS } from './training-sessions.service';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class TrainingReminderSweepService {
  private readonly logger = new Logger(TrainingReminderSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingSessionsService: TrainingSessionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { status: 'ACTIVE_LEVEL_TRAINING', closedAt: null, humanModelWatchedAt: { not: null } },
      include: { patientProfile: true },
    });

    for (const cycle of cycles) {
      const { intervalActive } = await this.trainingSessionsService.resolveIntervalStatus(cycle.id);
      if (intervalActive) {
        continue;
      }

      const { completedToday, periodStart } = await this.trainingSessionsService.computeDailyStatus(
        cycle.id,
        cycle.firstTrainingEventAt,
        cycle.createdAt,
      );
      if (completedToday >= DAILY_TARGET_TRAININGS) {
        continue;
      }

      if (cycle.lastDailyReminderSentAt && cycle.lastDailyReminderSentAt >= periodStart) {
        continue;
      }

      try {
        await this.notificationsService.create(
          cycle.patientProfile.userId,
          'DAILY_TRAINING_REMINDER',
          { completedToday: String(completedToday), targetPerDay: String(DAILY_TARGET_TRAININGS) },
          { entity: 'TrainingCycle72h', entityId: cycle.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send DAILY_TRAINING_REMINDER for cycle ${cycle.id}: ${err}`);
      }
      await this.prisma.trainingCycle72h.update({ where: { id: cycle.id }, data: { lastDailyReminderSentAt: new Date() } });
    }
  }
}
```

- [ ] **Step 4: Wire the service into the module**

In `backend/src/modules/treatment-engine/treatment-engine.module.ts`, add the import:

```typescript
import { TrainingReminderSweepService } from './training-reminder-sweep.service';
```

(Place it after the `TrainingSessionsService` import.)

Change:

```typescript
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService],
```

to:

```typescript
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService, TrainingReminderSweepService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService, TrainingReminderSweepService],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-daily-training-reminder` (from `backend/`)
Expected: all 7 tests PASS.

- [ ] **Step 6: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 257 e2e (250 + 7 new).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/training-reminder-sweep.service.ts backend/src/modules/treatment-engine/treatment-engine.module.ts backend/test/treatment-engine-daily-training-reminder.e2e-spec.ts
git commit -m "feat: add the daily training reminder sweep (§100)"
```

---

## Self-Review Notes

- **Spec coverage:** "sends reminders to reach the target dose (7/day)" → Task 3's `runSweep` sending `DAILY_TRAINING_REMINDER` while `completedToday < DAILY_TARGET_TRAININGS`. "respecting the interval, no reminder before a training becomes available" → the `intervalActive` skip in Task 3, reusing Task-2-untouched `resolveIntervalStatus`. "does not keep reminding about a training already completed [today]" → the `completedToday >= DAILY_TARGET_TRAININGS` skip. Per-period idempotency (not spec-literal but necessary to avoid spamming every 15 minutes) → the `lastDailyReminderSentAt >= periodStart` skip, tested directly.
- **No placeholders:** every step has complete, runnable code including the full new test file and the exact before/after diffs for the two modified files.
- **Type consistency:** `computeDailyStatus`'s signature (`cycleId: string, firstTrainingEventAt: Date | null, cycleCreatedAt: Date`) is identical in its Task 2 definition, its Task 2 caller (`getProgress`), and its Task 3 caller (the sweep). `DAILY_TARGET_TRAININGS` is imported by name in Task 3 exactly as it's exported from Task 2's file (already exported since §55-62, untouched by this plan). `lastDailyReminderSentAt` is spelled identically across the Task 1 schema field, the Task 3 service, and every Task 3 test.
