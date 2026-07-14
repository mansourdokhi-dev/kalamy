# §16 Review Previous Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a patient (or their caregiver/clinical staff) list the treatment levels they've already passed and re-view each passed level's actual training content, without touching any active-cycle state.

**Architecture:** A new, self-contained `PatientLevelsController`/`PatientLevelsService` pair in the existing `treatment-engine` module, following the exact per-patient-scoped convention `TrainingCyclesController` already uses (`api/v1/patients/:patientId/...`, `findPatientProfileOrThrow` + `patientAccessService.assertCanAccess`). Both new endpoints are pure reads — no new Prisma fields, no new permission, no mutation path.

**Tech Stack:** NestJS, Prisma, Jest + Supertest (e2e against a real Postgres, no mocks).

## Global Constraints

- No new Prisma migration — every field used (`TrainingCycle72h.status`, `.closedAt`, `.levelId`, `.levelVersionId`, `Level.name`/`.order`) already exists in the schema.
- No new permission — both endpoints are guarded by the existing `Permission.VIEW_LEVELS`, already held by every role (`PATIENT`, `CAREGIVER`, `CLINICIAN`, `SUPERVISOR`, `ADMIN`).
- A level counts as "passed" only via a `TrainingCycle72h` row with `status: 'NEXT_LEVEL_APPROVED'` for that `levelId` — never inferred from level order, since `LEVEL_REPEAT_DECIDED` must not count as passed.
- The content returned for a passed level is the specific `LevelVersion` the patient's own cycle used (`cycle.levelVersionId`) — never the level's current active/published version.
- If the same level was passed twice (e.g. across two independent paths from a §98 inactivity-restart), the passed-levels list must dedupe to one entry, keeping the most recently passed cycle.
- This plan does not touch the existing `GET /api/v1/levels/:levelId/versions/active` endpoint or any mobile code — both are explicitly out of scope (see the design spec's "Non-goals").
- e2e tests follow the existing repo pattern: real HTTP requests via `supertest` against a real Postgres (`resetDatabase` between tests), no mocks. Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`.

---

### Task 1: `listPassed` — list the levels this patient has passed

**Files:**
- Create: `backend/src/modules/treatment-engine/patient-levels.service.ts`
- Create: `backend/src/modules/treatment-engine/patient-levels.controller.ts`
- Modify: `backend/src/modules/treatment-engine/treatment-engine.module.ts`
- Test: `backend/test/treatment-engine-passed-levels.e2e-spec.ts` (new file)

**Interfaces:**
- Produces: `PatientLevelsService.listPassed(patientProfileId: string, actor: AuthenticatedUser): Promise<PassedLevelSummary[]>`, where `PassedLevelSummary = { levelId: string; levelName: string; order: number; levelVersionId: string; passedAt: Date | null }`. Exposed as `GET /api/v1/patients/:patientId/levels/passed`. Task 2 adds a sibling method (`reviewLevel`) to the same service/controller/module — this task's `PassedLevelSummary` type and the service/controller files are what Task 2 extends, not replaces.

- [ ] **Step 1: Write the failing test**

Create `backend/test/treatment-engine-passed-levels.e2e-spec.ts`:

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

describe('Treatment Engine — Review Previous Levels (e2e)', () => {
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

  it('lists only levels passed via a TRANSITION decision, excluding repeats and unreached levels', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003000', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003001', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003000' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003001' } })).id,
        fullName: 'Passed Levels Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-1',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });

    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const level1Version = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const level2 = await prisma.level.create({ data: { name: 'Level 2', order: 2 } });
    const level2Version = await prisma.levelVersion.create({
      data: { levelId: level2.id, versionNumber: 1, behavioralTechnique: 'y', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await prisma.level.create({ data: { name: 'Level 3', order: 3 } });

    // Level 1: passed
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level1.id, levelVersionId: level1Version.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date('2026-01-01'),
      },
    });
    // Level 2: repeated once (not passed), then currently active (not passed either)
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level2.id, levelVersionId: level2Version.id,
        cycleNumber: 1, status: 'LEVEL_REPEAT_DECIDED', closedAt: new Date('2026-01-05'),
      },
    });
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level2.id, levelVersionId: level2Version.id,
        cycleNumber: 2, status: 'ACTIVE_LEVEL_TRAINING',
      },
    });
    // Level 3: never touched

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/passed`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      levelId: level1.id,
      levelName: 'Level 1',
      order: 1,
      levelVersionId: level1Version.id,
    });
  });

  it('dedupes a level passed twice (e.g. across two independent paths) to its most recently passed cycle', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003002', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003003', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003002' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003003' } })).id,
        fullName: 'Dedupe Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-2',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const planA = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const planB = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g2', reviewDate: new Date() },
    });

    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const olderVersion = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'old-path', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const newerVersion = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 2, behavioralTechnique: 'new-path', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });

    // Older path passed Level 1 first
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: planA.id, levelId: level1.id, levelVersionId: olderVersion.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date('2026-01-01'),
      },
    });
    // Newer path (post-restart) passed Level 1 again, later
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: planB.id, levelId: level1.id, levelVersionId: newerVersion.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date('2026-02-01'),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/passed`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].levelVersionId).toBe(newerVersion.id);
  });

  it('rejects a different patient from listing another patient\'s passed levels', async () => {
    const patientAToken = await registerAndLogin(app, prisma, '+966500003005', null);
    await registerAndLogin(app, prisma, '+966500003006', null);

    const patientBProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003006' } })).id,
        fullName: 'Patient B',
        gender: 'FEMALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-3',
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientBProfile.id}/levels/passed`)
      .set('Authorization', `Bearer ${patientAToken}`)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- treatment-engine-passed-levels` (from `backend/`)
Expected: FAIL — all three tests get 404, since the route doesn't exist yet.

- [ ] **Step 3: Write the service**

Create `backend/src/modules/treatment-engine/patient-levels.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export interface PassedLevelSummary {
  levelId: string;
  levelName: string;
  order: number;
  levelVersionId: string;
  passedAt: Date | null;
}

