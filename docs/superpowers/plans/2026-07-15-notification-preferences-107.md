# §107 Notification Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a patient disable `DAILY_TRAINING_REMINDER` (the only non-critical `NotificationType` that exists today) while guaranteeing every other notification type — all either tied to a clinical decision, a confirmed appointment, or an action required to continue the program, or not patient-facing at all — can never be silenced.

**Architecture:** A new `NotificationPreference` table (per-user, per-type, lazily created). `NotificationsService.create` gains one guard, checked only for types in a hardcoded allow-list (`GATEABLE_NOTIFICATION_TYPES`, currently just `['DAILY_TRAINING_REMINDER']`). Two new endpoints on the existing `NotificationsController` let a user read/write their own preferences.

**Tech Stack:** NestJS, Prisma, `nestjs-zod` DTOs, Jest + Supertest e2e (no mocks).

## Global Constraints

- `GATEABLE_NOTIFICATION_TYPES: NotificationType[] = ['DAILY_TRAINING_REMINDER']` — the only type that can ever be disabled. This is an allow-list, not a deny-list: any `NotificationType` not in this array is critical-by-default and the `PATCH` endpoint must reject attempts to set a preference for it with `400 Bad Request`.
- No row in `NotificationPreference` means "enabled" — never pre-seed rows; only write one when a user explicitly changes a preference.
- `NotificationsService.create`'s return type changes from `Promise<Notification>` to `Promise<Notification | null>` — every existing call site already ignores the return value (see Task 1 for the verified list), so this requires no other file changes.
- Preference endpoints are scoped to the caller's own identity only (`@CurrentUser()`), reusing `Permission.VIEW_OWN_NOTIFICATIONS` (already granted to every role) — there is no cross-user access path since neither endpoint ever accepts a target user ID.
- Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`. Current baseline on this branch: 66 unit tests (9 suites), 269 e2e tests (37 suites) — all passing before Task 1 starts.

---

### Task 1: Data model and enforcement mechanism

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/notifications/notifications.service.ts`
- Test: `backend/test/notification-preferences-enforcement.e2e-spec.ts`

**Interfaces:**
- Produces: `NotificationPreference` Prisma model, `GATEABLE_NOTIFICATION_TYPES: NotificationType[]` (exported from `notifications.service.ts`), `NotificationsService.create(...): Promise<Notification | null>` (return type widened) — all consumed by Task 2.

- [ ] **Step 1: Add the `NotificationPreference` model**

In `backend/prisma/schema.prisma`, the `Notification` model and the start of the `NotificationType` enum currently read (lines 576-591):

```prisma
model Notification {
  id              String           @id @default(uuid())
  recipientUserId String
  recipient       User             @relation(fields: [recipientUserId], references: [id])
  type            NotificationType
  title           String
  body            String
  relatedEntity   String?
  relatedEntityId String?
  readAt          DateTime?
  createdAt       DateTime         @default(now())

  @@index([recipientUserId, createdAt])
}

enum NotificationType {
```

Insert a new `NotificationPreference` model between them:

```prisma
model Notification {
  id              String           @id @default(uuid())
  recipientUserId String
  recipient       User             @relation(fields: [recipientUserId], references: [id])
  type            NotificationType
  title           String
  body            String
  relatedEntity   String?
  relatedEntityId String?
  readAt          DateTime?
  createdAt       DateTime         @default(now())

  @@index([recipientUserId, createdAt])
}

model NotificationPreference {
  id        String           @id @default(uuid())
  userId    String
  user      User             @relation(fields: [userId], references: [id])
  type      NotificationType
  enabled   Boolean
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  @@unique([userId, type])
}

enum NotificationType {
```

- [ ] **Step 2: Add the reverse relation on `User`**

In `backend/prisma/schema.prisma`, the `User` model's relation block currently ends (line 162):

```prisma
  supervisorUser            User?             @relation("ClinicianSupervisor", fields: [supervisorUserId], references: [id])
  supervisedClinicians      User[]            @relation("ClinicianSupervisor")
  notifications             Notification[]
}
```

Add `notificationPreferences` right after `notifications`:

```prisma
  supervisorUser            User?             @relation("ClinicianSupervisor", fields: [supervisorUserId], references: [id])
  supervisedClinicians      User[]            @relation("ClinicianSupervisor")
  notifications             Notification[]
  notificationPreferences   NotificationPreference[]
}
```

- [ ] **Step 3: Format and run the migration**

Run: `npx prisma format` (from `backend/`)
Run: `npx prisma migrate dev --name add_notification_preference` (from `backend/`)
Expected: a new migration folder under `backend/prisma/migrations/` is created and applied with no errors (a new table only — no changes to any existing table); Prisma Client regenerates automatically.

- [ ] **Step 4: Write the failing e2e tests for the enforcement guard**

