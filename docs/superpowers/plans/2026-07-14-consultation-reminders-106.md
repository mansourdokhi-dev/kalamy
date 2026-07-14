# §106 Consultation Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a patient a reminder one day before and one hour before their scheduled consultation, with reminders correctly suppressed on cancellation and re-armed on reschedule.

**Architecture:** The first proactive, time-based notification trigger in this project. A new `ConsultationRemindersService` runs a `@nestjs/schedule` `@Interval` sweep every 5 minutes, computing which consultations are newly "due" for a reminder from existing `Consultation` fields (`status`, `scheduledAt`) plus two new nullable "already sent" timestamps — the same "compute due-ness live, then mark it done" idempotency pattern already used everywhere else in this project (§98's inactivity check, Specialist Review v2's SLA timers, §102's submission-delay check), just triggered by a timer instead of a request.

**Tech Stack:** NestJS, `@nestjs/schedule`, Prisma, Jest + Supertest (e2e against a real Postgres, no mocks).

## Global Constraints

- Single-instance assumption: the `@Interval` sweep runs in-process. No new queue, no Redis, no distributed lock — matches every other infrastructure decision in this project so far.
- Reminder lead times are hardcoded constants (24h, 1h) — no admin-configurability in this pass.
- Recipient is the patient only (via `Consultation.patientProfile.userId`) — never the assigned specialist.
- One `NotificationType` value (`CONSULTATION_REMINDER`), not two — its template branches on a `leadTime` context value (`'DAY_BEFORE'` | `'HOUR_BEFORE'`).
- Every notification send is wrapped in try/catch with `Logger.error(...)` on failure — a notification failure must never stop the sweep from processing the rest of the batch, and the "already sent" timestamp is still stamped even if the notify call fails (there is no other business state here to protect; the stamp itself is what prevents a retry-storm on a persistently-failing case).
- Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`.

---

### Task 1: Schema, dependency, and notification template

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/notifications/notifications.service.ts:12-38`

**Interfaces:**
- Produces: `Consultation.dayBeforeReminderSentAt: DateTime | null`, `Consultation.hourBeforeReminderSentAt: DateTime | null`, `NotificationType.CONSULTATION_REMINDER` — all consumed by Task 2. Task 3 also consumes the two new `Consultation` fields.

- [ ] **Step 1: Add the `@nestjs/schedule` dependency**

Run: `npm install @nestjs/schedule` (from `backend/`) — no version pin, so npm resolves whatever current release is compatible with this project's installed `@nestjs/core@^11.1.27`.
Expected: `backend/package.json`'s `dependencies` gains a `"@nestjs/schedule"` entry, and `node_modules`/`package-lock.json` update accordingly. If npm reports a peer-dependency warning about the Nest core version, that's expected noise (this project already sees similar warnings from other packages) and not a failure — only stop and report if the install itself errors out.

- [ ] **Step 2: Add the schema changes**

In `backend/prisma/schema.prisma`, change the `Consultation` model (currently lines 517-537) to add the two new fields right after `scheduledAt`:

```prisma
model Consultation {
  id                       String             @id @default(uuid())
  patientProfileId         String
  patientProfile           PatientProfile     @relation(fields: [patientProfileId], references: [id])
  requestedByUserId        String
  requestedByUser          User               @relation("ConsultationRequestedBy", fields: [requestedByUserId], references: [id])
  type                     ConsultationType
  status                   ConsultationStatus @default(REQUESTED)
  reasonNote               String?
  scheduledAt              DateTime?
  dayBeforeReminderSentAt  DateTime?
  hourBeforeReminderSentAt DateTime?
  externalMeetingLink      String?
  specialistUserId         String?
  specialistUser           User?              @relation("ConsultationSpecialist", fields: [specialistUserId], references: [id])
  outcomeNotes             String?
  completedAt              DateTime?
  cancelledAt              DateTime?
  createdAt                DateTime           @default(now())
  updatedAt                DateTime           @updatedAt

  @@index([patientProfileId])
}
```

Change the `NotificationType` enum (currently lines 567-575) to add the new value after `SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR`:

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

Run: `npx prisma migrate dev --name add_consultation_reminder_fields` (from `backend/`)
Expected: A new migration folder is created and the command reports success; the Prisma client is regenerated with the two new fields and the new enum value.

- [ ] **Step 3: Add the notification template**

In `backend/src/modules/notifications/notifications.service.ts`, add this entry to `NOTIFICATION_TEMPLATES` (currently lines 12-37), after the existing `SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR` entry:

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
```

- [ ] **Step 4: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES — this task only adds a dependency, schema, and a template; nothing consumes them yet, so no existing behavior changes.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/notifications/notifications.service.ts
git commit -m "feat: add consultation reminder fields, dependency, and notification template"
```

---

### Task 2: The reminder sweep

**Files:**
- Create: `backend/src/modules/consultations/consultation-reminders.service.ts`
- Modify: `backend/src/modules/consultations/consultations.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/consultation-reminders.e2e-spec.ts` (new file)

**Interfaces:**
- Consumes: `NotificationsService.create(recipientUserId, type, context, related?)` (already exists), `Consultation.dayBeforeReminderSentAt`/`.hourBeforeReminderSentAt`/`NotificationType.CONSULTATION_REMINDER` (Task 1).
- Produces: `ConsultationRemindersService.runSweep(): Promise<void>` — a public method (not just the `@Interval`-decorated entry point) so tests can invoke it directly without waiting on a real 5-minute timer. Task 3 does not depend on this service directly.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/consultation-reminders.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConsultationRemindersService } from '../src/modules/consultations/consultation-reminders.service';

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

