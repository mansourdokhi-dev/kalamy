# §99 Admin-Configurable Notification Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin adjust the four notification lead-time values that are currently hardcoded constants (two in `SpecialistWorkloadReminderSweepService`, two in `ConsultationRemindersService`), and record which channel every notification was sent on.

**Architecture:** A new generic `NotificationSetting` key-value table plus `NotificationSettingsService` (living in the existing `notifications` module, so both consuming sweep services — which already import `NotificationsModule` — can inject it with no new module wiring). Both sweeps switch from reading a module-level constant to reading the setting (falling back to the same constant as a default when no row exists). A new admin-only `NotificationSettingsController` exposes `GET`/`PATCH`. A new `channel` column on `Notification` defaults to `IN_APP`, the only channel that exists.

**Tech Stack:** NestJS, Prisma, `nestjs-zod` DTOs, Jest + Supertest e2e (no mocks).

## Global Constraints

- The only four settings this plan makes configurable, each an allow-listed key in `NOTIFICATION_SETTING_DEFAULTS_MS`:
  - `SPECIALIST_WORKLOAD_REVIEW_LEAD_MS` (default `24 * 60 * 60 * 1000`)
  - `SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS` (default `24 * 60 * 60 * 1000`)
  - `CONSULTATION_REMINDER_DAY_BEFORE_MS` (default `24 * 60 * 60 * 1000`)
  - `CONSULTATION_REMINDER_HOUR_BEFORE_MS` (default `60 * 60 * 1000`)
