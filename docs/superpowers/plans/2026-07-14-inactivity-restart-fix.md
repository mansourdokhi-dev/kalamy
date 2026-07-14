# §98 Return-After-Long-Inactivity Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a clinician a way to restart a patient's treatment at Level 1 after their program was auto-closed for 30 days of inactivity, and fix `getCurrent` so the mobile app's existing "contact your clinic" messaging actually displays instead of a blind 404.

**Architecture:** Two independent, additive changes to the existing `treatment-engine` module — no schema migration needed (all fields used already exist). (1) A new `RESTART_CYCLE` permission (CLINICIAN + ADMIN only) gates a new `TrainingCyclesService.restartAfterInactivity` method, exposed as `POST /api/v1/patients/:patientId/cycles/restart-after-inactivity`. (2) `TrainingCyclesService.getCurrent` is widened to fall back to the most recent cycle overall when no open cycle exists, instead of always throwing 404.

**Tech Stack:** NestJS, Prisma, Zod (nestjs-zod), Jest + Supertest (e2e against a real Postgres, no mocks).

## Global Constraints

- No new Prisma migration — every field used (`TrainingCycle72h.cycleNumber`, `.closedAt`, `TreatmentPlan.status`) already exists in the schema.
- `RESTART_CYCLE` is granted only to `CLINICIAN` and `ADMIN` — never `PATIENT`, `CAREGIVER`, or `SUPERVISOR` (per the approved design spec, `docs/superpowers/specs/2026-07-14-inactivity-restart-fix-design.md`).
- `AuditInterceptor` (`backend/src/app.module.ts:45`) is registered globally and automatically audits every mutating request — do NOT add a manual `auditLog.create` call for the new endpoint.
- e2e tests follow the existing pattern in `backend/test/treatment-engine-inactivity.e2e-spec.ts`: real HTTP requests via `supertest` against a real Postgres (`resetDatabase` between tests), no mocks.
- Run unit tests with `npm test` and e2e tests with `npm run test:e2e` from `backend/`.

---

### Task 1: Add the `RESTART_CYCLE` permission

**Files:**
- Modify: `backend/src/common/rbac/permissions.ts`
- Test: `backend/src/common/rbac/permissions.spec.ts`

**Interfaces:**
- Produces: `Permission.RESTART_CYCLE` — consumed by Task 3's controller (`@RequirePermission(Permission.RESTART_CYCLE)`).

- [ ] **Step 1: Write the failing test**

Add to the `describe('hasPermission — treatment engine v2', ...)` block in `backend/src/common/rbac/permissions.spec.ts` (after the existing `'grants REVIEW_SAMPLE to CLINICIAN and ADMIN only'` test):

```typescript
  it('grants RESTART_CYCLE to CLINICIAN and ADMIN only', () => {
    expect(hasPermission('CLINICIAN', Permission.RESTART_CYCLE)).toBe(true);
    expect(hasPermission('ADMIN', Permission.RESTART_CYCLE)).toBe(true);
    expect(hasPermission('SUPERVISOR', Permission.RESTART_CYCLE)).toBe(false);
    expect(hasPermission('PATIENT', Permission.RESTART_CYCLE)).toBe(false);
    expect(hasPermission('CAREGIVER', Permission.RESTART_CYCLE)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- permissions.spec.ts` (from `backend/`)
Expected: FAIL with a TypeScript error — `Permission.RESTART_CYCLE` does not exist.

- [ ] **Step 3: Add the permission**

In `backend/src/common/rbac/permissions.ts`, add the enum member right after `VIEW_CYCLE = 'VIEW_CYCLE',` (line 36):

```typescript
  VIEW_CYCLE = 'VIEW_CYCLE',
  RESTART_CYCLE = 'RESTART_CYCLE',
```

In the `CLINICIAN` array, add right after `Permission.VIEW_CYCLE,` (currently line 108, just before `Permission.REVIEW_SAMPLE,`):

```typescript
    Permission.VIEW_CYCLE,
    Permission.RESTART_CYCLE,
    Permission.REVIEW_SAMPLE,
```

In the `ADMIN` array, add the same way right after `Permission.VIEW_CYCLE,` (currently line 161, just before `Permission.REVIEW_SAMPLE,`):

