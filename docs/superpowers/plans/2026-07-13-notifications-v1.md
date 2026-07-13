# Notifications v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-app notification engine (`docs/superpowers/specs/2026-07-13-notifications-v1-design.md`) and wire it into the three Specialist Review v2 events that already fire today: 24h-unreserved escalation, a specialist decision being issued, and a 7-day intervention timeout.

**Architecture:** A new standalone `NotificationsModule` (mirroring `ConsultationsModule`) owns a `Notification` Prisma model, a `NotificationsService` with `create`/`notifyRole`/`listForUser`/`markRead`, and a `NotificationsController` exposing `GET /api/v1/notifications` + `PATCH /api/v1/notifications/:notificationId/read`. `SpecialistReviewService` gets `NotificationsService` injected and calls it inline (synchronous, no queue/event-bus) at the three points where `evaluateReviewDeadlines`/`review()` already mutate state.

**Tech Stack:** NestJS + Prisma + Zod (`nestjs-zod`) — unchanged libraries, matching every prior backend module in this project.

## Global Constraints

- Backend DTOs use `nestjs-zod`'s `createZodDto` pattern exactly as existing DTOs do (see `backend/src/modules/consultations/dto/request-consultation.dto.ts`).
- Every backend endpoint is guarded by `@UseGuards(SessionGuard, PermissionsGuard)` at the controller level and `@RequirePermission(Permission.X)` per method.
- Backend e2e tests live in `backend/test/*.e2e-spec.ts`, run against a real Postgres via `npm run test:e2e -- <pattern>` (from `backend/`). Each `describe` block re-declares its own local `registerAndLogin`-style helper rather than sharing a utils file (see `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts` for the exact pattern to copy).
- Time-based tests backdate a real timestamp field directly via `prisma.<model>.update({ data: { someDateField: new Date(Date.now() - N * 60 * 60 * 1000) } })` — no fake-timer convention exists in this codebase's e2e tests.
- No real SMS/push/email delivery, no event bus, no message queue, no background job scheduler, no admin-editable templates, no per-user notification preferences, no mobile UI — all explicitly out of scope per the design spec's "Scope decisions" and "Non-goals restated" sections. Do not add any of these.
- Notification creation is synchronous and inline at the exact point the triggering event fires, exactly like the existing `AuditLog` writes in `specialist-review.service.ts` — do not introduce retries, async dispatch, or a queue.
- `NotificationsService.notifyRole` escalation notifications go to `SUPERVISOR` only, not `ADMIN` — a deliberate narrowing decided during design (see design spec §"Wiring into specialist-review.service.ts", point 1). Do not broaden this without asking the founder first.

---

### Task 1: Prisma schema — `Notification` model + `NotificationType` enum

**Files:**
- Modify: `backend/prisma/schema.prisma` (`User` model — add back-relation; new `Notification` model + `NotificationType` enum)
- Test: none (schema/migration only — exercised by every later task's e2e tests)

**Interfaces:**
- Produces: `Notification` model with fields `id/recipientUserId/type/title/body/relatedEntity/relatedEntityId/readAt/createdAt`; `NotificationType` enum with values `SAMPLE_ESCALATED_TO_SUPERVISOR`, `SPECIALIST_DECISION_ISSUED`, `INTERVENTION_TIMED_OUT`. Task 2 onward consume these exact names.

- [ ] **Step 1: Add the `Notification` model and `NotificationType` enum**

In `backend/prisma/schema.prisma`, add a new model (e.g. after the `Consultation` model and its enums):

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
  SAMPLE_ESCALATED_TO_SUPERVISOR
  SPECIALIST_DECISION_ISSUED
  INTERVENTION_TIMED_OUT
}
```

- [ ] **Step 2: Add the back-relation on `User`**

In the `User` model, add (alongside the other relation arrays, e.g. next to `consultationsAsSpecialist`):

```prisma
  notifications             Notification[]
```

- [ ] **Step 3: Generate and apply the migration**

Run (from `backend/`): `npx prisma migrate dev --name add_notifications`
Expected: a new migration folder under `backend/prisma/migrations/`, applied cleanly with no data-loss warnings (the new model and relation are purely additive).

- [ ] **Step 4: Regenerate the Prisma client and confirm the project still builds**

Run: `npm run prisma:generate` (from `backend/`)
Expected: "Generated Prisma Client" with no errors.
Run: `npm run build` (from `backend/`)
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add Notification model"
```

---

### Task 2: `VIEW_OWN_NOTIFICATIONS` permission