- `updatePreference`... i.e. `NotificationSettingsService.updateValue` must reject (`400`): a `key` not in the allow-list; a non-positive `valueMs`; `SPECIALIST_WORKLOAD_REVIEW_LEAD_MS` set `>=` the 48h review-decision window (`REVIEW_DECISION_WINDOW_MS` in `specialist-review.service.ts`); `SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS` set `>=` the 7-day intervention window (`7 * 24 * 60 * 60 * 1000`); and any update to `CONSULTATION_REMINDER_DAY_BEFORE_MS`/`CONSULTATION_REMINDER_HOUR_BEFORE_MS` that would leave `hourBefore >= dayBefore` (checked against the *other* key's current effective value — stored override if one exists, else its own default).
- No row in `NotificationSetting` means "use the hardcoded default" — never pre-seed rows.
- `Notification.channel` defaults to `IN_APP` (the only value in the new `NotificationChannel` enum) — every existing and new row gets it automatically, no code at any of the ~10 `notificationsService.create`/`notifyRole` call sites needs to change.
- New permission `MANAGE_NOTIFICATION_SETTINGS`, granted only to `ADMIN` (not `SUPERVISOR`).
- Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`. Current baseline on this branch: 66 unit tests (9 suites), 279 e2e tests (39 suites) — all passing before Task 1 starts.

---

### Task 1: Data model and `NotificationSettingsService`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/src/modules/notifications/notification-settings.service.ts`
- Modify: `backend/src/modules/notifications/notifications.module.ts`
- Test: `backend/test/notification-settings-service.e2e-spec.ts`

**Interfaces:**
- Produces: `NotificationSetting` Prisma model, `NotificationChannel` enum + `Notification.channel` field, `NOTIFICATION_SETTING_DEFAULTS_MS: Record<string, number>` (exported), `NotificationSettingsService.getValueMs(key: string): Promise<number>`, `.listAll(): Promise<Array<{ key: string; valueMs: number }>>`, `.updateValue(key: string, valueMs: number): Promise<{ key: string; valueMs: number }>` — all consumed by Task 2 (endpoints), Task 3 (specialist-workload sweep), and Task 4 (consultation sweep).

- [ ] **Step 1: Add the `NotificationSetting` model and the `channel` field**

In `backend/prisma/schema.prisma`, the `Notification` and `NotificationPreference` models and the start of `NotificationType` currently read (lines 577-604):

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

Replace with (adding `channel` to `Notification`, adding the new `NotificationSetting` model, and adding the new `NotificationChannel` enum right before `NotificationType`):

```prisma
model Notification {
  id              String              @id @default(uuid())
  recipientUserId String
  recipient       User                @relation(fields: [recipientUserId], references: [id])
  type            NotificationType
  channel         NotificationChannel @default(IN_APP)
  title           String
  body            String
  relatedEntity   String?
  relatedEntityId String?
  readAt          DateTime?
  createdAt       DateTime            @default(now())

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

model NotificationSetting {
  key       String   @id
  valueMs   Int
  updatedAt DateTime @updatedAt
}

enum NotificationChannel {
  IN_APP
}

enum NotificationType {
```

- [ ] **Step 2: Format and run the migration**

Run: `npx prisma format` (from `backend/`)
Run: `npx prisma migrate dev --name add_notification_settings_and_channel` (from `backend/`)
Expected: a new migration folder is created and applied with no errors — one new table (`NotificationSetting`), one new enum (`NotificationChannel`), one new column with a default (`Notification.channel`, backfilling every existing row to `IN_APP`). No changes to any other existing column.

- [ ] **Step 3: Write the failing e2e tests for `NotificationSettingsService`**

Create `backend/test/notification-settings-service.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationSettingsService } from '../src/modules/notifications/notification-settings.service';

describe('NotificationSettingsService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settingsService: NotificationSettingsService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    settingsService = app.get(NotificationSettingsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('getValueMs returns the hardcoded default when no row exists', async () => {
    const value = await settingsService.getValueMs('CONSULTATION_REMINDER_HOUR_BEFORE_MS');
    expect(value).toBe(60 * 60 * 1000);
  });

  it('listAll returns all four keys with defaults when nothing has been overridden', async () => {
    const all = await settingsService.listAll();
    expect(all).toEqual(
      expect.arrayContaining([
        { key: 'SPECIALIST_WORKLOAD_REVIEW_LEAD_MS', valueMs: 24 * 60 * 60 * 1000 },
        { key: 'SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS', valueMs: 24 * 60 * 60 * 1000 },
        { key: 'CONSULTATION_REMINDER_DAY_BEFORE_MS', valueMs: 24 * 60 * 60 * 1000 },
        { key: 'CONSULTATION_REMINDER_HOUR_BEFORE_MS', valueMs: 60 * 60 * 1000 },
      ]),
    );
    expect(all).toHaveLength(4);
  });

  it('updateValue persists an override that getValueMs then returns', async () => {
    await settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 30 * 60 * 1000);

    const value = await settingsService.getValueMs('CONSULTATION_REMINDER_HOUR_BEFORE_MS');
    expect(value).toBe(30 * 60 * 1000);
  });

  it('rejects a key not in the allow-list', async () => {
    await expect(settingsService.updateValue('NOT_A_REAL_SETTING', 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-positive valueMs', async () => {
    await expect(settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 0)).rejects.toThrow(BadRequestException);
    await expect(settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', -1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects a specialist-workload review lead time at or above the 48h window', async () => {
    await expect(settingsService.updateValue('SPECIALIST_WORKLOAD_REVIEW_LEAD_MS', 48 * 60 * 60 * 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects a specialist-workload intervention lead time at or above the 7-day window', async () => {
    await expect(settingsService.updateValue('SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS', 7 * 24 * 60 * 60 * 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects an hour-before value that would be >= the current day-before value', async () => {
    await expect(settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 24 * 60 * 60 * 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects a day-before value that would be <= the current hour-before value', async () => {
    await settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 2 * 60 * 60 * 1000);

    await expect(settingsService.updateValue('CONSULTATION_REMINDER_DAY_BEFORE_MS', 2 * 60 * 60 * 1000)).rejects.toThrow(BadRequestException);
  });

  it('allows a day-before/hour-before combination where the ordering genuinely holds', async () => {
    await settingsService.updateValue('CONSULTATION_REMINDER_HOUR_BEFORE_MS', 2 * 60 * 60 * 1000);

    const result = await settingsService.updateValue('CONSULTATION_REMINDER_DAY_BEFORE_MS', 12 * 60 * 60 * 1000);
    expect(result).toEqual({ key: 'CONSULTATION_REMINDER_DAY_BEFORE_MS', valueMs: 12 * 60 * 60 * 1000 });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test:e2e -- notification-settings-service` (from `backend/`)
Expected: FAIL — `NotificationSettingsService` doesn't exist yet, so `app.get(NotificationSettingsService)` throws.

- [ ] **Step 5: Create `NotificationSettingsService`**

Create `backend/src/modules/notifications/notification-settings.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const NOTIFICATION_SETTING_DEFAULTS_MS: Record<string, number> = {
  SPECIALIST_WORKLOAD_REVIEW_LEAD_MS: 24 * 60 * 60 * 1000,
  SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS: 24 * 60 * 60 * 1000,
  CONSULTATION_REMINDER_DAY_BEFORE_MS: 24 * 60 * 60 * 1000,
  CONSULTATION_REMINDER_HOUR_BEFORE_MS: 60 * 60 * 1000,
};

const REVIEW_DECISION_WINDOW_MS = 48 * 60 * 60 * 1000;
const INTERVENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getValueMs(key: string): Promise<number> {
    const row = await this.prisma.notificationSetting.findUnique({ where: { key } });
    return row?.valueMs ?? NOTIFICATION_SETTING_DEFAULTS_MS[key];
  }

  async listAll(): Promise<Array<{ key: string; valueMs: number }>> {
    return Promise.all(
      Object.keys(NOTIFICATION_SETTING_DEFAULTS_MS).map(async (key) => ({ key, valueMs: await this.getValueMs(key) })),
    );
  }

  async updateValue(key: string, valueMs: number): Promise<{ key: string; valueMs: number }> {
    if (!(key in NOTIFICATION_SETTING_DEFAULTS_MS)) {
      throw new BadRequestException(`${key} is not a configurable notification setting`);
    }
    if (!Number.isInteger(valueMs) || valueMs <= 0) {
      throw new BadRequestException('valueMs must be a positive integer');
    }
    if (key === 'SPECIALIST_WORKLOAD_REVIEW_LEAD_MS' && valueMs >= REVIEW_DECISION_WINDOW_MS) {
      throw new BadRequestException('SPECIALIST_WORKLOAD_REVIEW_LEAD_MS must be less than the 48h review-decision window');
    }
    if (key === 'SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS' && valueMs >= INTERVENTION_WINDOW_MS) {
      throw new BadRequestException('SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS must be less than the 7-day intervention window');
    }
    if (key === 'CONSULTATION_REMINDER_HOUR_BEFORE_MS') {
      const dayBefore = await this.getValueMs('CONSULTATION_REMINDER_DAY_BEFORE_MS');
      if (valueMs >= dayBefore) {
        throw new BadRequestException('CONSULTATION_REMINDER_HOUR_BEFORE_MS must be less than CONSULTATION_REMINDER_DAY_BEFORE_MS');
      }
    }
    if (key === 'CONSULTATION_REMINDER_DAY_BEFORE_MS') {
      const hourBefore = await this.getValueMs('CONSULTATION_REMINDER_HOUR_BEFORE_MS');
      if (valueMs <= hourBefore) {
        throw new BadRequestException('CONSULTATION_REMINDER_DAY_BEFORE_MS must be greater than CONSULTATION_REMINDER_HOUR_BEFORE_MS');
      }
    }

    await this.prisma.notificationSetting.upsert({
      where: { key },
      create: { key, valueMs },
      update: { valueMs },
    });
    return { key, valueMs };
  }
}
```

- [ ] **Step 6: Wire the service into the module**

In `backend/src/modules/notifications/notifications.module.ts`, the file currently reads:

```typescript
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

Replace with:

```typescript
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSettingsService } from './notification-settings.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSettingsService],
  exports: [NotificationsService, NotificationSettingsService],
})
export class NotificationsModule {}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:e2e -- notification-settings-service` (from `backend/`)
Expected: all 10 tests PASS.

- [ ] **Step 8: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 289 e2e (279 + 10 new).

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/notifications/notification-settings.service.ts backend/src/modules/notifications/notifications.module.ts backend/test/notification-settings-service.e2e-spec.ts
git commit -m "feat: add NotificationSetting model, channel field, and NotificationSettingsService"
```

