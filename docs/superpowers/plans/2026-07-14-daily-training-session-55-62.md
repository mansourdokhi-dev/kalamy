# §55-62 Daily Training Session Mechanic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot `recordTrainingEvent` action with a resumable `TrainingSession` lifecycle that enforces the 1-hour interval, 100-unit completion threshold, and parallel-training block from the governing spec's points 55-62, while leaving the existing 72h sample-eligibility computation completely untouched.

**Architecture:** A new `TrainingSession` model (mirroring the existing `SampleSession` pattern) with a database-enforced "at most one in-progress session per cycle" constraint. A new `TrainingSessionsService`/`Controller` pair, self-contained (not touching `TrainingCyclesService` beyond its existing `findCycleForActor`/`getCurrent` read paths). The old `recordTrainingEvent` action is deleted outright once the new flow covers everything it did.

**Tech Stack:** NestJS, Prisma, Jest + Supertest (e2e against a real Postgres, no mocks).

## Global Constraints

- No admin-configurability for the interval/threshold/target constants — all hardcoded, matching every other timing constant in this project.
- `TRAINING_INTERVAL_MS = 60 * 60 * 1000` (1 hour), `COMPLETION_THRESHOLD_UNITS = 100`, `DAILY_TARGET_TRAININGS = 7`.
- No new permissions — `POST`/`PATCH` reuse the existing `Permission.RECORD_TRAINING_EVENT`; the new `GET` progress endpoint reuses the existing `Permission.VIEW_CYCLE`.
- `PATCH .../progress` takes the session's **cumulative total**, not an increment — the server takes `Math.max(existing, incoming)`, never decreasing, so a retried request can't double-count.
- "Today" for the progress summary reuses the exact same 24-hour-period-from-`firstTrainingEventAt` framing the existing `isCycleEligibleForSample` util already uses — not a separate calendar-day concept.
- The 72h eligibility computation (`isCycleEligibleForSample`, `cycle-eligibility.util.ts`) and its consuming logic (recompute `firstTrainingEventAt`, update cycle status, fire `SAMPLE_ELIGIBLE_FOR_RECORDING`) must be preserved byte-for-byte in behavior — only the trigger point moves from `recordTrainingEvent` to a training session reaching 100 units.
- Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`.

---

### Task 1: Schema — `TrainingSession` model and parallel-block index

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `TrainingSessionStatus` enum (`IN_PROGRESS`, `COMPLETED`), `TrainingSession` model with fields `id`, `trainingCycleId`, `status`, `unitsCompleted`, `startedAt`, `completedAt` — consumed by Tasks 2-5.

- [ ] **Step 1: Add the schema**

In `backend/prisma/schema.prisma`, add this enum near the other `treatment-engine`-related enums (e.g. right after `enum SampleSessionStatus { ... }`):

```prisma
enum TrainingSessionStatus {
  IN_PROGRESS
  COMPLETED
}
```

Add this model right after the `model TrainingEvent { ... }` block:

```prisma
model TrainingSession {
  id              String                @id @default(uuid())
  trainingCycleId String
  trainingCycle   TrainingCycle72h      @relation(fields: [trainingCycleId], references: [id])
  status          TrainingSessionStatus @default(IN_PROGRESS)
  unitsCompleted  Int                   @default(0)
  startedAt       DateTime              @default(now())
  completedAt     DateTime?

  @@index([trainingCycleId, status])
  @@index([trainingCycleId, completedAt])
}
```

Add the reverse relation field to `model TrainingCycle72h` — find its existing `trainingEvents TrainingEvent[]` line and add a new line right after it:

```prisma
  trainingEvents   TrainingEvent[]
  trainingSessions TrainingSession[]