**Files:**
- Modify: `backend/src/common/rbac/permissions.ts`
- Test: none (pure data change — exercised by Task 3's controller tests)

**Interfaces:**
- Produces: `Permission.VIEW_OWN_NOTIFICATIONS`, granted to every role (`PATIENT`, `CAREGIVER`, `CLINICIAN`, `SUPERVISOR`, `ADMIN`). Task 3's controller consumes this exact name.

- [ ] **Step 1: Add the permission enum value**

In `backend/src/common/rbac/permissions.ts`, add to the `Permission` enum (after `MANAGE_CONSULTATION`):

```typescript
  VIEW_OWN_NOTIFICATIONS = 'VIEW_OWN_NOTIFICATIONS',
```

- [ ] **Step 2: Grant it to every role**

In `ROLE_PERMISSIONS`, add `Permission.VIEW_OWN_NOTIFICATIONS` as the last entry in each of the five role arrays (`PATIENT`, `CAREGIVER`, `CLINICIAN`, `SUPERVISOR`, `ADMIN`).

- [ ] **Step 3: Confirm the project still builds**

Run: `npm run build` (from `backend/`)
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add backend/src/common/rbac/permissions.ts
git commit -m "feat: add VIEW_OWN_NOTIFICATIONS permission for all roles"
```

---

### Task 3: `NotificationsModule` — service, controller, endpoints

**Files:**
- Create: `backend/src/modules/notifications/notifications.service.ts`
- Create: `backend/src/modules/notifications/notifications.controller.ts`
- Create: `backend/src/modules/notifications/notifications.module.ts`
- Modify: `backend/src/app.module.ts` (register `NotificationsModule`)
- Test: `backend/test/notifications.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthenticatedUser` from `backend/src/common/auth/session.guard`; `Permission.VIEW_OWN_NOTIFICATIONS` from Task 2.
- Produces: `NotificationsService.create(recipientUserId: string, type: NotificationType, context: Record<string, string>, related?: { entity: string; entityId: string }): Promise<Notification>`; `NotificationsService.notifyRole(role: Role, type: NotificationType, context: Record<string, string>, related?: { entity: string; entityId: string }): Promise<Notification[]>`; `NotificationsService.listForUser(userId: string): Promise<Notification[]>`; `NotificationsService.markRead(notificationId: string, actor: AuthenticatedUser): Promise<Notification>`. Task 4/5/6 consume `create`/`notifyRole` exactly as named here, always passing `related` since every trigger point is about a specific `SpeechSample`.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/notifications.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerAndLogin(app: INestApplication, prisma: PrismaService, mobile: string): Promise<{ token: string; userId: string }> {
  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ fullName: 'Test User', mobile, password: 'test-pass-1', role: 'PATIENT' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ mobile, code: register.body.devOtpCode });
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password: 'test-pass-1' });
  const userId = (await prisma.user.findUniqueOrThrow({ where: { mobile } })).id;
  return { token: login.body.token, userId };
}

describe('Notifications (e2e)', () => {
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

  it('lists only the current user\'s notifications, newest first', async () => {
    const { token, userId } = await registerAndLogin(app, prisma, '+966500006000');
    const { userId: otherUserId } = await registerAndLogin(app, prisma, '+966500006001');

    await prisma.notification.create({
      data: { recipientUserId: userId, type: 'SPECIALIST_DECISION_ISSUED', title: 'older', body: 'b' },
    });
    const newer = await prisma.notification.create({
      data: { recipientUserId: userId, type: 'SPECIALIST_DECISION_ISSUED', title: 'newer', body: 'b' },
    });
    await prisma.notification.create({
      data: { recipientUserId: otherUserId, type: 'SPECIALIST_DECISION_ISSUED', title: 'not mine', body: 'b' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.map((n: any) => n.title)).toEqual(['newer', 'older']);
    expect(res.body[0].id).toBe(newer.id);
  });

  it('marks a notification as read', async () => {
    const { token, userId } = await registerAndLogin(app, prisma, '+966500006010');
    const notification = await prisma.notification.create({
      data: { recipientUserId: userId, type: 'SPECIALIST_DECISION_ISSUED', title: 't', body: 'b' },
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.readAt).not.toBeNull();
  });

  it('rejects marking someone else\'s notification as read', async () => {
    const { token } = await registerAndLogin(app, prisma, '+966500006020');
    const { userId: otherUserId } = await registerAndLogin(app, prisma, '+966500006021');
    const notification = await prisma.notification.create({
      data: { recipientUserId: otherUserId, type: 'SPECIALIST_DECISION_ISSUED', title: 't', body: 'b' },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- notifications` (from `backend/`)
Expected: FAIL — `Cannot GET /api/v1/notifications` (404, no controller/module exists yet) or a module-resolution error.

- [ ] **Step 3: Write `NotificationsService`**

Create `backend/src/modules/notifications/notifications.service.ts`:

```typescript
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

const NOTIFICATION_TEMPLATES: Record<NotificationType, (ctx: Record<string, string>) => { title: string; body: string }> = {
  SAMPLE_ESCALATED_TO_SUPERVISOR: (ctx) => ({
    title: 'عينة متأخرة تحتاج متابعة',
    body: `لم يتم حجز عينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} خلال 24 ساعة من رفعها.`,
  }),
  SPECIALIST_DECISION_ISSUED: (ctx) => ({
    title: 'قرار الأخصائي جاهز',
    body: `صدر قرار الأخصائي (${ctx.decision}) بخصوص المستوى ${ctx.levelName}.`,
  }),
  INTERVENTION_TIMED_OUT: (ctx) => ({
    title: 'تدخل متأخر يحتاج تصعيد',
    body: `لم يُنفَّذ التدخل المطلوب لعينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} خلال 7 أيام.`,
  }),
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async notifyRole(
    role: Role,
    type: NotificationType,
    context: Record<string, string>,
    related?: { entity: string; entityId: string },
  ): Promise<Notification[]> {
    const recipients = await this.prisma.user.findMany({ where: { role }, select: { id: true } });
    return Promise.all(recipients.map((r) => this.create(r.id, type, context, related)));
  }

  async listForUser(userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({ where: { recipientUserId: userId }, orderBy: { createdAt: 'desc' } });
  }

  async markRead(notificationId: string, actor: AuthenticatedUser): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.recipientUserId !== actor.id) {
      throw new ForbiddenException('This notification does not belong to you');
    }
    return this.prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }
}
```