Create `backend/test/notification-preferences-enforcement.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

async function registerPatient(app: INestApplication, prisma: PrismaService, mobile: string): Promise<{ userId: string }> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
  return { userId };
}

describe('Notification preferences — enforcement in NotificationsService.create (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notificationsService: NotificationsService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    notificationsService = app.get(NotificationsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('creates a notification for a gateable type when no preference row exists (default enabled)', async () => {
    const { userId } = await registerPatient(app, prisma, '+966500007000');

    const result = await notificationsService.create(userId, 'DAILY_TRAINING_REMINDER', { completedToday: '2', targetPerDay: '7' });

    expect(result).not.toBeNull();
    const notifications = await prisma.notification.findMany({ where: { recipientUserId: userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(1);
  });

  it('does not create a notification when the recipient has explicitly disabled a gateable type', async () => {
    const { userId } = await registerPatient(app, prisma, '+966500007001');
    await prisma.notificationPreference.create({ data: { userId, type: 'DAILY_TRAINING_REMINDER', enabled: false } });

    const result = await notificationsService.create(userId, 'DAILY_TRAINING_REMINDER', { completedToday: '2', targetPerDay: '7' });

    expect(result).toBeNull();
    const notifications = await prisma.notification.findMany({ where: { recipientUserId: userId, type: 'DAILY_TRAINING_REMINDER' } });
    expect(notifications).toHaveLength(0);
  });

  it('still creates a notification for a non-gateable type even if a preference row exists with enabled: false', async () => {
    const { userId } = await registerPatient(app, prisma, '+966500007002');
    // Seeded directly via Prisma to prove create()'s guard is scoped to GATEABLE_NOTIFICATION_TYPES,
    // not "any row that happens to exist" — the real PATCH endpoint (Task 2) would never let this
    // row be created through the API itself.
    await prisma.notificationPreference.create({ data: { userId, type: 'SPECIALIST_DECISION_ISSUED', enabled: false } });

    const result = await notificationsService.create(userId, 'SPECIALIST_DECISION_ISSUED', { decision: 'TRANSITION', levelName: 'Level 1' });

    expect(result).not.toBeNull();
    const notifications = await prisma.notification.findMany({ where: { recipientUserId: userId, type: 'SPECIALIST_DECISION_ISSUED' } });
    expect(notifications).toHaveLength(1);
  });

  it('scopes the preference to the individual user, not globally', async () => {
    const { userId: disabledUserId } = await registerPatient(app, prisma, '+966500007003');
    const { userId: defaultUserId } = await registerPatient(app, prisma, '+966500007004');
    await prisma.notificationPreference.create({ data: { userId: disabledUserId, type: 'DAILY_TRAINING_REMINDER', enabled: false } });

    const disabledResult = await notificationsService.create(disabledUserId, 'DAILY_TRAINING_REMINDER', { completedToday: '2', targetPerDay: '7' });
    const defaultResult = await notificationsService.create(defaultUserId, 'DAILY_TRAINING_REMINDER', { completedToday: '2', targetPerDay: '7' });

    expect(disabledResult).toBeNull();
    expect(defaultResult).not.toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm run test:e2e -- notification-preferences-enforcement` (from `backend/`)
Expected: FAIL — `NotificationsService.create` doesn't check any preference yet, so the "disabled" tests get a non-null result instead of `null`.

- [ ] **Step 6: Add the enforcement guard**

In `backend/src/modules/notifications/notifications.service.ts`, the imports and `create` method currently read (lines 1-4, 73-83):

```typescript
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
```

```typescript
  async create(
    recipientUserId: string,
    type: NotificationType,
    context: Record<string, string>,
    related?: { entity: string; entityId: string },
  ): Promise<Notification> {
    const { title, body } = NOTIFICATION_TEMPLATES[type](context);
    return this.prisma.notification.create({
      data: { recipientUserId, type, title, body, relatedEntity: related?.entity, relatedEntityId: related?.entityId },
    });
  }
```

Replace the imports with (adding `BadRequestException`):

```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
```

Add the allow-list constant right after `DECISION_LABELS` (before `NOTIFICATION_TEMPLATES`):

```typescript
export const GATEABLE_NOTIFICATION_TYPES: NotificationType[] = ['DAILY_TRAINING_REMINDER'];
```

Replace `create` with:

```typescript
  async create(
    recipientUserId: string,
    type: NotificationType,
    context: Record<string, string>,
    related?: { entity: string; entityId: string },
  ): Promise<Notification | null> {
    if (GATEABLE_NOTIFICATION_TYPES.includes(type)) {
      const preference = await this.prisma.notificationPreference.findUnique({
        where: { userId_type: { userId: recipientUserId, type } },
      });
      if (preference && !preference.enabled) {
        return null;
      }
    }
    const { title, body } = NOTIFICATION_TEMPLATES[type](context);
    return this.prisma.notification.create({
      data: { recipientUserId, type, title, body, relatedEntity: related?.entity, relatedEntityId: related?.entityId },
    });
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:e2e -- notification-preferences-enforcement` (from `backend/`)
Expected: all 4 tests PASS.