```

- [ ] **Step 2: Generate the migration without applying it yet**

Run: `npx prisma migrate dev --name add_training_session --create-only` (from `backend/`)
Expected: A new migration folder `prisma/migrations/<timestamp>_add_training_session/migration.sql` is created containing the `CREATE TABLE "TrainingSession"` and `CREATE TYPE "TrainingSessionStatus"` statements. Nothing is applied to the database yet — `--create-only` stops before that step, which is exactly what lets Step 3 edit the file before anything runs.

- [ ] **Step 3: Add the parallel-block partial unique index to the generated file**

Prisma's schema language can't express a partial unique index directly. Open the migration file Step 2 just created and append this to the end:

```sql
CREATE UNIQUE INDEX "TrainingSession_trainingCycleId_in_progress_key"
ON "TrainingSession" ("trainingCycleId")
WHERE "status" = 'IN_PROGRESS';
```

- [ ] **Step 4: Apply the (now-edited) migration**

Run: `npx prisma migrate dev` (from `backend/`, no `--name` — Prisma finds the pending migration file from Step 2 and applies it as-is, including the manual edit from Step 3)
Expected: The command reports the migration applied successfully and regenerates the Prisma client.

- [ ] **Step 5: Verify the partial index exists**

Run this to confirm (from `backend/`, using the same `DATABASE_URL` as `.env`):

```bash
npx prisma db execute --stdin --schema prisma/schema.prisma <<< "SELECT indexname FROM pg_indexes WHERE tablename = 'TrainingSession';"
```

Expected output includes `TrainingSession_trainingCycleId_in_progress_key` alongside Prisma's own auto-generated primary key index.

- [ ] **Step 6: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES — this task only adds schema, nothing consumes it yet.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add TrainingSession model with parallel-training-block index"
```

---

### Task 2: Start or resume a training session

**Files:**
- Create: `backend/src/modules/treatment-engine/training-sessions.service.ts`
- Create: `backend/src/modules/treatment-engine/training-sessions.controller.ts`
- Create: `backend/src/modules/treatment-engine/dto/record-progress.dto.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Test: `backend/test/treatment-engine-training-sessions.e2e-spec.ts` (new file)

**Interfaces:**
- Produces: `TrainingSessionsService.startOrResume(cycleId: string, actor: AuthenticatedUser): Promise<TrainingSession>`, `TrainingSessionsService.resolveIntervalStatus(cycleId: string): Promise<{ intervalActive: boolean; nextAvailableAt: Date | null }>` (a method, not private — Task 4 calls it directly), and the module-level constants `TRAINING_INTERVAL_MS`, `COMPLETION_THRESHOLD_UNITS`, `DAILY_TARGET_TRAININGS` exported from `training-sessions.service.ts`. Tasks 3 and 4 both consume these.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/treatment-engine-training-sessions.e2e-spec.ts`:

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

describe('Treatment Engine — Training Sessions (e2e)', () => {
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

  async function setupActiveCycle(clinicianMobile: string, patientMobile: string) {
    const clinicianToken = await registerAndLogin(app, prisma, clinicianMobile, 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, patientMobile, null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: clinicianMobile } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: patientMobile } })).id, fullName: 'Session Test Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-${Date.now()}-${Math.random()}` },
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
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/watch-human-model`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    return { clinicianToken, patientToken, patientProfile, cycleId: startRes.body.id as string };
  }

  it('creates a new IN_PROGRESS session when none exists', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008000', '+966500008001');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.unitsCompleted).toBe(0);
  });

  it('returns the same session on a second start call (idempotent resume, proves the parallel-block)', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008002', '+966500008003');

    const first = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects starting a session before the human model has been watched', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500008004', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500008005', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008004' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008005' } })).id, fullName: 'No Model Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-NOMODEL-${Date.now()}` },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/start`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ treatmentPlanId: plan.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);
  });

  it('rejects starting a new session within 1 hour of completing the previous one', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008006', '+966500008007');
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 30 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);
    expect(res.body.message).toContain('Cannot start a new training session');
  });

  it('allows starting a new session once the 1-hour interval has elapsed', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008008', '+966500008009');
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 90 * 60 * 1000) },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-training-sessions` (from `backend/`)
Expected: All 5 tests FAIL — the route doesn't exist yet (404s).

- [ ] **Step 3: Create the DTO**

Create `backend/src/modules/treatment-engine/dto/record-progress.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordProgressSchema = z.object({
  unitsCompleted: z.number().int().nonnegative(),
});

export class RecordProgressDto extends createZodDto(RecordProgressSchema) {}
```

- [ ] **Step 4: Create `TrainingSessionsService`**

Create `backend/src/modules/treatment-engine/training-sessions.service.ts`:

```typescript
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, TrainingSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrainingCyclesService } from './training-cycles.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export const TRAINING_INTERVAL_MS = 60 * 60 * 1000;
export const COMPLETION_THRESHOLD_UNITS = 100;
export const DAILY_TARGET_TRAININGS = 7;

@Injectable()
export class TrainingSessionsService {
  private readonly logger = new Logger(TrainingSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  async startOrResume(cycleId: string, actor: AuthenticatedUser): Promise<TrainingSession> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'ACTIVE_LEVEL_TRAINING') {
      throw new ConflictException(`Cannot start or resume a training session from status ${cycle.status}`);
    }
    if (!cycle.humanModelWatchedAt) {
      throw new ConflictException('Must watch the human model before training');
    }

    const existing = await this.prisma.trainingSession.findFirst({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });
    if (existing) {
      return existing;
    }

    const { intervalActive, nextAvailableAt } = await this.resolveIntervalStatus(cycleId);
    if (intervalActive) {
      throw new ConflictException(`Cannot start a new training session until ${nextAvailableAt!.toISOString()}`);
    }

    try {
      return await this.prisma.trainingSession.create({ data: { trainingCycleId: cycleId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.trainingSession.findFirstOrThrow({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });
      }
      throw error;
    }
  }

  async resolveIntervalStatus(cycleId: string): Promise<{ intervalActive: boolean; nextAvailableAt: Date | null }> {
    const lastCompleted = await this.prisma.trainingSession.findFirst({
      where: { trainingCycleId: cycleId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
    if (!lastCompleted?.completedAt) {
      return { intervalActive: false, nextAvailableAt: null };
    }
    const nextAvailableAt = new Date(lastCompleted.completedAt.getTime() + TRAINING_INTERVAL_MS);
    const intervalActive = Date.now() < nextAvailableAt.getTime();
    return { intervalActive, nextAvailableAt: intervalActive ? nextAvailableAt : null };
  }
}
```

- [ ] **Step 5: Create `TrainingSessionsController`**

Create `backend/src/modules/treatment-engine/training-sessions.controller.ts`:

```typescript
import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { TrainingSessionsService } from './training-sessions.service';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/cycles/current/training-sessions')
@UseGuards(SessionGuard, PermissionsGuard)
export class TrainingSessionsController {
  constructor(
    private readonly trainingSessionsService: TrainingSessionsService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  @Post()
  @RequirePermission(Permission.RECORD_TRAINING_EVENT)
  async startOrResume(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.trainingSessionsService.startOrResume(current.id, user);
  }
}
```

- [ ] **Step 6: Wire the module**

In `backend/src/modules/treatment-engine/treatment-engine.module.ts`, add the imports:

```typescript
import { TrainingSessionsController } from './training-sessions.controller';
import { TrainingSessionsService } from './training-sessions.service';
```

Add `TrainingSessionsController` to `controllers` and `TrainingSessionsService` to `providers`/`exports` (currently lines 61-63):

```typescript
  controllers: [LevelsController, TrainingCyclesController, SamplesController, SampleMediaController, SpecialistReviewController, SpecialistReviewQueueController, PatientLevelsController, TrainingSessionsController],
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService, TrainingSessionsService],
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-training-sessions` (from `backend/`)
Expected: All 5 tests PASS.