- [ ] **Step 4: Write `NotificationsController`**

Create `backend/src/modules/notifications/notifications.controller.ts`:

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

- [ ] **Step 5: Write `NotificationsModule`**

Create `backend/src/modules/notifications/notifications.module.ts`:

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

- [ ] **Step 6: Register `NotificationsModule` in `AppModule`**

In `backend/src/app.module.ts`, add the import:

```typescript
import { NotificationsModule } from './modules/notifications/notifications.module';
```

Add `NotificationsModule` to the `imports` array (after `ConsultationsModule`).

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:e2e -- notifications` (from `backend/`)
Expected: PASS — all 3 tests green.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/notifications backend/src/app.module.ts backend/test/notifications.e2e-spec.ts
git commit -m "feat: add NotificationsModule with list/mark-read endpoints"
```

---

### Task 4: Wire escalation notification into `evaluateReviewDeadlines`'s 24h-unreserved branch

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts`
- Test: append to `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.notifyRole` from Task 3.

- [ ] **Step 1: Write the failing test**

In `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`, add this test at the end of the `describe` block (it reuses the file's existing `registerAndLogin`, `setupPatientAndPlan`, and `createSubmittedSampleCycle` helpers):

```typescript
  it('notifies every supervisor when a sample is escalated for lacking a reservation past 24h', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005070', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005070' } })).id;
    const supervisorToken = await registerAndLogin(app, prisma, '+966500005071', 'SUPERVISOR');
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005072', clinicianUserId);
    const { sample } = await createSubmittedSampleCycle(prisma, patientProfile.id, plan.id, clinicianUserId);
    await prisma.speechSample.update({ where: { id: sample.id }, data: { submittedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    await request(app.getHttpServer())
      .get('/api/v1/specialist-review/available-samples')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    const notificationsRes = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);

    expect(notificationsRes.body.some((n: any) => n.type === 'SAMPLE_ESCALATED_TO_SUPERVISOR')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- specialist-review-queue` (from `backend/`)
Expected: FAIL — `notificationsRes.body` is empty, `.some(...)` is `false`.

- [ ] **Step 3: Inject `NotificationsService` into `SpecialistReviewService`**

In `backend/src/modules/treatment-engine/specialist-review.service.ts`, add the import (after the existing DTO imports):

```typescript
import { NotificationsService } from '../notifications/notifications.service';
```

Update the constructor (currently at lines 18-22):

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly levelsService: LevelsService,
    private readonly notificationsService: NotificationsService,
  ) {}
```

- [ ] **Step 4: Call `notifyRole` in the 24h-unreserved escalation branch**

In `evaluateReviewDeadlines` (currently lines 152-161), the branch currently reads:

```typescript
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
```

Replace with (fetches `patientName`/`levelName` for the notification context, then notifies after the update commits):

```typescript
    if (
      cycle.status === 'WAITING_FOR_SPECIALIST' &&
      sample.submittedAt &&
      !sample.reservedByUserId &&
      !sample.escalatedAt &&
      Date.now() - sample.submittedAt.getTime() > REVIEW_BOOKING_WINDOW_MS
    ) {
      const updatedSample = await this.prisma.speechSample.update({ where: { id: sample.id }, data: { escalatedAt: new Date() } });
      const { patientName, levelName } = await this.getNotificationContext(cycle);
      await this.notificationsService.notifyRole(
        'SUPERVISOR',
        'SAMPLE_ESCALATED_TO_SUPERVISOR',
        { patientName, levelName },
        { entity: 'SpeechSample', entityId: updatedSample.id },
      );
      return { cycle, sample: updatedSample };
    }
```

- [ ] **Step 5: Add the shared `getNotificationContext` helper**

Add this private method at the end of the class, before the closing brace (after `openNextLevelCycle`):

```typescript
  private async getNotificationContext(cycle: { patientProfileId: string; levelId: string }): Promise<{ patientName: string; levelName: string }> {
    const [patientProfile, level] = await Promise.all([
      this.prisma.patientProfile.findUniqueOrThrow({ where: { id: cycle.patientProfileId } }),
      this.prisma.level.findUniqueOrThrow({ where: { id: cycle.levelId } }),
    ]);
    return { patientName: patientProfile.fullName, levelName: level.name };
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:e2e -- specialist-review-queue` (from `backend/`)
Expected: PASS — all tests green, including the new one.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-review.service.ts backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts
git commit -m "feat: notify supervisors when a sample escalates past the 24h booking window"
```

---

### Task 5: Wire patient notification into `review()`'s decision branches

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts`
- Test: append to `backend/test/treatment-engine-specialist-review.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.create` from Task 3; `getNotificationContext` from Task 4 (reused here).

- [ ] **Step 1: Write the failing test**

This file (`backend/test/treatment-engine-specialist-review.e2e-spec.ts`) has no shared setup helper beyond `registerAndLogin` — every test inlines its own patient/plan/level/cycle/sample creation directly with Prisma (see the existing "transition decision opens the next level..." test for the exact pattern to copy). Add this test at the end of the `describe` block, following that same inline style:

```typescript
  it('notifies the patient when the specialist issues a decision', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500007000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500007001', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500007000' } })).id;
    const patientUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500007001' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUserId,
        fullName: 'Notification Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'NOTIF-TEST-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level1 = await prisma.level.create({ data: { name: 'Notif Level 1', order: 1 } });
    const level1Version = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const level2 = await prisma.level.create({ data: { name: 'Notif Level 2', order: 2 } });
    await prisma.levelVersion.create({
      data: { levelId: level2.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const cycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level1.id, levelVersionId: level1Version.id, cycleNumber: 1, status: 'WAITING_FOR_SPECIALIST' },
    });
    await prisma.speechSample.create({ data: { trainingCycleId: cycle.id, submittedAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/reserve`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: 'أداء جيد' })
      .expect(201);

    const notificationsRes = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(notificationsRes.body.some((n: any) => n.type === 'SPECIALIST_DECISION_ISSUED')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- treatment-engine-specialist-review.e2e-spec` (from `backend/`) — the exact filename pattern, since the plain `treatment-engine-specialist-review` substring also matches `treatment-engine-specialist-review-queue.e2e-spec.ts`.
Expected: FAIL — `notificationsRes.body` has no `SPECIALIST_DECISION_ISSUED` entry.

- [ ] **Step 3: Resolve the patient's `userId` and notify after the transaction commits**

In `review()` (currently lines 24-132), the method currently ends with:

```typescript
    if (result.alreadyReviewed) {
      throw new ConflictException(`Cannot review a cycle in status ${result.status}`);
    }
    return result.sample;
  }
```

Replace with (notifies for all three decisions — `TRANSITION`, `LEVEL_REPEAT`, and `TECHNICAL_RERECORD` — since the patient should learn a decision was made regardless of which one, per the design spec):

```typescript
    if (result.alreadyReviewed) {
      throw new ConflictException(`Cannot review a cycle in status ${result.status}`);
    }

    const patientProfile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: freshCycle.patientProfileId } });
    const { levelName } = await this.getNotificationContext(freshCycle);
    await this.notificationsService.create(
      patientProfile.userId,
      'SPECIALIST_DECISION_ISSUED',
      { decision: dto.decision, levelName },
      { entity: 'SpeechSample', entityId: result.sample.id },
    );

    return result.sample;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- treatment-engine-specialist-review.e2e-spec` (from `backend/`)
Expected: PASS — all tests green, including the new one.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-review.service.ts backend/test/treatment-engine-specialist-review.e2e-spec.ts
git commit -m "feat: notify the patient when a specialist decision is issued"
```