- [ ] **Step 8: Confirm no existing call site breaks from the widened return type**

`create`'s return type is now `Promise<Notification | null>`. Confirm every existing call site still compiles and behaves correctly by running the full suite (next step) — every current call site (`consultation-reminders.service.ts:50`, `samples.service.ts` via `notifyRole`, `specialist-workload-reminder-sweep.service.ts:49`, `specialist-review.service.ts:140,185,235`, `training-cycles.service.ts:162,172`, `training-reminder-sweep.service.ts:46`, `training-sessions.service.ts:102`) is a bare `await this.notificationsService.create(...)`/`notifyRole(...)` with the return value never captured, so no code changes are needed at any of them — this step is verification only, not implementation.

- [ ] **Step 9: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 273 e2e (269 + 4 new).

- [ ] **Step 10: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/notifications/notifications.service.ts backend/test/notification-preferences-enforcement.e2e-spec.ts
git commit -m "feat: add NotificationPreference model and enforce it in NotificationsService.create"
```

---

### Task 2: Preference endpoints and end-to-end enforcement

**Files:**
- Create: `backend/src/modules/notifications/dto/update-notification-preference.dto.ts`
- Modify: `backend/src/modules/notifications/notifications.service.ts`
- Modify: `backend/src/modules/notifications/notifications.controller.ts`
- Test: `backend/test/notification-preferences.e2e-spec.ts`

**Interfaces:**
- Consumes: `GATEABLE_NOTIFICATION_TYPES: NotificationType[]` (Task 1), `NotificationsService.create(...): Promise<Notification | null>` (Task 1), `TrainingReminderSweepService.runSweep(): Promise<void>` (existing, §100).
- Produces: `NotificationsService.listPreferencesForUser(userId: string): Promise<Array<{ type: NotificationType; enabled: boolean }>>`, `NotificationsService.updatePreference(userId: string, type: string, enabled: boolean): Promise<{ type: NotificationType; enabled: boolean }>` — both consumed only by the controller in this same task; nothing later depends on them.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/notification-preferences.e2e-spec.ts`:

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

describe('Notification preferences — endpoints (e2e)', () => {
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

  it('defaults every gateable type to enabled when no preference has been set', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007010', null);

    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([{ type: 'DAILY_TRAINING_REMINDER', enabled: true }]);
  });

  it('persists a disabled preference and reflects it on a subsequent GET', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007011', null);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/DAILY_TRAINING_REMINDER')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual([{ type: 'DAILY_TRAINING_REMINDER', enabled: false }]);
  });

  it('allows toggling a preference back to enabled (upsert, not insert-only)', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007012', null);
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/DAILY_TRAINING_REMINDER')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/DAILY_TRAINING_REMINDER')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual([{ type: 'DAILY_TRAINING_REMINDER', enabled: true }]);
  });

  it('rejects an attempt to disable a real but non-gateable (critical) notification type', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007013', null);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/SPECIALIST_DECISION_ISSUED')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(400);
  });

  it('rejects a preference update for a string that is not a real notification type', async () => {
    const token = await registerAndLogin(app, prisma, '+966500007014', null);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/NOT_A_REAL_TYPE')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(400);
  });

  async function setupActiveCycle(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id,
        fullName: 'Preference Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: `PREF-${Date.now()}-${Math.random()}`,
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: `Level ${Date.now()}`, order: Math.floor(Math.random() * 100000) } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const cycleId = startRes.body.id as string;
    const completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago — interval cleared, target not met
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: completedAt } });
    await prisma.trainingSession.create({ data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt } });

    return { patientToken, patientProfile };
  }

  it('a patient who disabled DAILY_TRAINING_REMINDER via the real endpoint gets none from a real sweep, while a patient who never touched it still does', async () => {
    const { patientToken: disabledPatientToken, patientProfile: disabledPatientProfile } = await setupActiveCycle('+966500007015', '+966500007016');
    const { patientProfile: defaultPatientProfile } = await setupActiveCycle('+966500007017', '+966500007018');

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/DAILY_TRAINING_REMINDER')
      .set('Authorization', `Bearer ${disabledPatientToken}`)
      .send({ enabled: false })
      .expect(200);

    await sweepService.runSweep();

    const disabledPatientNotifications = await prisma.notification.findMany({
      where: { recipientUserId: disabledPatientProfile.userId, type: 'DAILY_TRAINING_REMINDER' },
    });
    expect(disabledPatientNotifications).toHaveLength(0);

    const defaultPatientNotifications = await prisma.notification.findMany({
      where: { recipientUserId: defaultPatientProfile.userId, type: 'DAILY_TRAINING_REMINDER' },
    });
    expect(defaultPatientNotifications).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:e2e -- notification-preferences.e2e-spec` (from `backend/`)
Expected: FAIL — `GET`/`PATCH .../preferences...` routes don't exist yet (404s).

- [ ] **Step 3: Add the DTO**

Create `backend/src/modules/notifications/dto/update-notification-preference.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateNotificationPreferenceSchema = z.object({
  enabled: z.boolean(),
});

export class UpdateNotificationPreferenceDto extends createZodDto(UpdateNotificationPreferenceSchema) {}
```

- [ ] **Step 4: Add the service methods**

In `backend/src/modules/notifications/notifications.service.ts`, add these two methods to the `NotificationsService` class, right after `create` and before `notifyRole`:

```typescript
  async listPreferencesForUser(userId: string): Promise<Array<{ type: NotificationType; enabled: boolean }>> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId, type: { in: GATEABLE_NOTIFICATION_TYPES } },
    });
    const enabledByType = new Map(rows.map((r) => [r.type, r.enabled]));
    return GATEABLE_NOTIFICATION_TYPES.map((type) => ({ type, enabled: enabledByType.get(type) ?? true }));
  }

  async updatePreference(userId: string, type: string, enabled: boolean): Promise<{ type: NotificationType; enabled: boolean }> {
    if (!GATEABLE_NOTIFICATION_TYPES.includes(type as NotificationType)) {
      throw new BadRequestException(`${type} is not a notification type that can be disabled`);
    }
    const gateableType = type as NotificationType;
    await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: gateableType } },
      create: { userId, type: gateableType, enabled },
      update: { enabled },
    });
    return { type: gateableType, enabled };
  }