- [ ] **Step 8: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/treatment-engine/training-sessions.service.ts backend/src/modules/treatment-engine/training-sessions.controller.ts backend/src/modules/treatment-engine/dto/record-progress.dto.ts backend/src/modules/treatment-engine/treatment-engine.module.ts backend/test/treatment-engine-training-sessions.e2e-spec.ts
git commit -m "feat: let a patient start or resume a training session with interval and parallel-block enforcement"
```

---

### Task 3: Record progress and complete a session

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-sessions.service.ts`
- Modify: `backend/src/modules/treatment-engine/training-sessions.controller.ts`
- Test: `backend/test/treatment-engine-training-sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `COMPLETION_THRESHOLD_UNITS` (Task 2), `RecordProgressDto` (Task 2), `isCycleEligibleForSample` from `./cycle-eligibility.util` (already exists, unchanged), `NotificationsService.create` (already exists, unchanged).
- Produces: `TrainingSessionsService.recordProgress(cycleId: string, dto: RecordProgressDto, actor: AuthenticatedUser): Promise<TrainingSession>`. Task 4 does not depend on this method directly, only on the data it writes (`TrainingSession.completedAt`, `TrainingEvent` rows).

- [ ] **Step 1: Write the failing tests**

Add these tests to `backend/test/treatment-engine-training-sessions.e2e-spec.ts`, inside the existing `describe(...)` block, after the existing 5 tests:

```typescript
  it('persists progress below the threshold without completing the session', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008010', '+966500008011');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 40 })
      .expect(200);

    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.unitsCompleted).toBe(40);
  });

  it('does not let a smaller unitsCompleted decrease the stored value', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008012', '+966500008013');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 60 })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 20 })
      .expect(200);

    expect(res.body.unitsCompleted).toBe(60);
  });

  it('completes the session and creates a TrainingEvent once the threshold is reached, without making the cycle eligible on a single session', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008014', '+966500008015');
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);

    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.completedAt).not.toBeNull();

    const events = await prisma.trainingEvent.findMany({ where: { trainingCycleId: cycleId } });
    expect(events).toHaveLength(1);
    expect(events[0].unitsCompleted).toBe(100);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('ACTIVE_LEVEL_TRAINING'); // one completed session alone is not the full 72h gate
  });

  it('fires SAMPLE_ELIGIBLE_FOR_RECORDING once a completed session satisfies all three 24h periods', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500008016', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500008017', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008016' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500008017' } })).id, fullName: 'Eligibility Session Patient', gender: 'MALE', dateOfBirth: new Date('2000-01-01'), nationalId: `SESSION-ELIGIBLE-${Date.now()}` },
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

    // Same technique already proven in the §101 notification test: seed firstTrainingEventAt
    // 73 real hours in the past, plus two raw TrainingEvent rows landing in periods 0 and 1, so
    // this test's own session-completion (period 2) is the one real transition being exercised.
    const start = new Date(Date.now() - 73 * 60 * 60 * 1000);
    const cycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id,
        cycleNumber: 1, humanModelWatchedAt: new Date(), firstTrainingEventAt: start,
      },
    });
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 1 * 60 * 60 * 1000) } });
    await prisma.trainingEvent.create({ data: { trainingCycleId: cycle.id, occurredAt: new Date(start.getTime() + 25 * 60 * 60 * 1000) } });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);
    expect(res.body.status).toBe('COMPLETED');

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('SAMPLE_ELIGIBLE');

    const notifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(notifications.body.find((n: { type: string }) => n.type === 'SAMPLE_ELIGIBLE_FOR_RECORDING')).toBeTruthy();
  });

  it('returns 404 when recording progress with no in-progress session', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008018', '+966500008019');

    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 50 })
      .expect(404);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-training-sessions` (from `backend/`)
Expected: The 5 new tests FAIL — the `PATCH .../progress` route doesn't exist yet.

- [ ] **Step 3: Add `recordProgress` and its completion side-effect to the service**

In `backend/src/modules/treatment-engine/training-sessions.service.ts`, change the imports:

```typescript
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TrainingCycle72h, TrainingSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrainingCyclesService } from './training-cycles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { RecordProgressDto } from './dto/record-progress.dto';
import { isCycleEligibleForSample } from './cycle-eligibility.util';
```

Add `NotificationsService` to the constructor:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly notificationsService: NotificationsService,
  ) {}
```

Add these two methods after `startOrResume`:

```typescript
  async recordProgress(cycleId: string, dto: RecordProgressDto, actor: AuthenticatedUser): Promise<TrainingSession> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.prisma.trainingSession.findFirst({ where: { trainingCycleId: cycleId, status: 'IN_PROGRESS' } });
    if (!session) {
      throw new NotFoundException('No in-progress training session for this cycle');
    }

    const unitsCompleted = Math.max(session.unitsCompleted, dto.unitsCompleted);

    if (unitsCompleted >= COMPLETION_THRESHOLD_UNITS) {
      const completed = await this.prisma.trainingSession.update({
        where: { id: session.id },
        data: { unitsCompleted, status: 'COMPLETED', completedAt: new Date() },
      });
      await this.completeAndCheckEligibility(completed, cycle);
      return completed;
    }

    return this.prisma.trainingSession.update({ where: { id: session.id }, data: { unitsCompleted } });
  }

  private async completeAndCheckEligibility(session: TrainingSession, cycle: TrainingCycle72h): Promise<void> {
    const occurredAt = session.completedAt!;
    await this.prisma.trainingEvent.create({
      data: { trainingCycleId: cycle.id, occurredAt, unitsCompleted: session.unitsCompleted },
    });

    const firstTrainingEventAt = cycle.firstTrainingEventAt ?? occurredAt;
    const events = await this.prisma.trainingEvent.findMany({ where: { trainingCycleId: cycle.id }, select: { occurredAt: true } });
    const eligible = isCycleEligibleForSample(
      firstTrainingEventAt,
      events.map((e) => e.occurredAt),
    );

    const updatedCycle = await this.prisma.trainingCycle72h.update({
      where: { id: cycle.id },
      data: { firstTrainingEventAt, status: eligible ? 'SAMPLE_ELIGIBLE' : 'ACTIVE_LEVEL_TRAINING' },
    });

    if (eligible) {
      const [patientProfile, level] = await Promise.all([
        this.prisma.patientProfile.findUniqueOrThrow({ where: { id: updatedCycle.patientProfileId } }),
        this.prisma.level.findUniqueOrThrow({ where: { id: updatedCycle.levelId } }),
      ]);
      try {
        await this.notificationsService.create(
          patientProfile.userId,
          'SAMPLE_ELIGIBLE_FOR_RECORDING',
          { levelName: level.name },
          { entity: 'TrainingCycle72h', entityId: updatedCycle.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send SAMPLE_ELIGIBLE_FOR_RECORDING notification for cycle ${updatedCycle.id}: ${err}`);
      }
    }
  }
```

- [ ] **Step 4: Add the controller route**

In `backend/src/modules/treatment-engine/training-sessions.controller.ts`, add the imports:

```typescript
import { Body, Controller, Patch, Post, Param, UseGuards } from '@nestjs/common';
import { RecordProgressDto } from './dto/record-progress.dto';
```

Add this route after `startOrResume`:

```typescript
  @Patch('current/progress')
  @RequirePermission(Permission.RECORD_TRAINING_EVENT)
  async recordProgress(@Param('patientId') patientId: string, @Body() dto: RecordProgressDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.trainingSessionsService.recordProgress(current.id, dto, user);
  }
```

- [ ] **Step 5: Import `NotificationsModule` into the treatment-engine module if not already present**

Check `backend/src/modules/treatment-engine/treatment-engine.module.ts`'s `imports` array — `NotificationsModule` is already imported there (added for §101/§103's notification work). No change needed; `TrainingSessionsService` can inject `NotificationsService` without any module wiring changes.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-training-sessions` (from `backend/`)
Expected: All tests in the file PASS (10 total: 5 from Task 2, 5 new).