---

### Task 6: Wire escalation notification into `evaluateReviewDeadlines`'s 7-day intervention-timeout branch

**Files:**
- Modify: `backend/src/modules/treatment-engine/specialist-review.service.ts`
- Test: append to `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.notifyRole` from Task 3; `getNotificationContext` from Task 4.

- [ ] **Step 1: Write the failing test**

In `backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts`, add this test at the end of the `describe` block (it extends the existing "escalates an intervention not executed within 7 days" test with a supervisor-notification check):

```typescript
  it('notifies every supervisor when an intervention times out after 7 days', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500005080', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500005080' } })).id;
    const supervisorToken = await registerAndLogin(app, prisma, '+966500005081', 'SUPERVISOR');
    const { plan, patientProfile } = await setupPatientAndPlan(prisma, '+966500005082', clinicianUserId);
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

    await request(app.getHttpServer())
      .post(`/api/v1/specialist-review/cycles/${cycle.id}/intervention/complete`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ outcomeNotes: 'late but done' })
      .expect(201);

    const notificationsRes = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);

    expect(notificationsRes.body.some((n: any) => n.type === 'INTERVENTION_TIMED_OUT')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- specialist-review-queue` (from `backend/`)
Expected: FAIL — `notificationsRes.body` has no `INTERVENTION_TIMED_OUT` entry.