```typescript
    Permission.VIEW_CYCLE,
    Permission.RESTART_CYCLE,
    Permission.REVIEW_SAMPLE,
```

Do NOT add `Permission.RESTART_CYCLE` to `PATIENT`, `CAREGIVER`, or `SUPERVISOR`'s arrays.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- permissions.spec.ts` (from `backend/`)
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/rbac/permissions.ts backend/src/common/rbac/permissions.spec.ts
git commit -m "feat: add RESTART_CYCLE permission for clinicians and admins"
```

---

### Task 2: Fix `getCurrent` to stop 404ing after inactivity closure

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-cycles.service.ts:116-138` (the `getCurrent` method)
- Test: `backend/test/treatment-engine-inactivity.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing new — this is a behavior change to the existing `getCurrent(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycleWithSample>` method.
- Produces: `getCurrent` now returns the most recent cycle (even if closed) instead of throwing 404, whenever the patient has ever had at least one cycle. Task 3 does NOT depend on this — `restartAfterInactivity` queries the latest cycle directly, not via `getCurrent`.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `backend/test/treatment-engine-inactivity.e2e-spec.ts`, inside the existing `describe('Treatment Engine — Inactivity closure (e2e)', ...)` block, after the existing two `it(...)` blocks:

```typescript
  it('returns the same closed cycle on a second read instead of 404ing', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002004', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002005', null);

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002005' } })).id,
        fullName: 'Inactivity Test Patient 3',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'INACTIVITY-TEST-3',
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        patientProfileId: patientProfile.id,
        clinicianUserId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002004' } })).id,
        type: 'INITIAL',
        status: 'APPROVED',
      },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: patientProfile.id, clinicianUserId: assessment.clinicianUserId, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: {
        levelId: level.id,
        versionNumber: 1,
        behavioralTechnique: 'x',
        trainingListJson: '[]',
        samplePartTemplateJson: '[]',
        publishedAt: new Date(),
      },
    });

    const staleCycle = await prisma.trainingCycle72h.create({
      data: { patientProfileId: patientProfile.id, treatmentPlanId: plan.id, levelId: level.id, levelVersionId: version.id, cycleNumber: 1 },
    });
    await prisma.trainingEvent.create({
      data: { trainingCycleId: staleCycle.id, occurredAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });
    await prisma.trainingCycle72h.update({
      where: { id: staleCycle.id },
      data: { updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });

    const firstRead = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(firstRead.body.status).toBe('CLOSED_DUE_TO_INACTIVITY');

    const secondRead = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(secondRead.body.id).toBe(staleCycle.id);
    expect(secondRead.body.status).toBe('CLOSED_DUE_TO_INACTIVITY');
  });

  it('returns 404 for a patient who has never had any training cycle', async () => {
    await registerAndLogin(app, prisma, '+966500002006', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002007', null);
    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002007' } })).id,
        fullName: 'Never Started Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'INACTIVITY-TEST-4',
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles/current`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(404);
  });
```

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `npm run test:e2e -- treatment-engine-inactivity` (from `backend/`)
Expected: The new `'returns the same closed cycle on a second read instead of 404ing'` test FAILS — `secondRead` gets a 404 instead of 200, because today's `getCurrent` throws `NotFoundException` once no open cycle remains. The `'returns 404 for a patient who has never had any training cycle'` test should already PASS (this case is unaffected by the fix).

- [ ] **Step 3: Fix `getCurrent`**

In `backend/src/modules/treatment-engine/training-cycles.service.ts`, replace the `getCurrent` method body (currently lines 116-138):

```typescript
  async getCurrent(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycleWithSample> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    let cycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId, closedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { speechSample: { include: { parts: true } } },
    });

    if (cycle && !STATES_EXEMPT_FROM_INACTIVITY.includes(cycle.status) && Date.now() - cycle.updatedAt.getTime() > INACTIVITY_WINDOW_MS) {
      cycle = await this.prisma.trainingCycle72h.update({
        where: { id: cycle.id },
        data: { status: 'CLOSED_DUE_TO_INACTIVITY', closedAt: new Date() },
        include: { speechSample: { include: { parts: true } } },
      });
    }

    if (!cycle) {
      // No open cycle — fall back to the most recent cycle overall (e.g. one
      // already closed for inactivity on a prior read) so callers can see its
      // real terminal status instead of a blind 404. Only a patient who has
      // never had any cycle at all still gets NotFoundException below.
      cycle = await this.prisma.trainingCycle72h.findFirst({
        where: { patientProfileId },
        orderBy: { createdAt: 'desc' },
        include: { speechSample: { include: { parts: true } } },
      });
    }

    if (!cycle) {
      throw new NotFoundException('No active training cycle');
    }

    return cycle;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-inactivity` (from `backend/`)
Expected: All tests in the file PASS, including the two new ones and the two pre-existing ones.

- [ ] **Step 5: Run the full e2e suite to check for regressions**

Run: `npm run test:e2e` (from `backend/`)
Expected: All suites PASS — in particular `treatment-engine-cycle.e2e-spec.ts` and `treatment-engine-progress.e2e-spec.ts`, which also call `getCurrent` indirectly, must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/treatment-engine/training-cycles.service.ts backend/test/treatment-engine-inactivity.e2e-spec.ts
git commit -m "fix: getCurrent returns the last cycle instead of 404 after inactivity closure"
```

---

### Task 3: Clinician-initiated restart endpoint

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-cycles.service.ts`
- Modify: `backend/src/modules/treatment-engine/training-cycles.controller.ts`
- Test: `backend/test/treatment-engine-inactivity.e2e-spec.ts`

**Interfaces:**
- Consumes: `Permission.RESTART_CYCLE` (Task 1). `LevelsService.list(): Promise<Level[]>` and `LevelsService.getActiveVersion(levelId: string): Promise<LevelVersion>` (both already exist, unchanged).
- Produces: `TrainingCyclesService.restartAfterInactivity(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h>`, exposed as `POST /api/v1/patients/:patientId/cycles/restart-after-inactivity`.

- [ ] **Step 1: Write the failing tests**

Add these three tests to `backend/test/treatment-engine-inactivity.e2e-spec.ts`, after the two tests added in Task 2:

```typescript
  it("allows a CLINICIAN to restart a patient after inactivity closure, at Level 1 under the patient's active plan", async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002010', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002011', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002010' } })).id;

    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002011' } })).id,
        fullName: 'Restart Test Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'RESTART-TEST-1',
      },
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
    const closedCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'CLOSED_DUE_TO_INACTIVITY',
        closedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/restart-after-inactivity`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(201);

    expect(res.body.status).toBe('ACTIVE_LEVEL_TRAINING');
    expect(res.body.levelId).toBe(level.id);
    expect(res.body.levelVersionId).toBe(version.id);
    expect(res.body.treatmentPlanId).toBe(plan.id);
    expect(res.body.cycleNumber).toBe(1);
    expect(res.body.id).not.toBe(closedCycle.id);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientProfile.id}/cycles`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const oldInHistory = history.body.find((c: { id: string }) => c.id === closedCycle.id);
    expect(oldInHistory.status).toBe('CLOSED_DUE_TO_INACTIVITY');
    expect(history.body.map((c: { id: string }) => c.id)).toContain(res.body.id);
  });

  it('rejects restart-after-inactivity from a PATIENT', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002012', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500002013', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002012' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002013' } })).id,
        fullName: 'Restart Reject Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'RESTART-TEST-2',
      },
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
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'CLOSED_DUE_TO_INACTIVITY',
        closedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/restart-after-inactivity`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(403);
  });

  it('rejects restart-after-inactivity when the latest cycle is not closed for inactivity', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500002014', 'CLINICIAN');
    await registerAndLogin(app, prisma, '+966500002015', null);
    const clinicianUserId = (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002014' } })).id;
    const patientProfile = await prisma.patientProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500002015' } })).id,
        fullName: 'Restart Conflict Patient',
        gender: 'MALE',
        dateOfBirth: new Date('2000-01-01'),
        nationalId: 'RESTART-TEST-3',
      },
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
    await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: patientProfile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'ACTIVE_LEVEL_TRAINING',
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientProfile.id}/cycles/restart-after-inactivity`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(409);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- treatment-engine-inactivity` (from `backend/`)
Expected: All three new tests FAIL with 404 (route `POST /cycles/restart-after-inactivity` doesn't exist yet).

- [ ] **Step 3: Add `resolveFirstLevel` helper and `restartAfterInactivity` to the service**

In `backend/src/modules/treatment-engine/training-cycles.service.ts`, change the import line to include `Level` and `LevelVersion`:

```typescript
import { Level, LevelVersion, PatientProfile, Prisma, TrainingCycle72h } from '@prisma/client';
```

Replace the body of `startFirstCycle` (the level-resolution block) to use a new shared helper — change:

```typescript
    const levels = await this.levelsService.list();
    const firstLevel = levels.find((l) => l.status === 'ACTIVE');
    if (!firstLevel) {
      throw new ConflictException('No active level is configured');
    }
    const activeVersion = await this.levelsService.getActiveVersion(firstLevel.id);
```

to:

```typescript
    const { level: firstLevel, version: activeVersion } = await this.resolveFirstLevel();
```

Then add the new private helper and the new public method, right after `startFirstCycle` (before `watchHumanModel`):

```typescript
  private async resolveFirstLevel(): Promise<{ level: Level; version: LevelVersion }> {
    const levels = await this.levelsService.list();
    const firstLevel = levels.find((l) => l.status === 'ACTIVE');
    if (!firstLevel) {
      throw new ConflictException('No active level is configured');
    }
    const activeVersion = await this.levelsService.getActiveVersion(firstLevel.id);
    return { level: firstLevel, version: activeVersion };
  }

  async restartAfterInactivity(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const latestCycle = await this.prisma.trainingCycle72h.findFirst({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latestCycle || latestCycle.status !== 'CLOSED_DUE_TO_INACTIVITY') {
      throw new ConflictException('Patient does not have a cycle closed due to inactivity');
    }

    const activePlan = await this.prisma.treatmentPlan.findFirst({
      where: { patientProfileId, status: 'ACTIVE' },
    });
    if (!activePlan) {
      throw new ConflictException('Patient has no active treatment plan');
    }

    const { level: firstLevel, version: activeVersion } = await this.resolveFirstLevel();

    return this.prisma.trainingCycle72h.create({
      data: {
        patientProfileId,
        treatmentPlanId: activePlan.id,
        levelId: firstLevel.id,
        levelVersionId: activeVersion.id,
        cycleNumber: 1,
      },
    });
  }
```

- [ ] **Step 4: Add the controller route**

In `backend/src/modules/treatment-engine/training-cycles.controller.ts`, add this route right after the existing `start` route (after line 20, before `listHistory`):

```typescript
  @Post('restart-after-inactivity')
  @RequirePermission(Permission.RESTART_CYCLE)
  restartAfterInactivity(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trainingCyclesService.restartAfterInactivity(patientId, user);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- treatment-engine-inactivity` (from `backend/`)
Expected: All tests in the file PASS — 7 tests total (2 pre-existing, 2 added in Task 2, 3 added in Task 3).

- [ ] **Step 6: Run the full backend test suite**

Run: `npm test && npm run test:e2e` (from `backend/`)
Expected: Every unit and e2e suite PASSES — in particular `treatment-engine-cycle.e2e-spec.ts` (confirms `startFirstCycle`'s refactor to use `resolveFirstLevel()` didn't change its behavior).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/treatment-engine/training-cycles.service.ts backend/src/modules/treatment-engine/training-cycles.controller.ts backend/test/treatment-engine-inactivity.e2e-spec.ts
git commit -m "feat: let a clinician restart a patient's program at Level 1 after inactivity closure"
```

---

## Self-Review Notes

- **Spec coverage:** Fix 1 (restart endpoint) → Task 3. Fix 2 (`getCurrent` fallback) → Task 2. `RESTART_CYCLE` permission scoping → Task 1. All testing-section bullets from the design spec are covered by the tests in Tasks 2 and 3. The spec's corrected note about `AuditInterceptor` is reflected in Global Constraints (no manual audit call added).
- **No placeholders:** every step has complete, runnable code.
- **Type consistency:** `resolveFirstLevel()` returns `{ level: Level; version: LevelVersion }` in Task 3 Step 3 and is consumed the same way in both `startFirstCycle` and `restartAfterInactivity`. `restartAfterInactivity(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycle72h>` matches its controller call site exactly.