---

### Task 2: Admin endpoints

**Files:**
- Create: `backend/src/modules/notifications/dto/update-notification-setting.dto.ts`
- Create: `backend/src/modules/notifications/notification-settings.controller.ts`
- Modify: `backend/src/modules/notifications/notifications.module.ts`
- Modify: `backend/src/common/rbac/permissions.ts`
- Test: `backend/test/notification-settings.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationSettingsService.listAll()`, `.updateValue(key, valueMs)` (Task 1).
- Produces: nothing consumed by a later task in this plan.

- [ ] **Step 1: Add the `MANAGE_NOTIFICATION_SETTINGS` permission**

In `backend/src/common/rbac/permissions.ts`, the `Permission` enum currently ends (line 44):

```typescript
  VIEW_OWN_NOTIFICATIONS = 'VIEW_OWN_NOTIFICATIONS',
}
```

Add `MANAGE_NOTIFICATION_SETTINGS` right after it:

```typescript
  VIEW_OWN_NOTIFICATIONS = 'VIEW_OWN_NOTIFICATIONS',
  MANAGE_NOTIFICATION_SETTINGS = 'MANAGE_NOTIFICATION_SETTINGS',
}
```

In the same file, the `ADMIN` role's permission array currently ends (lines 166-168):

```typescript
    Permission.MANAGE_CONSULTATION,
    Permission.VIEW_OWN_NOTIFICATIONS,
  ],
};
```