- [ ] **Step 3: Call `notifyRole` in the 7-day intervention-timeout branch**

In `evaluateReviewDeadlines` (currently lines 187-195), the branch currently reads:

```typescript
    if (
      cycle.status === 'DIRECT_INTERVENTION_REQUIRED' &&
      sample.interventionDeadlineAt &&
      !sample.escalatedAt &&
      Date.now() > sample.interventionDeadlineAt.getTime()
    ) {
      const updatedSample = await this.prisma.speechSample.update({ where: { id: sample.id }, data: { escalatedAt: new Date() } });
      return { cycle, sample: updatedSample };
    }
```

Replace with:

```typescript
    if (
      cycle.status === 'DIRECT_INTERVENTION_REQUIRED' &&
      sample.interventionDeadlineAt &&
      !sample.escalatedAt &&
      Date.now() > sample.interventionDeadlineAt.getTime()
    ) {
      const updatedSample = await this.prisma.speechSample.update({ where: { id: sample.id }, data: { escalatedAt: new Date() } });
      const { patientName, levelName } = await this.getNotificationContext(cycle);
      await this.notificationsService.notifyRole(
        'SUPERVISOR',
        'INTERVENTION_TIMED_OUT',
        { patientName, levelName },
        { entity: 'SpeechSample', entityId: updatedSample.id },
      );
      return { cycle, sample: updatedSample };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- specialist-review-queue` (from `backend/`)
Expected: PASS — all tests green, including the new one.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/treatment-engine/specialist-review.service.ts backend/test/treatment-engine-specialist-review-queue.e2e-spec.ts
git commit -m "feat: notify supervisors when an intervention times out after 7 days"
```

---

### Task 7: Full suite verification

**Files:**
- Modify: `backend/src/main.ts` (Swagger description string)
- Test: none new — this task runs the full existing suite

**Interfaces:** none new.

- [ ] **Step 1: Update the Swagger description to mention Notifications**

In `backend/src/main.ts`, the `DocumentBuilder` description currently reads:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Treatment Engine (Levels, 72-Hour Cycles, Samples, Specialist Review), Progress, Reports, Complaints, and Administration modules')
```

Replace with:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Treatment Engine (Levels, 72-Hour Cycles, Samples, Specialist Review), Progress, Reports, Complaints, Administration, Consultations, and Notifications modules')
```

- [ ] **Step 2: Run the full backend test suite**

Run: `npm test` (from `backend/`) and `npm run test:e2e` (from `backend/`)
Expected: all suites pass, with 3 new suites/extensions beyond the pre-Notifications baseline (`notifications.e2e-spec.ts` plus the extended `treatment-engine-specialist-review-queue.e2e-spec.ts` and `treatment-engine-specialist-review.e2e-spec.ts`).

- [ ] **Step 3: Confirm the project builds**

Run: `npm run build` (from `backend/`)
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add backend/src/main.ts
git commit -m "docs: mention Notifications module in Swagger description"
```