describe('Consultation Reminders sweep (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let remindersService: ConsultationRemindersService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    remindersService = app.get(ConsultationRemindersService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function setupScheduledConsultation(mobile: string, scheduledAt: Date) {
    const patientToken = await registerAndLogin(app, prisma, mobile, null);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
    const profile = await prisma.patientProfile.create({
      data: { userId, fullName: 'Reminder Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `REMINDER-${Date.now()}-${Math.random()}` },
    });
    const consultation = await prisma.consultation.create({
      data: {
        patientProfileId: profile.id,
        requestedByUserId: userId,
        type: 'VOICE',
        status: 'SCHEDULED',
        scheduledAt,
      },
    });
    return { patientToken, consultation };
  }

  it('sends a day-before reminder for a consultation scheduled 23 hours from now', async () => {
    const { patientToken, consultation } = await setupScheduledConsultation('+966500007000', new Date(Date.now() + 23 * 60 * 60 * 1000));

    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const found = notifications.body.find((n: { type: string }) => n.type === 'CONSULTATION_REMINDER');
    expect(found).toBeTruthy();

    const updated = await prisma.consultation.findUniqueOrThrow({ where: { id: consultation.id } });
    expect(updated.dayBeforeReminderSentAt).not.toBeNull();
    expect(updated.hourBeforeReminderSentAt).toBeNull();
  });

  it('does not send a second day-before reminder on a repeated sweep', async () => {
    const { patientToken } = await setupScheduledConsultation('+966500007001', new Date(Date.now() + 23 * 60 * 60 * 1000));

    await remindersService.runSweep();
    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const matches = notifications.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER');
    expect(matches).toHaveLength(1);
  });

  it('sends an hour-before reminder for a consultation scheduled 45 minutes from now', async () => {
    const { patientToken, consultation } = await setupScheduledConsultation('+966500007002', new Date(Date.now() + 45 * 60 * 1000));

    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(notifications.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER')).toHaveLength(1);

    const updated = await prisma.consultation.findUniqueOrThrow({ where: { id: consultation.id } });
    expect(updated.hourBeforeReminderSentAt).not.toBeNull();
  });

  it('sends no reminder for a consultation scheduled 3 days from now', async () => {
    const { patientToken } = await setupScheduledConsultation('+966500007003', new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));

    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(notifications.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER')).toHaveLength(0);
  });

  it('sends no reminder for a cancelled consultation even if its old scheduledAt is within the window', async () => {
    const { patientToken, consultation } = await setupScheduledConsultation('+966500007004', new Date(Date.now() + 30 * 60 * 1000));
    await prisma.consultation.update({ where: { id: consultation.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });

    await remindersService.runSweep();

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(notifications.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- consultation-reminders` (from `backend/`)
Expected: FAIL — `ConsultationRemindersService` doesn't exist yet, so the import fails and every test errors.

- [ ] **Step 3: Write `ConsultationRemindersService`**

Create `backend/src/modules/consultations/consultation-reminders.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY_BEFORE_WINDOW_MS = 24 * 60 * 60 * 1000;
const HOUR_BEFORE_WINDOW_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type ReminderStampField = 'dayBeforeReminderSentAt' | 'hourBeforeReminderSentAt';

@Injectable()
export class ConsultationRemindersService {
  private readonly logger = new Logger(ConsultationRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const now = new Date();
    await this.sendDueReminders(now, DAY_BEFORE_WINDOW_MS, 'dayBeforeReminderSentAt', 'DAY_BEFORE');
    await this.sendDueReminders(now, HOUR_BEFORE_WINDOW_MS, 'hourBeforeReminderSentAt', 'HOUR_BEFORE');
  }

  private async sendDueReminders(
    now: Date,
    windowMs: number,
    stampField: ReminderStampField,
    leadTime: 'DAY_BEFORE' | 'HOUR_BEFORE',
  ): Promise<void> {
    const due = await this.prisma.consultation.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { gt: now, lte: new Date(now.getTime() + windowMs) },
        [stampField]: null,
      },
      include: { patientProfile: true },
    });

    for (const consultation of due) {
      try {
        await this.notificationsService.create(
          consultation.patientProfile.userId,
          'CONSULTATION_REMINDER',
          { leadTime },
          { entity: 'Consultation', entityId: consultation.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send CONSULTATION_REMINDER (${leadTime}) for consultation ${consultation.id}: ${err}`);
      }
      await this.prisma.consultation.update({ where: { id: consultation.id }, data: { [stampField]: now } });
    }
  }
}
```

- [ ] **Step 4: Wire the service into the module and register `ScheduleModule` globally**

In `backend/src/app.module.ts`, add the import:

```typescript
import { ScheduleModule } from '@nestjs/schedule';
```

Add `ScheduleModule.forRoot()` to the `imports` array (currently lines 24-40), right after `ConfigModule.forRoot({ isGlobal: true })`:

```typescript
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ...
```

In `backend/src/modules/consultations/consultations.module.ts`, add the import and the `NotificationsModule` dependency:

```typescript
import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { ConsultationRemindersService } from './consultation-reminders.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, PatientAccessModule, NotificationsModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService, ConsultationRemindersService],
  exports: [ConsultationsService, ConsultationRemindersService],
})
export class ConsultationsModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- consultation-reminders` (from `backend/`)
Expected: All 5 tests PASS.

- [ ] **Step 6: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/consultations/consultation-reminders.service.ts backend/src/modules/consultations/consultations.module.ts backend/src/app.module.ts backend/test/consultation-reminders.e2e-spec.ts
git commit -m "feat: add the consultation reminder sweep (day-before and hour-before)"
```

---

### Task 3: Reset reminder flags on reschedule

**Files:**
- Modify: `backend/src/modules/consultations/consultations.service.ts:49-91`
- Test: `backend/test/consultation-reminders.e2e-spec.ts`

**Interfaces:**
- Consumes: `Consultation.dayBeforeReminderSentAt`/`.hourBeforeReminderSentAt` (Task 1).
- Produces: no new exported interface — modifies `ConsultationsService.update`'s existing behavior, keeping its exact existing signature.

- [ ] **Step 1: Write the failing test**

Add this test to `backend/test/consultation-reminders.e2e-spec.ts`, inside the existing `describe(...)` block, after the existing five tests:

```typescript
  it('resets both reminder flags when a consultation is rescheduled to a new time', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500007005', 'CLINICIAN');
    const { consultation } = await setupScheduledConsultation('+966500007006', new Date(Date.now() + 23 * 60 * 60 * 1000));

    await prisma.consultation.update({
      where: { id: consultation.id },
      data: { dayBeforeReminderSentAt: new Date(), hourBeforeReminderSentAt: new Date() },
    });

    const newScheduledAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await request(app.getHttpServer())
      .patch(`/api/v1/consultations/${consultation.id}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ scheduledAt: newScheduledAt.toISOString() })
      .expect(200);

    const updated = await prisma.consultation.findUniqueOrThrow({ where: { id: consultation.id } });
    expect(updated.dayBeforeReminderSentAt).toBeNull();
    expect(updated.hourBeforeReminderSentAt).toBeNull();
    expect(updated.scheduledAt?.getTime()).toBe(newScheduledAt.getTime());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- consultation-reminders` (from `backend/`)
Expected: The new test FAILS — both timestamps are still set to their pre-reschedule values, since nothing resets them yet.

- [ ] **Step 3: Reset the flags on reschedule**

In `backend/src/modules/consultations/consultations.service.ts`, change the `update` method's transaction body (currently lines 64-85):

```typescript
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Consultation" WHERE id = ${consultationId} FOR UPDATE`;

      const fresh = await tx.consultation.findUniqueOrThrow({ where: { id: consultationId } });
      if (TERMINAL_STATUSES.includes(fresh.status)) {
        return { blocked: true as const, status: fresh.status };
      }

      const updated = await tx.consultation.update({
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
      return { blocked: false as const, consultation: updated };
    });
```

to:

```typescript
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Consultation" WHERE id = ${consultationId} FOR UPDATE`;

      const fresh = await tx.consultation.findUniqueOrThrow({ where: { id: consultationId } });
      if (TERMINAL_STATUSES.includes(fresh.status)) {
        return { blocked: true as const, status: fresh.status };
      }

      const newScheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : undefined;
      // A patient who reschedules must still get reminders for their new time — leaving
      // stale "already sent" stamps from the old time would silently drop both reminders
      // instead of re-arming them, since the sweep only ever looks at whether each stamp
      // is still null.
      const scheduledAtChanged = newScheduledAt !== undefined && newScheduledAt.getTime() !== fresh.scheduledAt?.getTime();

      const updated = await tx.consultation.update({
        where: { id: consultationId },
        data: {
          status: dto.status,
          scheduledAt: newScheduledAt,
          externalMeetingLink: dto.externalMeetingLink,
          outcomeNotes: dto.outcomeNotes,
          specialistUserId: dto.status ? actor.id : undefined,
          completedAt: dto.status === 'COMPLETED' ? new Date() : undefined,
          cancelledAt: dto.status === 'CANCELLED' ? new Date() : undefined,
          ...(scheduledAtChanged ? { dayBeforeReminderSentAt: null, hourBeforeReminderSentAt: null } : {}),
        },
      });
      return { blocked: false as const, consultation: updated };
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- consultation-reminders` (from `backend/`)
Expected: All 6 tests in the file PASS.

- [ ] **Step 5: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES — in particular `consultations.e2e-spec.ts`, whose existing scheduling tests must be unaffected by this change (they never reschedule an already-reminded consultation, so the new reset logic is a no-op for them).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/consultations/consultations.service.ts backend/test/consultation-reminders.e2e-spec.ts
git commit -m "fix: reset consultation reminder flags when rescheduled to a new time"
```

---

## Self-Review Notes

- **Spec coverage:** Scheduling mechanism (in-process `@Interval`, 5-minute sweep) → Task 2. Two new fields + one `NotificationType` → Task 1. Day-before/hour-before windows and idempotency → Task 2's 5 tests. Auto-cancellation (no code needed, just a status filter) → Task 2's cancelled-consultation test. Reschedule resets flags → Task 3. Patient-only recipient → every test asserts against the patient's own token, never a specialist's. Hardcoded lead times, in-app only, no admin-configurability → satisfied by construction (no config surface exists anywhere in this plan).
- **No placeholders:** every step has complete, runnable code.
- **Type consistency:** `ConsultationRemindersService.runSweep(): Promise<void>` (Task 2) is called identically by the test file's `remindersService.runSweep()` calls, both in Task 2's own tests and Task 3's. `ReminderStampField` and the `sendDueReminders` private helper's signature are used consistently within the one file that defines them. `Consultation.dayBeforeReminderSentAt`/`.hourBeforeReminderSentAt` (Task 1) are read by Task 2 and reset by Task 3 using the exact same field names throughout.