- [ ] **Step 7: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/treatment-engine/training-sessions.service.ts backend/src/modules/treatment-engine/training-sessions.controller.ts backend/test/treatment-engine-training-sessions.e2e-spec.ts
git commit -m "feat: complete training sessions at the 100-unit threshold, preserving 72h eligibility"
```

---

### Task 4: Today's progress summary endpoint

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-sessions.service.ts`
- Modify: `backend/src/modules/treatment-engine/training-sessions.controller.ts`
- Test: `backend/test/treatment-engine-training-sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `resolveIntervalStatus` (Task 2), `DAILY_TARGET_TRAININGS` (Task 2).
- Produces: `TrainingSessionsService.getProgress(cycleId: string, actor: AuthenticatedUser): Promise<{ completedToday: number; targetPerDay: number; intervalActive: boolean; nextAvailableAt: string | null; currentSessionId: string | null }>`. No other task depends on this — it's the terminal read surface for a future mobile screen and §100's reminder.

- [ ] **Step 1: Write the failing tests**

Add these tests to `backend/test/treatment-engine-training-sessions.e2e-spec.ts`, inside the existing `describe(...)` block, after the existing tests:

```typescript
  it('counts only sessions completed within the current 24h period as completedToday', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008020', '+966500008021');
    const start = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 hours ago — currently in period 1 (24h-48h)
    await prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { firstTrainingEventAt: start } });

    // One session completed in period 0 (hours 0-24) — should NOT count as "today" (period 1).
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(start.getTime() + 5 * 60 * 60 * 1000) },
    });
    // Two sessions completed in period 1 (24h-48h from start, i.e. the last 6 hours) — should count.
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(start.getTime() + 26 * 60 * 60 * 1000) },
    });
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.completedToday).toBe(2);
    expect(res.body.targetPerDay).toBe(7);
  });

  it('reports intervalActive and nextAvailableAt consistently with the start-session gate', async () => {
    const { patientToken, patientProfile, cycleId } = await setupActiveCycle('+966500008022', '+966500008023');
    await prisma.trainingSession.create({
      data: { trainingCycleId: cycleId, status: 'COMPLETED', unitsCompleted: 100, completedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.intervalActive).toBe(true);
    expect(res.body.nextAvailableAt).not.toBeNull();
    expect(res.body.currentSessionId).toBeNull();
  });

  it('reports the in-progress session id when one exists', async () => {
    const { patientToken, patientProfile } = await setupActiveCycle('+966500008024', '+966500008025');
    const started = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.currentSessionId).toBe(started.body.id);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-training-sessions` (from `backend/`)
Expected: The 3 new tests FAIL — the `GET .../progress` route doesn't exist yet.

- [ ] **Step 3: Add `getProgress` to the service**

In `backend/src/modules/treatment-engine/training-sessions.service.ts`, add this method after `resolveIntervalStatus`:

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

- [ ] **Step 4: Add the controller route**

In `backend/src/modules/treatment-engine/training-sessions.controller.ts`, add the import:

```typescript
import { Get } from '@nestjs/common';
```

(Combine this into the existing `@nestjs/common` import line rather than a separate line — merge with the existing `Body, Controller, Patch, Post, Param, UseGuards` import.)

Add this route after `recordProgress`:

```typescript
  @Get('progress')
  @RequirePermission(Permission.VIEW_CYCLE)
  async getProgress(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.trainingSessionsService.getProgress(current.id, user);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-training-sessions` (from `backend/`)
Expected: All tests in the file PASS (13 total).

- [ ] **Step 6: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/training-sessions.service.ts backend/src/modules/treatment-engine/training-sessions.controller.ts backend/test/treatment-engine-training-sessions.e2e-spec.ts
git commit -m "feat: add today's training-progress summary endpoint"
```

---

### Task 5: Remove the old endpoint and migrate existing tests

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-cycles.service.ts`
- Modify: `backend/src/modules/treatment-engine/training-cycles.controller.ts`
- Delete: `backend/src/modules/treatment-engine/dto/record-training-event.dto.ts`
- Modify: `backend/test/treatment-engine-cycle.e2e-spec.ts`
- Modify: `backend/test/treatment-engine-acceptance-criteria.e2e-spec.ts`

**Interfaces:**
- Consumes: `TrainingSessionsService`/`Controller`'s three endpoints (Tasks 2-4) — this task only migrates callers, adds nothing new.
- Produces: nothing new. `TrainingCyclesService.recordTrainingEvent` and its route no longer exist after this task.

- [ ] **Step 1: Delete `recordTrainingEvent` from the service**

In `backend/src/modules/treatment-engine/training-cycles.service.ts`, delete the entire `recordTrainingEvent` method (currently lines 134-187, from `async recordTrainingEvent(cycleId: string, dto: RecordTrainingEventDto, actor: AuthenticatedUser): Promise<TrainingCycle72h> {` through its closing `}`).

Remove the now-unused import `RecordTrainingEventDto` and `isCycleEligibleForSample` if `isCycleEligibleForSample` is no longer referenced anywhere else in this file (it isn't — that logic moved to `training-sessions.service.ts` in Task 3). Remove these two lines from the top of the file:

```typescript
import { RecordTrainingEventDto } from './dto/record-training-event.dto';
import { isCycleEligibleForSample } from './cycle-eligibility.util';
```

- [ ] **Step 2: Delete the route from the controller**

In `backend/src/modules/treatment-engine/training-cycles.controller.ts`, delete the `recordTrainingEvent` route (the `@Post('current/training-events')` handler and its body) and remove the now-unused `RecordTrainingEventDto` import.

- [ ] **Step 3: Delete the DTO file**

Delete `backend/src/modules/treatment-engine/dto/record-training-event.dto.ts` entirely.

- [ ] **Step 4: Migrate `treatment-engine-cycle.e2e-spec.ts`**

This file has 3 call sites. First (lines 90-94, inside the test `'rejects recording a training event before the human model has been watched'`):

```typescript
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409);
```

becomes:

```typescript
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);
```

Second, in the same test (lines 101-111):

```typescript
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
```

becomes:

```typescript
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);

    const currentRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(currentRes.body.status).toBe('ACTIVE_LEVEL_TRAINING'); // one completed training alone is not the full 72h gate
```

Third, the §101 notification test (currently around line 308, `.send({}).expect(201)` inside `'notifies the patient when a cycle becomes SAMPLE_ELIGIBLE via real training events'`):

```typescript
    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(201);
    expect(res.body.status).toBe('SAMPLE_ELIGIBLE');
```

becomes:

```typescript
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientProfile.id}/cycles/current/training-sessions/current/progress`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ unitsCompleted: 100 })
      .expect(200);

    const cycleRes = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(cycleRes.body.status).toBe('SAMPLE_ELIGIBLE');
```