Add `MANAGE_NOTIFICATION_SETTINGS` to the `ADMIN` array only (not `PATIENT`, `CAREGIVER`, `CLINICIAN`, or `SUPERVISOR`):

```typescript
    Permission.MANAGE_CONSULTATION,
    Permission.VIEW_OWN_NOTIFICATIONS,
    Permission.MANAGE_NOTIFICATION_SETTINGS,
  ],
};
```

- [ ] **Step 2: Write the failing e2e tests**

Create `backend/test/notification-settings.e2e-spec.ts`:

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

describe('Notification settings — admin endpoints (e2e)', () => {
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

  it('lists all four settings with defaults for an admin', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500008000', 'ADMIN');

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/notification-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveLength(4);
    expect(res.body).toEqual(
      expect.arrayContaining([{ key: 'CONSULTATION_REMINDER_HOUR_BEFORE_MS', valueMs: 60 * 60 * 1000 }]),
    );
  });

  it('persists an update and reflects it on a subsequent GET', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500008001', 'ADMIN');

    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_HOUR_BEFORE_MS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 30 * 60 * 1000 })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/notification-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual(expect.arrayContaining([{ key: 'CONSULTATION_REMINDER_HOUR_BEFORE_MS', valueMs: 30 * 60 * 1000 }]));
  });

  it('rejects an update for a key not in the allow-list', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500008002', 'ADMIN');

    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/NOT_A_REAL_SETTING')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 1000 })
      .expect(400);
  });

  it('rejects an hour-before/day-before combination that would violate the non-overlap invariant', async () => {
    const adminToken = await registerAndLogin(app, prisma, '+966500008003', 'ADMIN');

    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_HOUR_BEFORE_MS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 24 * 60 * 60 * 1000 })
      .expect(400);
  });

  it('rejects a clinician (not an admin) from reading or writing settings', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500008004', 'CLINICIAN');

    await request(app.getHttpServer())
      .get('/api/v1/admin/notification-settings')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_HOUR_BEFORE_MS')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ valueMs: 1000 })
      .expect(403);
  });

  it('rejects a supervisor (not an admin) from managing settings', async () => {
    const supervisorToken = await registerAndLogin(app, prisma, '+966500008005', 'SUPERVISOR');

    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_HOUR_BEFORE_MS')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ valueMs: 1000 })
      .expect(403);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:e2e -- notification-settings.e2e-spec` (from `backend/`)
Expected: FAIL — the `/api/v1/admin/notification-settings` routes don't exist yet (404s), and the permission doesn't exist yet either.

- [ ] **Step 4: Add the DTO**

Create `backend/src/modules/notifications/dto/update-notification-setting.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateNotificationSettingSchema = z.object({
  valueMs: z.number().int().positive(),
});

export class UpdateNotificationSettingDto extends createZodDto(UpdateNotificationSettingSchema) {}
```

- [ ] **Step 5: Add the controller**

Create `backend/src/modules/notifications/notification-settings.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationSettingsService } from './notification-settings.service';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';

@Controller('api/v1/admin/notification-settings')
@UseGuards(SessionGuard, PermissionsGuard)
export class NotificationSettingsController {
  constructor(private readonly notificationSettingsService: NotificationSettingsService) {}

  @Get()
  @RequirePermission(Permission.MANAGE_NOTIFICATION_SETTINGS)
  async list() {
    return this.notificationSettingsService.listAll();
  }

  @Patch(':key')
  @RequirePermission(Permission.MANAGE_NOTIFICATION_SETTINGS)
  async update(@Param('key') key: string, @Body() dto: UpdateNotificationSettingDto) {
    return this.notificationSettingsService.updateValue(key, dto.valueMs);
  }
}
```

- [ ] **Step 6: Wire the controller into the module**

In `backend/src/modules/notifications/notifications.module.ts` (as left by Task 1):

```typescript
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSettingsService } from './notification-settings.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSettingsService],
  exports: [NotificationsService, NotificationSettingsService],
})
export class NotificationsModule {}
```

Replace with:

```typescript
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationSettingsController } from './notification-settings.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, NotificationSettingsController],
  providers: [NotificationsService, NotificationSettingsService],
  exports: [NotificationsService, NotificationSettingsService],
})
export class NotificationsModule {}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:e2e -- notification-settings.e2e-spec` (from `backend/`)
Expected: all 6 tests PASS.

- [ ] **Step 8: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 295 e2e (289 + 6 new).

- [ ] **Step 9: Commit**

```bash
git add backend/src/common/rbac/permissions.ts backend/src/modules/notifications/dto/update-notification-setting.dto.ts backend/src/modules/notifications/notification-settings.controller.ts backend/src/modules/notifications/notifications.module.ts backend/test/notification-settings.e2e-spec.ts
git commit -m "feat: add admin endpoints for notification settings (§99)"
```

---

### Task 3: Wire settings into the specialist-workload reminder sweep

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-workload-reminder-sweep.service.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Test: `backend/test/treatment-engine-specialist-workload-reminder.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationSettingsService.getValueMs(key: string): Promise<number>` (Task 1), `NotificationSettingsService.updateValue(key, valueMs)` (Task 1, used only by the new test via the real admin endpoint from Task 2).

- [ ] **Step 1: Write the failing e2e test**

Open `backend/test/treatment-engine-specialist-workload-reminder.e2e-spec.ts`. Add this test inside the existing `describe(...)` block, after the last existing `it(...)` and before the closing `});`. It reuses the file's existing `setupReservedSample` helper:

```typescript
  it('uses an admin-configured review lead time instead of the hardcoded default', async () => {
    const { clinicianUserId, sampleId } = await setupReservedSample('+966500006016', '+966500006017');
    // 30h remaining on the 48h deadline — outside the hardcoded 24h default's lead window, so a
    // sweep against the default sends nothing yet.
    await prisma.speechSample.update({ where: { id: sampleId }, data: { reviewDeadlineAt: new Date(Date.now() + 30 * 60 * 60 * 1000) } });

    await sweepService.runSweep();
    const notificationsBefore = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notificationsBefore).toHaveLength(0);

    // Widen the lead time to 36h (still under the 48h window cap) — the same 30h-remaining
    // deadline now falls inside the window, without moving the deadline itself.
    const adminToken = await registerAndLogin(app, prisma, '+966500006018', 'ADMIN');
    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/SPECIALIST_WORKLOAD_REVIEW_LEAD_MS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 36 * 60 * 60 * 1000 })
      .expect(200);

    await sweepService.runSweep();

    const notificationsAfter = await prisma.notification.findMany({ where: { recipientUserId: clinicianUserId, type: 'SPECIALIST_WORKLOAD_REMINDER' } });
    expect(notificationsAfter).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- treatment-engine-specialist-workload-reminder` (from `backend/`)
Expected: FAIL — the sweep still reads the hardcoded `REVIEW_REMINDER_LEAD_MS` (24h) constant, unaffected by the admin `PATCH`, so the second `runSweep()` call still sees 30h remaining against a 24h lead (outside the window) and sends nothing — `notificationsAfter` stays at length 0, not 1.

- [ ] **Step 3: Switch the sweep to read settings**

In `backend/src/modules/treatment-engine/specialist-workload-reminder-sweep.service.ts`, the file currently reads:

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

Replace with (removing the two lead-time constants, injecting `NotificationSettingsService`, and reading the value per sample):

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { getNotificationContext } from '../notifications/notification-context.util';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class SpecialistWorkloadReminderSweepService {
  private readonly logger = new Logger(SpecialistWorkloadReminderSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationSettingsService: NotificationSettingsService,
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
      const leadTimeMs = await this.notificationSettingsService.getValueMs(
        isIntervention ? 'SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS' : 'SPECIALIST_WORKLOAD_REVIEW_LEAD_MS',
      );
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

Nothing in `treatment-engine.module.ts` needs to change: it already imports `NotificationsModule` (which now exports `NotificationSettingsService` per Task 1's Step 6), and Nest resolves the new constructor dependency automatically.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:e2e -- treatment-engine-specialist-workload-reminder` (from `backend/`)
Expected: all tests in this file PASS, including the new one.