```

- [ ] **Step 5: Add the controller routes**

In `backend/src/modules/notifications/notifications.controller.ts`, the file currently reads:

```typescript
import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/notifications')
@UseGuards(SessionGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listForUser(user.id);
  }

  @Patch(':notificationId/read')
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async markRead(@Param('notificationId') notificationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markRead(notificationId, user);
  }
}
```

Replace it with:

```typescript
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';

@Controller('api/v1/notifications')
@UseGuards(SessionGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listForUser(user.id);
  }

  @Patch(':notificationId/read')
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async markRead(@Param('notificationId') notificationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markRead(notificationId, user);
  }

  @Get('preferences')
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async listPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listPreferencesForUser(user.id);
  }

  @Patch('preferences/:type')
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async updatePreference(@Param('type') type: string, @Body() dto: UpdateNotificationPreferenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.updatePreference(user.id, type, dto.enabled);
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:e2e -- notification-preferences.e2e-spec` (from `backend/`)
Expected: all 6 tests PASS.

- [ ] **Step 7: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 279 e2e (273 + 6 new).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/notifications/dto/update-notification-preference.dto.ts backend/src/modules/notifications/notifications.service.ts backend/src/modules/notifications/notifications.controller.ts backend/test/notification-preferences.e2e-spec.ts
git commit -m "feat: add notification preference endpoints (§107)"
```

---

## Self-Review Notes

- **Spec coverage:** "المستفيد يستطيع ضبط بعض تفضيلات الإشعارات غير الحرجة" (patient can adjust some non-critical preferences) → Task 2's `GET`/`PATCH .../preferences` scoped to `GATEABLE_NOTIFICATION_TYPES = ['DAILY_TRAINING_REMINDER']`, the one type classified non-critical in the design's table. "الإشعارات الأساسية... لا تختفي" (essential notifications never disappear) → Task 1's `create()` guard only checks the allow-list, and Task 2's `updatePreference` rejects any attempt to set a preference for a non-gateable type with `400`, tested directly against a real critical type (`SPECIALIST_DECISION_ISSUED`).
- **No placeholders:** every step has complete, runnable code including the full two new test files and the exact before/after diffs for both modified files.
- **Type consistency:** `GATEABLE_NOTIFICATION_TYPES` is spelled and typed identically (`NotificationType[]`) across its Task 1 definition, its Task 1 use inside `create`, and its Task 2 uses inside `listPreferencesForUser`/`updatePreference`. `listPreferencesForUser`'s return shape (`Array<{ type: NotificationType; enabled: boolean }>`) matches exactly what Task 2's tests assert against (`[{ type: 'DAILY_TRAINING_REMINDER', enabled: true }]`).
- **Task-order dependency verified:** Task 1's tests exercise `NotificationsService.create` and seed `NotificationPreference` rows directly via Prisma, with no dependency on Task 2's endpoints — fully testable on its own, matching the plan's task order.