(The rest of that test, which checks `GET /api/v1/notifications` for `SAMPLE_ELIGIBLE_FOR_RECORDING`, is unchanged — leave it as-is.)

- [ ] **Step 5: Migrate `treatment-engine-acceptance-criteria.e2e-spec.ts`**

This file has 2 call sites (both in the `'AC-03: training remains recordable up to submission...'` test), both simple guard-rejection checks with no completion needed. First (currently lines 176-180):

```typescript
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409); // recordTrainingEvent only accepts ACTIVE_LEVEL_TRAINING per Task 4 — SAMPLE_ELIGIBLE
```

becomes:

```typescript
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409); // starting a training session only accepts ACTIVE_LEVEL_TRAINING — SAMPLE_ELIGIBLE
```

Second (currently lines 186-190):

```typescript
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/training-events`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(409);
```

becomes:

```typescript
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${profile.id}/cycles/current/training-sessions`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);
```

- [ ] **Step 6: Run both migrated test files**

Run: `npm run test:e2e -- treatment-engine-cycle treatment-engine-acceptance-criteria` (from `backend/`)
Expected: All tests in both files PASS.

- [ ] **Step 7: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Everything PASSES — no test anywhere still references the deleted `training-events` route.

- [ ] **Step 8: Confirm the old route is genuinely gone**

Run: `grep -rn "training-events" backend/src backend/test` (from the repo root)
Expected: No output — zero remaining references anywhere in source or tests.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/treatment-engine/training-cycles.service.ts backend/src/modules/treatment-engine/training-cycles.controller.ts backend/test/treatment-engine-cycle.e2e-spec.ts backend/test/treatment-engine-acceptance-criteria.e2e-spec.ts
git rm backend/src/modules/treatment-engine/dto/record-training-event.dto.ts
git commit -m "refactor: remove the single-shot training-events endpoint, migrate tests to the session flow"
```

---

## Self-Review Notes

- **Spec coverage:** §55 (daily target shown, never a gate) → `getProgress`'s `targetPerDay`/`completedToday`, and the eligibility-preservation test in Task 3 proving one session never advances the cycle alone. §56 (1-hour interval) → `resolveIntervalStatus`, tested in Task 2. §57 ("today" via 24h periods, not calendar days) → Task 4's `getProgress` period math, explicitly tested against a cross-period scenario. §59 (100-unit threshold) → `COMPLETION_THRESHOLD_UNITS`, Task 3. §60 (resume, position saved) → the idempotent `startOrResume` + cumulative `unitsCompleted` floor, Tasks 2-3. §61 (parallel-block) → the partial unique index (Task 1) plus `startOrResume`'s "return existing" behavior, tested in Task 2. §58/eligibility computation → explicitly preserved unchanged, verified by Task 3's real-transition test reusing the exact §101 test's timestamp technique. Old endpoint removal + test migration → Task 5.
- **No placeholders:** every step has complete, runnable code, including the exact before/after diffs for all 5 migrated test call sites in Task 5.
- **Type consistency:** `TrainingSessionsService`'s three public methods (`startOrResume`, `recordProgress`, `getProgress`) and the shared `resolveIntervalStatus` keep identical signatures across the tasks that define vs. consume them. `RecordProgressDto`'s `unitsCompleted` field name matches `recordProgress`'s destructuring in Task 3. The `TrainingSession` Prisma model fields (`status`, `unitsCompleted`, `completedAt`) are used consistently in Tasks 2-4's queries.