- [ ] **Step 5: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 296 e2e (295 + 1 new).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-workload-reminder-sweep.service.ts backend/test/treatment-engine-specialist-workload-reminder.e2e-spec.ts
git commit -m "feat: make specialist-workload reminder lead times admin-configurable"
```

---

### Task 4: Wire settings into the consultation reminder sweep

**Files:**
- Modify: `backend/src/modules/consultations/consultation-reminders.service.ts`
- Test: `backend/test/consultation-reminders.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationSettingsService.getValueMs(key: string): Promise<number>` (Task 1), `NotificationSettingsService.updateValue(key, valueMs)` (Task 1, used only by the new test via the real admin endpoint from Task 2).
- Produces: nothing consumed by a later task — this is the final task in the plan.

- [ ] **Step 1: Write the failing e2e test**

Open `backend/test/consultation-reminders.e2e-spec.ts`. Add this test inside the existing `describe(...)` block, after the last existing `it(...)` and before the closing `});`. It reuses the file's existing `registerAndLogin` and `setupScheduledConsultation` helpers:

```typescript
  it('uses an admin-configured day-before window instead of the hardcoded default', async () => {
    // Scheduled 30 hours from now — outside the hardcoded 24h default day-before window (1h, 24h],
    // so with defaults this sends nothing yet.
    const { patientToken } = await setupScheduledConsultation('+966500007010', new Date(Date.now() + 30 * 60 * 60 * 1000));

    await remindersService.runSweep();
    const beforeRes = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(beforeRes.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER')).toHaveLength(0);

    const adminToken = await registerAndLogin(app, prisma, '+966500007011', 'ADMIN');
    await request(app.getHttpServer())
      .patch('/api/v1/admin/notification-settings/CONSULTATION_REMINDER_DAY_BEFORE_MS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valueMs: 48 * 60 * 60 * 1000 })
      .expect(200);

    await remindersService.runSweep();
    const afterRes = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(afterRes.body.filter((n: { type: string }) => n.type === 'CONSULTATION_REMINDER')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- consultation-reminders.e2e-spec` (from `backend/`)
Expected: FAIL — the sweep still reads the hardcoded `DAY_BEFORE_WINDOW_MS` (24h) constant, so the consultation scheduled 30 hours out never qualifies even after the admin update, and `afterRes` still shows 0.

- [ ] **Step 3: Switch the sweep to read settings**

In `backend/src/modules/consultations/consultation-reminders.service.ts`, the file currently reads:

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
    // The day-before window's lower bound is pinned to the hour-before window's
    // upper bound so the two windows never overlap: a consultation scheduled
    // within the next hour is only ever eligible for the hour-before reminder,
    // even on a single sweep that has never run against it before.
    await this.sendDueReminders(now, HOUR_BEFORE_WINDOW_MS, DAY_BEFORE_WINDOW_MS, 'dayBeforeReminderSentAt', 'DAY_BEFORE');
    await this.sendDueReminders(now, 0, HOUR_BEFORE_WINDOW_MS, 'hourBeforeReminderSentAt', 'HOUR_BEFORE');
  }

  private async sendDueReminders(
```

Replace with (removing the two window constants, injecting `NotificationSettingsService`, and resolving both values once per tick before calling `sendDueReminders`):

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type ReminderStampField = 'dayBeforeReminderSentAt' | 'hourBeforeReminderSentAt';

@Injectable()
export class ConsultationRemindersService {
  private readonly logger = new Logger(ConsultationRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationSettingsService: NotificationSettingsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async runSweep(): Promise<void> {
    const now = new Date();
    const dayBeforeWindowMs = await this.notificationSettingsService.getValueMs('CONSULTATION_REMINDER_DAY_BEFORE_MS');
    const hourBeforeWindowMs = await this.notificationSettingsService.getValueMs('CONSULTATION_REMINDER_HOUR_BEFORE_MS');
    // The day-before window's lower bound is pinned to the hour-before window's
    // upper bound so the two windows never overlap: a consultation scheduled
    // within the next hour is only ever eligible for the hour-before reminder,
    // even on a single sweep that has never run against it before. This ordering
    // is enforced by NotificationSettingsService.updateValue whenever either
    // setting changes, so hourBeforeWindowMs < dayBeforeWindowMs always holds here.
    await this.sendDueReminders(now, hourBeforeWindowMs, dayBeforeWindowMs, 'dayBeforeReminderSentAt', 'DAY_BEFORE');
    await this.sendDueReminders(now, 0, hourBeforeWindowMs, 'hourBeforeReminderSentAt', 'HOUR_BEFORE');
  }

  private async sendDueReminders(
```

`consultations.module.ts` needs no change: it already imports `NotificationsModule`, which now exports `NotificationSettingsService`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:e2e -- consultation-reminders.e2e-spec` (from `backend/`)
Expected: all tests in this file PASS, including the new one.

- [ ] **Step 5: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: everything PASSES — 66 unit, 297 e2e (296 + 1 new).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/consultations/consultation-reminders.service.ts backend/test/consultation-reminders.e2e-spec.ts
git commit -m "feat: make consultation reminder windows admin-configurable (§99)"
```

---

## Self-Review Notes

- **Spec coverage:** "توقيت الإرسال... يجب ألا تكون رسائل التذكير ومواعيدها مثبتة داخل الكود" (send timing must not be hardcoded) → Tasks 3 and 4 replace all four previously-hardcoded lead-time constants with settings lookups, each proven via a real admin-endpoint-then-real-sweep test, not a Prisma shortcut. "تحفظ المنصة سجلًا لكل إشعار... القناة" (log includes channel) → Task 1's `Notification.channel` field. "نوع الحدث، المستلم... عدد مرات التكرار، ووقت التوقف" (event type, recipient, repeat count, stop time) → deliberately not built; the design spec's classification table gives the reasoning for each, matching this project's established pattern of narrowing an over-broad spec clause with explicit written justification rather than silently dropping it.
- **No placeholders:** every step has complete, runnable code including the two full new test files, the two extended existing test files' new cases, and the exact before/after diffs for every modified file.
- **Type consistency:** `NOTIFICATION_SETTING_DEFAULTS_MS`'s four keys are spelled identically across Task 1's definition, Task 1's own tests, Task 2's tests, Task 3's `getValueMs` calls, and Task 4's `getValueMs` calls — verified by direct string comparison while writing each task. `NotificationSettingsService.getValueMs(key: string): Promise<number>` and `.updateValue(key: string, valueMs: number): Promise<{ key: string; valueMs: number }>` are used with identical signatures everywhere they're consumed.
- **Cross-task ordering verified:** Task 1's tests exercise `NotificationSettingsService` directly with no dependency on Task 2's endpoints. Task 3's and Task 4's new tests depend on Task 2's real `PATCH` endpoint (deliberately, per the design's "drive it through the real endpoint" testing discipline) — both tasks list Task 2's endpoint as a consumed interface, and the plan's task order places Task 2 before both.
- **Invariant protection verified:** Task 1's `updateValue` validation (Global Constraints) is the single enforcement point for the day-before/hour-before non-overlap invariant identified in the design's "A real invariant this design must protect" section — Task 4's sweep code comment explicitly notes that `NotificationSettingsService.updateValue` is what guarantees `hourBeforeWindowMs < dayBeforeWindowMs` always holds by the time `runSweep` reads both values, so `sendDueReminders` itself doesn't need its own defensive check.