@Injectable()
export class PatientLevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async listPassed(patientProfileId: string, actor: AuthenticatedUser): Promise<PassedLevelSummary[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { patientProfileId, status: 'NEXT_LEVEL_APPROVED' },
      orderBy: { closedAt: 'desc' },
      distinct: ['levelId'],
      include: { level: true },
    });

    return cycles
      .map((cycle) => ({
        levelId: cycle.levelId,
        levelName: cycle.level.name,
        order: cycle.level.order,
        levelVersionId: cycle.levelVersionId,
        passedAt: cycle.closedAt,
      }))
      .sort((a, b) => a.order - b.order);
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

- [ ] **Step 4: Write the controller**

Create `backend/src/modules/treatment-engine/patient-levels.controller.ts`:

```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PatientLevelsService } from './patient-levels.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/levels')
@UseGuards(SessionGuard, PermissionsGuard)
export class PatientLevelsController {
  constructor(private readonly patientLevelsService: PatientLevelsService) {}

  @Get('passed')
  @RequirePermission(Permission.VIEW_LEVELS)
  listPassed(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientLevelsService.listPassed(patientId, user);
  }
}
```

- [ ] **Step 5: Wire the new controller and service into the module**

In `backend/src/modules/treatment-engine/treatment-engine.module.ts`, add the two imports near the other controller/service imports:

```typescript
import { PatientLevelsController } from './patient-levels.controller';
import { PatientLevelsService } from './patient-levels.service';
```

Add `PatientLevelsController` to the `controllers` array and `PatientLevelsService` to both the `providers` and `exports` arrays, matching the existing entries' style:

```typescript
  controllers: [LevelsController, TrainingCyclesController, SamplesController, SampleMediaController, SpecialistReviewController, SpecialistReviewQueueController, PatientLevelsController],
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService, PatientLevelsService],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-passed-levels` (from `backend/`)
Expected: All three tests PASS.

- [ ] **Step 7: Run the full e2e suite to check for regressions**

Run: `npm run test:e2e` (from `backend/`)
Expected: All suites PASS — the new controller/module wiring must not affect any existing route.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/treatment-engine/patient-levels.service.ts backend/src/modules/treatment-engine/patient-levels.controller.ts backend/src/modules/treatment-engine/treatment-engine.module.ts backend/test/treatment-engine-passed-levels.e2e-spec.ts
git commit -m "feat: list the treatment levels a patient has passed"
```

---

### Task 2: `reviewLevel` — return a passed level's actual training content

**Files:**
- Modify: `backend/src/modules/treatment-engine/patient-levels.service.ts`
- Modify: `backend/src/modules/treatment-engine/patient-levels.controller.ts`
- Modify: `backend/test/treatment-engine-passed-levels.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientLevelsService`'s constructor/`findPatientProfileOrThrow` from Task 1 (unchanged).
- Produces: `PatientLevelsService.reviewLevel(patientProfileId: string, levelId: string, actor: AuthenticatedUser): Promise<LevelVersion>`. Exposed as `GET /api/v1/patients/:patientId/levels/:levelId/review`.

- [ ] **Step 1: Write the failing tests**

Add these three tests to `backend/test/treatment-engine-passed-levels.e2e-spec.ts`, inside the existing `describe(...)` block, after the three tests from Task 1:

```typescript
  it("returns the exact LevelVersion the patient's own passed cycle used, not the level's current active version", async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003007', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003008', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003007' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003008' } })).id,
        fullName: 'Review Content Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-4',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });

    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const trainedVersion = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'technique-patient-trained-on', trainingListJson: '["item-a"]', samplePartTemplateJson: '[]', publishedAt: new Date('2026-01-01') },
    });
    // A newer, currently-active version was published after this patient passed the level.
    await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 2, behavioralTechnique: 'technique-updated-later', trainingListJson: '["item-b"]', samplePartTemplateJson: '[]', publishedAt: new Date('2026-02-01') },
    });

    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level1.id, levelVersionId: trainedVersion.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date('2026-01-15'),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/${level1.id}/review`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.id).toBe(trainedVersion.id);
    expect(res.body.behavioralTechnique).toBe('technique-patient-trained-on');
  });

  it('returns 404 when reviewing a level the patient has not passed', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003009', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500003010', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003009' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003010' } })).id,
        fullName: 'Never Passed Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-5',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/${level1.id}/review`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(404);
  });

  it("allows a CLINICIAN to review any patient's passed level", async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500003011', 'CLINICIAN');
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003011' } })).id;
    await registerAndLogin(app, prisma, '+966500003012', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500003012' } })).id,
        fullName: 'Staff View Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'PASSED-LEVELS-6',
      },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level1 = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level1.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level1.id, levelVersionId: version.id,
        cycleNumber: 1, status: 'NEXT_LEVEL_APPROVED', closedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/levels/${level1.id}/review`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-passed-levels` (from `backend/`)
Expected: The three new tests FAIL with 404 (route doesn't exist yet) — the two-passed-level-content test fails because the route 404s before it can compare `behavioralTechnique`.

- [ ] **Step 3: Add `reviewLevel` to the service**

In `backend/src/modules/treatment-engine/patient-levels.service.ts`, change the import line to include `LevelVersion`:

```typescript
import { LevelVersion, PatientProfile } from '@prisma/client';
```

Add this method to `PatientLevelsService`, after `listPassed`:

```typescript
  async reviewLevel(patientProfileId: string, levelId: string, actor: AuthenticatedUser): Promise<LevelVersion> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const cycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId, levelId, status: 'NEXT_LEVEL_APPROVED' },
      orderBy: { closedAt: 'desc' },
    });
    if (!cycle) {
      throw new NotFoundException('Patient has not passed this level');
    }

    return this.prisma.levelVersion.findUniqueOrThrow({ where: { id: cycle.levelVersionId } });
  }
```

- [ ] **Step 4: Add the controller route**

In `backend/src/modules/treatment-engine/patient-levels.controller.ts`, add this route right after `listPassed`:

```typescript
  @Get(':levelId/review')
  @RequirePermission(Permission.VIEW_LEVELS)
  reviewLevel(@Param('patientId') patientId: string, @Param('levelId') levelId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientLevelsService.reviewLevel(patientId, levelId, user);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-passed-levels` (from `backend/`)
Expected: All 6 tests in the file PASS (3 from Task 1, 3 from Task 2).

- [ ] **Step 6: Run the full unit + e2e suite to check for regressions**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Every suite PASSES.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/patient-levels.service.ts backend/src/modules/treatment-engine/patient-levels.controller.ts backend/test/treatment-engine-passed-levels.e2e-spec.ts
git commit -m "feat: let a patient review a previously-passed level's training content"
```

---

## Self-Review Notes

- **Spec coverage:** "passed" defined via `NEXT_LEVEL_APPROVED` (not order) → covered by Task 1's repeat/unreached exclusion test. Dedup across independent paths → Task 1's second test. Historical-version content (not current active) → Task 2's first test. 404 for unpassed level → Task 2's second test. Ownership check → Task 1's third test. Staff access → Task 2's third test. No new permission, no new migration, no mobile/generic-endpoint changes → satisfied by construction (nothing in this plan touches those files).
- **No placeholders:** every step has complete, runnable code.
- **Type consistency:** `PassedLevelSummary` (Task 1) is used identically in the test assertions; `reviewLevel`'s return type `Promise<LevelVersion>` (Task 2) matches its controller call site and the `LevelVersion` import added in Task 2 Step 3.
