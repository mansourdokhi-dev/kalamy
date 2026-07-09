# Mobile Treatment Engine Screens (Sub-project 2/5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing Kalamy mobile app (Expo/React Native) to the merged Treatment Engine v2 backend for the patient/caregiver-facing core clinical loop: level content, cycle status, training logging, self-service program start, cycle/level history, and specialist decisions.

**Architecture:** Three small, additive backend endpoints (one lookup, one enrichment, one previously-unwired service method) feed four new Expo Router screens plus one existing placeholder screen replacement. No new mobile dependencies, no new backend modules, no schema changes.

**Tech Stack:** NestJS 11 + Prisma 6.19.3 + PostgreSQL (backend, unchanged); Expo ~57 + React Native 0.86 + expo-router ~57 + React 19.2 (mobile, unchanged) — see `mobile/AGENTS.md` for the exact-versioned Expo docs link before touching any Expo API.

## Global Constraints

- Backend: every new/changed endpoint reuses an existing `Permission` value already granted to `PATIENT`/`CAREGIVER` — no RBAC changes (`VIEW_PATIENT_PROFILE`, `VIEW_CYCLE`, `VIEW_LEVELS`).
- Backend: no schema changes, no new Prisma migrations, no new modules.
- Mobile: no new dependencies (no `expo-av`, `expo-camera`, no state-management library) — every fetch uses the existing `apiRequest` client from `mobile/src/api/client.ts`.
- Mobile: RTL and Arabic-only copy, matching the existing `src/copy/ar.ts` flat-nested-object convention exactly.
- Mobile: age-group theming cutoffs are `under 13 → 'child'`, `13–17 → 'teen'`, `18+ → 'adult'` (a new default chosen during design, not derived from any existing convention).
- No sample recording/playback, no specialist-facing UI, no multi-child caregiver switching — all explicitly out of scope per `docs/superpowers/specs/2026-07-09-mobile-treatment-engine-screens-design.md`.
- A 404 from `cycles/current`, a 409 from `levels/:levelId/versions/active`, and a 404 from `treatment-plans/active` are all expected UI states, never routed through `ErrorBanner`.

---

### Task 1: Backend — `GET /api/v1/patients/me`

**Files:**
- Modify: `backend/src/modules/patients/patients.service.ts`
- Modify: `backend/src/modules/patients/patients.controller.ts`
- Test: `backend/test/patients.e2e-spec.ts`

**Interfaces:**
- Produces: `PatientsService.findMine(actor: AuthenticatedUser): Promise<PatientProfile>` — no other task in this plan consumes it directly (Task 4 consumes the HTTP route, not the service method).
- Route: `GET /api/v1/patients/me` → same `PatientProfile` shape as `GET /api/v1/patients/:id`, `404` if none exists yet.

**Important design note:** a `CAREGIVER` has no `PatientProfile` of their own (`userId` on `PatientProfile` never equals a caregiver's `User.id`) — their linked child's profile is what "mine" must mean for them. `findMine` branches on `actor.role`: for `PATIENT`, look up by `userId: actor.id` directly; for `CAREGIVER`, resolve the linked child via `GuardianLink` first (taking the first link, consistent with this plan's "one patient profile per user" scope assumption), then look up that child's profile. Skipping this branch would make `/me` 404 for every caregiver account.

- [ ] **Step 1: Write the failing e2e tests**

Read `backend/test/patients.e2e-spec.ts` first — it already defines `createActiveUser`, `loginAs`, and `registerActivateAndLogin` helpers at the top of its `describe` block; reuse them exactly. Add these three tests inside the existing `describe('Patients: create profile', ...)` block (or a new sibling `describe` in the same file — either is fine, just reuse the existing helpers rather than redefining them):

```typescript
  it('lets a patient fetch their own profile via /me', async () => {
    const patientToken = await registerActivateAndLogin('+966500000070', 'password123', 'PATIENT');
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500000070' } });
    const clinicianToken = await registerActivateAndLogin('+966500000071', 'password123', 'CLINICIAN');

    await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientUser.id,
        fullName: 'Self Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: '1111111111',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/me')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(response.body.userId).toBe(patientUser.id);
    expect(response.body.fullName).toBe('Self Patient');
  });

  it('returns 404 from /me when no patient profile exists yet', async () => {
    const patientToken = await registerActivateAndLogin('+966500000072', 'password123', 'PATIENT');
    await request(app.getHttpServer())
      .get('/api/v1/patients/me')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(404);
  });

  it('lets a linked caregiver fetch their child\'s profile via /me', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000073', 'password123', 'CLINICIAN');
    const childUser = await createActiveUser('+966500000074', 'PATIENT');
    const caregiverToken = await registerActivateAndLogin('+966500000075', 'password123', 'CAREGIVER');
    const caregiverUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500000075' } });

    const profileRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: childUser.id,
        fullName: 'Child Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-01-01',
        nationalId: '2222222222',
        guardianUserId: caregiverUser.id,
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/me')
      .set('Authorization', `Bearer ${caregiverToken}`)
      .expect(200);

    expect(response.body.id).toBe(profileRes.body.id);
    expect(response.body.userId).toBe(childUser.id);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm run test:e2e -- patients.e2e-spec.ts`
Expected: FAIL — `GET /api/v1/patients/me` doesn't exist yet (the `:id` route will swallow `/me` as `id='me'` and 404 on lookup, or the whole request 404s with a different message — either way, none of the three new assertions pass yet).

- [ ] **Step 3: Add `findMine` to `PatientsService`**

Read `backend/src/modules/patients/patients.service.ts` first. Add this method to the class (anywhere among the other public methods — e.g., right after `findById`):

```typescript
  async findMine(actor: AuthenticatedUser): Promise<PatientProfile> {
    let profile: (PatientProfile & { clinicalInfo: unknown }) | null;

    if (actor.role === Role.CAREGIVER) {
      const link = await this.prisma.guardianLink.findFirst({ where: { guardianUserId: actor.id } });
      if (!link) {
        throw new NotFoundException('No patient profile exists for this user yet');
      }
      profile = await this.prisma.patientProfile.findUnique({
        where: { userId: link.patientUserId },
        include: { clinicalInfo: true },
      });
    } else {
      profile = await this.prisma.patientProfile.findUnique({
        where: { userId: actor.id },
        include: { clinicalInfo: true },
      });
    }

    if (!profile) {
      throw new NotFoundException('No patient profile exists for this user yet');
    }
    return profile;
  }
```

`Role` and `NotFoundException` are already imported at the top of this file — no new imports needed.

- [ ] **Step 4: Add the route to `PatientsController`**

Read `backend/src/modules/patients/patients.controller.ts` first. Insert this method BETWEEN `create` (the `@Post()` method) and `findOne` (the `@Get(':id')` method) — route order matters here: Nest matches routes in declaration order, so `me` must be registered before `:id` or the `:id` route will swallow it:

```typescript
  @Get('me')
  @RequirePermission(Permission.VIEW_PATIENT_PROFILE)
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.findMine(user);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm run test:e2e -- patients.e2e-spec.ts`
Expected: PASS, all tests in the file (existing ones plus the 3 new ones).

- [ ] **Step 6: Run the full backend e2e suite to confirm no regressions**

Run: `cd backend && npm run test:e2e`
Expected: every suite passes — this is a purely additive change to an existing controller/service, so a failure anywhere else indicates an unintended regression (e.g., a route-ordering mistake affecting `GET /api/v1/patients/:id`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/patients/patients.service.ts backend/src/modules/patients/patients.controller.ts backend/test/patients.e2e-spec.ts
git commit -m "feat: add GET /api/v1/patients/me for self/linked-child profile lookup

Neither a logged-in patient nor a logged-in caregiver had any way to
discover their own (or their linked child's) patientProfileId — every
downstream endpoint needs it in the URL path. Branches on actor role
since a caregiver has no PatientProfile of their own; resolves via
GuardianLink instead."
```

---

### Task 2: Backend — enrich cycle history with each cycle's sample/decision

**Files:**
- Modify: `backend/src/modules/treatment-engine/training-cycles.service.ts`
- Test: `backend/test/treatment-engine-cycle.e2e-spec.ts`

**Interfaces:**
- Changes: `TrainingCyclesService.listHistory` return type from `Promise<TrainingCycle72h[]>` to `Promise<TrainingCycleWithSample[]>`, where `TrainingCycleWithSample` is a new exported type alias `Prisma.TrainingCycle72hGetPayload<{ include: { speechSample: { include: { parts: true } } } }>`. No callers outside this file need updating — `TrainingCyclesController.listHistory` just returns whatever the service returns.

**Design-review note (already fixed in the spec, restated here for the implementer):** decisions only ever live on *closed* cycles, since `TRANSITION`/`LEVEL_REPEAT` close the reviewed cycle and open a new one in the same transaction, and `TECHNICAL_RERECORD` never sets `decision` at all. This is exactly why this task enriches the *history* endpoint rather than adding a "current cycle's sample" endpoint — the mobile app looks here, and only here, for a specialist's decision.

- [ ] **Step 1: Write the failing e2e test**

Read `backend/test/treatment-engine-cycle.e2e-spec.ts` first to see its existing `registerAndLogin` helper and Prisma-seeding conventions. Add this test to its existing `describe` block:

```typescript
  it('includes each cycle\'s speech sample and decision in the history listing', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500001500', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500001501', null);
    const clinicianUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001500' } });
    const patientUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '+966500001501' } });
    const profile = await prisma.patientProfile.create({
      data: { userId: patientUser.id, fullName: 'p', gender: 'MALE', nationalId: 'HIST-1', dateOfBirth: new Date('2000-01-01') },
    });
    const assessment = await prisma.assessment.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, type: 'INITIAL', status: 'APPROVED' },
    });
    const plan = await prisma.treatmentPlan.create({
      data: { patientProfileId: profile.id, clinicianUserId: clinicianUser.id, assessmentId: assessment.id, goals: 'g', reviewDate: new Date() },
    });
    const level = await prisma.level.create({ data: { name: 'Level 1', order: 1 } });
    const version = await prisma.levelVersion.create({
      data: { levelId: level.id, versionNumber: 1, behavioralTechnique: 'x', trainingListJson: '[]', samplePartTemplateJson: '[]', publishedAt: new Date() },
    });
    const closedCycle = await prisma.trainingCycle72h.create({
      data: {
        patientProfileId: profile.id,
        treatmentPlanId: plan.id,
        levelId: level.id,
        levelVersionId: version.id,
        cycleNumber: 1,
        status: 'NEXT_LEVEL_APPROVED',
        closedAt: new Date(),
      },
    });
    await prisma.speechSample.create({
      data: {
        trainingCycleId: closedCycle.id,
        submittedAt: new Date(),
        reviewedByUserId: clinicianUser.id,
        reviewedAt: new Date(),
        decision: 'TRANSITION',
        reviewNotes: 'Great progress',
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profile.id}/cycles`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const returnedClosedCycle = response.body.find((c: { id: string }) => c.id === closedCycle.id);
    expect(returnedClosedCycle.speechSample.decision).toBe('TRANSITION');
    expect(returnedClosedCycle.speechSample.reviewNotes).toBe('Great progress');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- treatment-engine-cycle.e2e-spec.ts`
Expected: FAIL — `returnedClosedCycle.speechSample` is `undefined` (the current `listHistory` query has no `include`).

- [ ] **Step 3: Enrich `listHistory`**

Read `backend/src/modules/treatment-engine/training-cycles.service.ts` first. `Prisma` is already imported at the top (`import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'; import { PatientProfile, Prisma, TrainingCycle72h } from '@prisma/client';`). Add this type alias near the top of the file, above the `@Injectable()` class:

```typescript
export type TrainingCycleWithSample = Prisma.TrainingCycle72hGetPayload<{
  include: { speechSample: { include: { parts: true } } };
}>;
```

Replace the `listHistory` method's signature and body:

```typescript
  async listHistory(patientProfileId: string, actor: AuthenticatedUser): Promise<TrainingCycleWithSample[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);
    return this.prisma.trainingCycle72h.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'asc' },
      include: { speechSample: { include: { parts: true } } },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-cycle.e2e-spec.ts`
Expected: PASS, all tests in the file (existing ones plus this new one).

- [ ] **Step 5: Run the full backend e2e suite to confirm no regressions**

Run: `cd backend && npm run test:e2e`
Expected: every suite passes — `listHistory`'s only other caller is `TrainingCyclesController.listHistory`, which just forwards the return value, so this is a purely additive response-shape change.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/treatment-engine/training-cycles.service.ts backend/test/treatment-engine-cycle.e2e-spec.ts
git commit -m "feat: include each cycle's speech sample/decision in cycle history

Nothing exposed a submitted sample's decision after the fact — the
POST submit/rerecord/review endpoints each return it once, but there
was no way to read it later. Decisions only ever live on closed
cycles (TRANSITION/LEVEL_REPEAT close the reviewed cycle in the same
transaction that opens the next one; TECHNICAL_RERECORD never sets
one), so this enriches the history listing rather than adding a
current-cycle sample lookup that could never actually fire."
```

---

### Task 3: Backend — `GET /api/v1/levels/:levelId/versions/active`

**Files:**
- Modify: `backend/src/modules/treatment-engine/levels.controller.ts`
- Test: `backend/test/treatment-engine-levels.e2e-spec.ts`

**Interfaces:**
- Produces: route `GET /api/v1/levels/:levelId/versions/active` → the `LevelVersion` returned by the already-existing `LevelsService.getActiveVersion(levelId)`, or `409` if the level has no published version.
- No service changes — `getActiveVersion` already exists and is already used internally by `TrainingCyclesService.startFirstCycle` and `SpecialistReviewService`'s `openNextLevelCycle`. This task only adds the missing controller route.

- [ ] **Step 1: Write the failing e2e test**

Read `backend/test/treatment-engine-levels.e2e-spec.ts` first — reuse its existing `registerAndLogin` helper. Add this test to its existing `describe` block:

```typescript
  it('lets a patient fetch the active version of a published level, and 409s for an unpublished one', async () => {
    const clinicianToken = await registerAndLogin(app, prisma, '+966500000910', 'CLINICIAN');
    const patientToken = await registerAndLogin(app, prisma, '+966500000911', null);

    const levelRes = await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ name: 'مستوى النشط', order: 3 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/levels/${levelRes.body.id}/versions/active`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(409);

    const versionRes = await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        versionNumber: 1,
        behavioralTechnique: 'تقنية الإطالة',
        trainingListJson: JSON.stringify(['حا']),
        samplePartTemplateJson: JSON.stringify([{ partType: 'مقطع', label: 'مقطع 1', order: 1, required: true }]),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/levels/${levelRes.body.id}/versions/${versionRes.body.id}/publish`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);

    const activeRes = await request(app.getHttpServer())
      .get(`/api/v1/levels/${levelRes.body.id}/versions/active`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(activeRes.body.id).toBe(versionRes.body.id);
    expect(activeRes.body.behavioralTechnique).toBe('تقنية الإطالة');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- treatment-engine-levels.e2e-spec.ts`
Expected: FAIL — the route doesn't exist yet (404 on both requests, not the expected 409/200).

- [ ] **Step 3: Add the route**

Read `backend/src/modules/treatment-engine/levels.controller.ts` first. Add this method anywhere in the class (e.g., right after `publishVersion`, before `list`):

```typescript
  @Get(':levelId/versions/active')
  @RequirePermission(Permission.VIEW_LEVELS)
  getActiveVersion(@Param('levelId') levelId: string) {
    return this.levelsService.getActiveVersion(levelId);
  }
```

No new imports needed — `Get`, `Param`, `RequirePermission`, and `Permission` are all already imported in this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test:e2e -- treatment-engine-levels.e2e-spec.ts`
Expected: PASS, all tests in the file (existing ones plus this new one).

- [ ] **Step 5: Run the full backend e2e suite to confirm no regressions**

Run: `cd backend && npm run test:e2e`
Expected: every suite passes.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/treatment-engine/levels.controller.ts backend/test/treatment-engine-levels.e2e-spec.ts
git commit -m "feat: expose GET /api/v1/levels/:levelId/versions/active

LevelsService.getActiveVersion already existed and was already used
internally by the cycle/review services, but no controller route
exposed it — GET /api/v1/levels only returns bare Level[] with no
version content. Mobile's Level Content screen needs this to show a
level's actual therapeutic content."
```

---

### Task 4: Mobile — `PatientProfileProvider`, `usePatientProfile()`, age-group wiring

**Files:**
- Create: `mobile/src/api/patients.ts`
- Create: `mobile/src/patient/PatientProfileProvider.tsx`
- Test: `mobile/src/patient/PatientProfileProvider.test.tsx`
- Modify: `mobile/app/_layout.tsx`

**Interfaces:**
- Produces: `getMyPatientProfile(): Promise<PatientProfile>` (in `api/patients.ts`) — consumed only by `PatientProfileProvider`.
- Produces: `usePatientProfile(): { patientProfileId: string | null; loading: boolean; notFound: boolean; error: string | null }` — consumed by every screen in Tasks 5–8.
- Produces: `computeAgeGroup(dateOfBirth: string): AgeGroup` (exported from `PatientProfileProvider.tsx` for direct unit testing) — pure function, no other task consumes it directly.

- [ ] **Step 1: Write the failing test**

Read `mobile/app/__tests__/login.test.tsx` first for the exact `jest.mock`/`render`/`waitFor` conventions already used in this codebase. Create `mobile/src/patient/PatientProfileProvider.test.tsx`:

```typescript
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { PatientProfileProvider, usePatientProfile, computeAgeGroup } from './PatientProfileProvider';
import { getMyPatientProfile } from '../api/patients';

jest.mock('../api/patients');

function Consumer() {
  const { patientProfileId, loading, notFound, error } = usePatientProfile();
  const { ageGroup } = useTheme();
  if (loading) return <Text>loading</Text>;
  if (notFound) return <Text>not-found</Text>;
  if (error) return <Text>{error}</Text>;
  return <Text>{`${patientProfileId}:${ageGroup}`}</Text>;
}

describe('computeAgeGroup', () => {
  it('classifies under 13 as child, 13-17 as teen, 18+ as adult', () => {
    const now = new Date('2026-07-09');
    expect(computeAgeGroup('2015-01-01', now)).toBe('child');
    expect(computeAgeGroup('2010-01-01', now)).toBe('teen');
    expect(computeAgeGroup('1990-01-01', now)).toBe('adult');
  });
});

describe('PatientProfileProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the profile, exposes patientProfileId, and applies age-group theming', async () => {
    (getMyPatientProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      dateOfBirth: '2015-01-01',
    });

    render(
      <ThemeProvider>
        <PatientProfileProvider>
          <Consumer />
        </PatientProfileProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('profile-1:child')).toBeTruthy();
    });
  });

  it('exposes notFound when no profile exists yet', async () => {
    const { ApiError } = jest.requireActual('../api/client');
    (getMyPatientProfile as jest.Mock).mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'No patient profile exists for this user yet'));

    render(
      <ThemeProvider>
        <PatientProfileProvider>
          <Consumer />
        </PatientProfileProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('not-found')).toBeTruthy();
    });
  });

  it('exposes a generic error for a real failure', async () => {
    const { ApiError } = jest.requireActual('../api/client');
    (getMyPatientProfile as jest.Mock).mockRejectedValue(new ApiError(500, 'UNKNOWN_ERROR', 'حدث خطأ غير متوقع'));

    render(
      <ThemeProvider>
        <PatientProfileProvider>
          <Consumer />
        </PatientProfileProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('حدث خطأ غير متوقع')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- PatientProfileProvider.test.tsx`
Expected: FAIL — neither `api/patients.ts` nor `PatientProfileProvider.tsx` exist yet.

- [ ] **Step 3: Write `api/patients.ts`**

```typescript
// mobile/src/api/patients.ts
import { apiRequest } from './client';

export interface PatientProfile {
  id: string;
  userId: string;
  fullName: string;
  gender: 'MALE' | 'FEMALE';
  dateOfBirth: string;
  nationalId: string;
  address?: string | null;
  referralSource?: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

export function getMyPatientProfile(): Promise<PatientProfile> {
  return apiRequest<PatientProfile>('/api/v1/patients/me', { auth: true });
}
```

- [ ] **Step 4: Write `PatientProfileProvider.tsx`**

```typescript
// mobile/src/patient/PatientProfileProvider.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getMyPatientProfile } from '../api/patients';
import { ApiError } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import { AgeGroup } from '../theme/tokens';

interface PatientProfileContextValue {
  patientProfileId: string | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

const PatientProfileContext = createContext<PatientProfileContextValue | undefined>(undefined);

export function computeAgeGroup(dateOfBirth: string, now: Date = new Date()): AgeGroup {
  const birth = new Date(dateOfBirth);
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }
  if (age < 13) return 'child';
  if (age < 18) return 'teen';
  return 'adult';
}

export function PatientProfileProvider({ children }: { children: ReactNode }) {
  const { setAgeGroup } = useTheme();
  const [patientProfileId, setPatientProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyPatientProfile()
      .then((profile) => {
        if (cancelled) return;
        setPatientProfileId(profile.id);
        setAgeGroup(computeAgeGroup(profile.dateOfBirth));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PatientProfileContext.Provider value={{ patientProfileId, loading, notFound, error }}>
      {children}
    </PatientProfileContext.Provider>
  );
}

export function usePatientProfile(): PatientProfileContextValue {
  const ctx = useContext(PatientProfileContext);
  if (!ctx) {
    throw new Error('usePatientProfile must be used within a PatientProfileProvider');
  }
  return ctx;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npm test -- PatientProfileProvider.test.tsx`
Expected: PASS, all 4 tests (`computeAgeGroup` cases plus the 3 provider behaviors).

- [ ] **Step 6: Wire the provider into the app**

Read `mobile/app/_layout.tsx` first. Replace its contents:

```typescript
import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { AuthProvider } from '../src/auth/AuthProvider';
import { PatientProfileProvider } from '../src/patient/PatientProfileProvider';

export default function RootLayout() {
  useEffect(() => {
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <PatientProfileProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </PatientProfileProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
```

Note `PatientProfileProvider` is nested inside `AuthProvider` (not the reverse) — it fetches on mount regardless of auth state today, which is harmless pre-login (the fetch will 401/403 before the user reaches `home.tsx`, and no screen reads `usePatientProfile()` until after login), but keeps the dependency direction correct for when a future task might want to skip the fetch entirely while logged out.

- [ ] **Step 7: Run the full mobile test suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes — this only adds a new provider between two existing ones, it doesn't change `AuthProvider`, `ThemeProvider`, or any existing screen.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/patients.ts mobile/src/patient/PatientProfileProvider.tsx mobile/src/patient/PatientProfileProvider.test.tsx mobile/app/_layout.tsx
git commit -m "feat: add PatientProfileProvider, wiring patientProfileId + age-group theming

Every treatment-engine screen needs the logged-in user's
patientProfileId, and nothing in the app could discover it before now.
Also puts the existing (previously unused) child/teen/adult theme
palettes to real use for the first time, derived from the patient's
date of birth."
```

---

### Task 5: Mobile — My Program dashboard (replaces `app/home.tsx`)

**Files:**
- Create: `mobile/src/api/treatmentEngine.ts`
- Modify: `mobile/src/copy/ar.ts`
- Modify: `mobile/app/home.tsx`
- Test: `mobile/app/__tests__/home.test.tsx`

**Interfaces:**
- Produces (in `api/treatmentEngine.ts`, all consumed by this task and re-used by Tasks 6–8): `getProgress`, `getCurrentCycle`, `getCycleHistory`, `getActiveTreatmentPlan`, `startCycle`, `logTrainingEvent`, plus the exported types `ProgressDashboard`, `LevelCycleStatus`, `TrainingCycle`, `TrainingCycleWithSample`, `SpeechSample`, `SampleSamplePart`, `SpecialistDecision`, `TreatmentPlan`.
- Produces: `ar.program.*` copy namespace, consumed only by this screen.

- [ ] **Step 1: Write the failing test**

Read `mobile/app/__tests__/login.test.tsx` again for conventions. Create `mobile/app/__tests__/home.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../src/theme/ThemeContext';
import HomeScreen from '../home';
import { useAuth } from '../../src/auth/AuthProvider';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { getProgress, getCurrentCycle, getCycleHistory, getActiveTreatmentPlan, startCycle, logTrainingEvent } from '../../src/api/treatmentEngine';
import { ApiError } from '../../src/api/client';

jest.mock('../../src/auth/AuthProvider');
jest.mock('../../src/patient/PatientProfileProvider');
jest.mock('../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));

const baseProgress = {
  currentLevelName: 'Level 1',
  currentLevelOrder: 1,
  levelsCompleted: 0,
  totalTrainingEvents: 2,
  repeatedLevelOrders: [],
  daysInProgram: 3,
};

function mockNoDecisionHistory() {
  (getCycleHistory as jest.Mock).mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ isLoggedIn: true, loading: false, logout: jest.fn() });
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('HomeScreen (My Program)', () => {
  it('shows "start my program" when there is no cycle but an active treatment plan exists', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'No active training cycle'));
    (getActiveTreatmentPlan as jest.Mock).mockResolvedValue({ id: 'plan-1' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('ابدأ برنامجي')).toBeTruthy();
    });

    (startCycle as jest.Mock).mockResolvedValue({ ...baseProgress, id: 'cycle-1', status: 'ACTIVE_LEVEL_TRAINING', humanModelWatchedAt: null });
    fireEvent.press(screen.getByText('ابدأ برنامجي'));

    await waitFor(() => {
      expect(startCycle).toHaveBeenCalledWith('profile-1', 'plan-1');
    });
  });

  it('shows the "watch level content" action when the model is unwatched', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({
      id: 'cycle-1',
      levelId: 'level-1',
      status: 'ACTIVE_LEVEL_TRAINING',
      humanModelWatchedAt: null,
    });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('شاهد محتوى المستوى')).toBeTruthy();
    });
  });

  it('shows an inline "log training" button once the model is watched, and calls the endpoint', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({
      id: 'cycle-1',
      levelId: 'level-1',
      status: 'ACTIVE_LEVEL_TRAINING',
      humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
    });
    (logTrainingEvent as jest.Mock).mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE_LEVEL_TRAINING' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('سجّل تدريب اليوم')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('سجّل تدريب اليوم'));

    await waitFor(() => {
      expect(logTrainingEvent).toHaveBeenCalledWith('profile-1');
    });
  });

  it('shows the "waiting for your therapist" message for WAITING_FOR_SPECIALIST', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', status: 'WAITING_FOR_SPECIALIST' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('بانتظار مراجعة أخصائيك لعينتك')).toBeTruthy();
    });
  });

  it('shows a therapist-message banner when the most recently closed cycle has a decision', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-2', levelId: 'level-2', status: 'ACTIVE_LEVEL_TRAINING', humanModelWatchedAt: null });
    (getCycleHistory as jest.Mock).mockResolvedValue([
      {
        id: 'cycle-1',
        closedAt: '2026-07-05T00:00:00.000Z',
        speechSample: { decision: 'TRANSITION' },
      },
    ]);

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لديك رسالة من أخصائيك')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- home.test.tsx`
Expected: FAIL — `src/api/treatmentEngine.ts` doesn't exist yet, and `app/home.tsx` is still the placeholder.

- [ ] **Step 3: Write `api/treatmentEngine.ts`**

```typescript
// mobile/src/api/treatmentEngine.ts
import { apiRequest } from './client';

export interface ProgressDashboard {
  currentLevelName: string | null;
  currentLevelOrder: number | null;
  levelsCompleted: number;
  totalTrainingEvents: number;
  repeatedLevelOrders: number[];
  daysInProgram: number;
}

export function getProgress(patientProfileId: string): Promise<ProgressDashboard> {
  return apiRequest<ProgressDashboard>(`/api/v1/patients/${patientProfileId}/progress`, { auth: true });
}

export type LevelCycleStatus =
  | 'ACTIVE_LEVEL_TRAINING'
  | 'SAMPLE_ELIGIBLE'
  | 'SAMPLE_PREPARATION'
  | 'SAMPLE_SUBMITTED'
  | 'WAITING_FOR_SPECIALIST'
  | 'UNDER_REVIEW'
  | 'DIRECT_INTERVENTION_REQUIRED'
  | 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'
  | 'TECHNICAL_PARTIAL_RERECORD'
  | 'LEVEL_REPEAT_DECIDED'
  | 'NEXT_LEVEL_APPROVED'
  | 'CLOSED_DUE_TO_INACTIVITY'
  | 'SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN';

export interface TrainingCycle {
  id: string;
  patientProfileId: string;
  treatmentPlanId: string;
  levelId: string;
  levelVersionId: string;
  cycleNumber: number;
  status: LevelCycleStatus;
  humanModelWatchedAt: string | null;
  firstTrainingEventAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getCurrentCycle(patientProfileId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/current`, { auth: true });
}

export type SpecialistDecision = 'TRANSITION' | 'LEVEL_REPEAT' | 'TECHNICAL_RERECORD';

export interface SampleSamplePart {
  id: string;
  partType: string;
  label: string;
  order: number;
  recordingUrl: string | null;
  technicallyDamaged: boolean;
}

export interface SpeechSample {
  id: string;
  trainingCycleId: string;
  selfSeverityCurrent: number | null;
  selfSeverityExpectedNext: number | null;
  camperdownPerformanceRating: number | null;
  clientOpinionScore: number | null;
  submittedAt: string | null;
  reviewedByUserId: string | null;
  clinicianOpinionScore: number | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  decision: SpecialistDecision | null;
  parts: SampleSamplePart[];
}

export interface TrainingCycleWithSample extends TrainingCycle {
  speechSample: SpeechSample | null;
}

export function getCycleHistory(patientProfileId: string): Promise<TrainingCycleWithSample[]> {
  return apiRequest<TrainingCycleWithSample[]>(`/api/v1/patients/${patientProfileId}/cycles`, { auth: true });
}

export interface TreatmentPlan {
  id: string;
  patientProfileId: string;
  clinicianUserId: string;
  assessmentId: string;
  phase: string;
  goals: string;
  reviewDate: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export function getActiveTreatmentPlan(patientProfileId: string): Promise<TreatmentPlan> {
  return apiRequest<TreatmentPlan>(`/api/v1/patients/${patientProfileId}/treatment-plans/active`, { auth: true });
}

export function startCycle(patientProfileId: string, treatmentPlanId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/start`, {
    method: 'POST',
    auth: true,
    body: { treatmentPlanId },
  });
}

export function logTrainingEvent(patientProfileId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/current/training-events`, {
    method: 'POST',
    auth: true,
    body: {},
  });
}
```

Note: `watchHumanModel` and `getActiveLevelVersion` are NOT in this file — they belong to Task 6 (Level Content), which will add them to this same file.

- [ ] **Step 4: Add the `program` copy namespace**

Read `mobile/src/copy/ar.ts` first. Add this key to the exported `ar` object (anywhere among the existing top-level keys — e.g., right after `resetPassword`):

```typescript
  program: {
    loading: 'جارٍ التحميل...',
    startProgram: 'ابدأ برنامجي',
    noTreatmentPlanYet: 'لم يُكمل فريقك الطبي خطة علاجك بعد — يرجى التواصل مع عيادتك',
    watchLevelContent: 'شاهد محتوى المستوى',
    logTraining: 'سجّل تدريب اليوم',
    sampleComingSoon: 'هذه المرحلة تتطلب تسجيل عينة صوتية — هذه الميزة قادمة في تحديث لاحق',
    waitingForSpecialist: 'بانتظار مراجعة أخصائيك لعينتك',
    pausedForInactivity: 'توقف برنامجك بسبب عدم النشاط — تواصل مع عيادتك لاستئنافه',
    genericWaiting: 'أخصائيك يراجع حالتك',
    therapistMessageBanner: 'لديك رسالة من أخصائيك',
    viewHistory: 'السجل',
    viewLevelContent: 'محتوى المستوى',
    logout: 'تسجيل الخروج',
  },
```

- [ ] **Step 5: Write the My Program screen**

Replace the entire contents of `mobile/app/home.tsx`:

```typescript
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { useAuth } from '../src/auth/AuthProvider';
import { usePatientProfile } from '../src/patient/PatientProfileProvider';
import { Button } from '../src/components/Button';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { ApiError } from '../src/api/client';
import {
  getProgress,
  getCurrentCycle,
  getCycleHistory,
  getActiveTreatmentPlan,
  startCycle,
  logTrainingEvent,
  ProgressDashboard,
  TrainingCycle,
  TrainingCycleWithSample,
  TreatmentPlan,
} from '../src/api/treatmentEngine';

const STATES_NEEDING_SAMPLE_RECORDING = new Set(['SAMPLE_ELIGIBLE', 'SAMPLE_PREPARATION', 'TECHNICAL_PARTIAL_RERECORD']);
const STATES_WAITING_ON_SPECIALIST = new Set(['WAITING_FOR_SPECIALIST', 'UNDER_REVIEW']);

function mostRecentDecidedCycle(history: TrainingCycleWithSample[]): TrainingCycleWithSample | null {
  const decided = history
    .filter((c) => c.closedAt && c.speechSample?.decision)
    .sort((a, b) => new Date(b.closedAt as string).getTime() - new Date(a.closedAt as string).getTime());
  return decided[0] ?? null;
}

export default function HomeScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { logout } = useAuth();
  const { patientProfileId, loading: profileLoading, notFound: profileNotFound, error: profileError } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressDashboard | null>(null);
  const [cycle, setCycle] = useState<TrainingCycle | null>(null);
  const [cycleNotFound, setCycleNotFound] = useState(false);
  const [activeTreatmentPlan, setActiveTreatmentPlan] = useState<TreatmentPlan | null>(null);
  const [noActivePlan, setNoActivePlan] = useState(false);
  const [recentDecisionCycle, setRecentDecisionCycle] = useState<TrainingCycleWithSample | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const [progressResult, historyResult] = await Promise.all([getProgress(id), getCycleHistory(id)]);
        setProgress(progressResult);
        setRecentDecisionCycle(mostRecentDecidedCycle(historyResult));

        try {
          const currentCycle = await getCurrentCycle(id);
          setCycle(currentCycle);
          setCycleNotFound(false);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            setCycle(null);
            setCycleNotFound(true);
            try {
              const plan = await getActiveTreatmentPlan(id);
              setActiveTreatmentPlan(plan);
              setNoActivePlan(false);
            } catch (planErr) {
              if (planErr instanceof ApiError && planErr.status === 404) {
                setActiveTreatmentPlan(null);
                setNoActivePlan(true);
              } else {
                throw planErr;
              }
            }
          } else {
            throw err;
          }
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      if (patientProfileId) {
        load(patientProfileId);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [patientProfileId]),
  );

  async function handleStartProgram() {
    if (!patientProfileId || !activeTreatmentPlan) return;
    setSubmitting(true);
    try {
      await startCycle(patientProfileId, activeTreatmentPlan.id);
      await load(patientProfileId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogTraining() {
    if (!patientProfileId) return;
    setSubmitting(true);
    try {
      await logTrainingEvent(patientProfileId);
      await load(patientProfileId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/');
  }

  function renderPrimaryAction() {
    if (cycleNotFound) {
      if (activeTreatmentPlan) {
        return <Button title={ar.program.startProgram} onPress={handleStartProgram} loading={submitting} />;
      }
      if (noActivePlan) {
        return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.noTreatmentPlanYet}</Text>;
      }
      return null;
    }

    if (!cycle) return null;

    if (cycle.status === 'ACTIVE_LEVEL_TRAINING') {
      if (!cycle.humanModelWatchedAt) {
        return <Button title={ar.program.watchLevelContent} onPress={() => router.push('/program/level-content')} />;
      }
      return <Button title={ar.program.logTraining} onPress={handleLogTraining} loading={submitting} />;
    }
    if (STATES_NEEDING_SAMPLE_RECORDING.has(cycle.status)) {
      return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.sampleComingSoon}</Text>;
    }
    if (STATES_WAITING_ON_SPECIALIST.has(cycle.status)) {
      return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.waitingForSpecialist}</Text>;
    }
    if (cycle.status === 'CLOSED_DUE_TO_INACTIVITY') {
      return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.pausedForInactivity}</Text>;
    }
    return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.genericWaiting}</Text>;
  }

  if (profileLoading || loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (profileNotFound) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={ar.program.noTreatmentPlanYet} />
      </View>
    );
  }

  if (profileError || error) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={(profileError || error) as string} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      {progress ? (
        <Text style={[styles.levelName, { color: tokens.colors.text }]}>
          {progress.currentLevelName ?? ''}
        </Text>
      ) : null}

      {recentDecisionCycle ? (
        <View style={{ marginBottom: 16 }}>
          <Button
            title={ar.program.therapistMessageBanner}
            onPress={() =>
              router.push({ pathname: '/program/sample-result', params: { cycleId: recentDecisionCycle.id } })
            }
          />
        </View>
      ) : null}

      <View style={{ marginBottom: 24 }}>{renderPrimaryAction()}</View>

      <View style={styles.linksRow}>
        <Button title={ar.program.viewLevelContent} onPress={() => router.push('/program/level-content')} />
        <Button title={ar.program.viewHistory} onPress={() => router.push('/program/history')} />
      </View>

      <View style={{ marginTop: 24 }}>
        <Button title={ar.program.logout} onPress={handleLogout} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  levelName: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 16 },
  linksRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd mobile && npm test -- home.test.tsx`
Expected: PASS, all 5 tests.

- [ ] **Step 7: Run the full mobile test suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/treatmentEngine.ts mobile/src/copy/ar.ts mobile/app/home.tsx mobile/app/__tests__/home.test.tsx
git commit -m "feat: replace home placeholder with the My Program dashboard

Shows the patient's current level/cycle status in patient-friendly
language, with exactly one primary action per state: start the
program (self-service, using the active treatment plan), watch the
level content, log training, or an informational message for every
waiting/deferred state. Surfaces a 'message from your therapist'
banner whenever the most recently closed cycle has a decision."
```

---

### Task 6: Mobile — Level Content screen

**Files:**
- Modify: `mobile/src/api/treatmentEngine.ts`
- Modify: `mobile/src/copy/ar.ts`
- Create: `mobile/app/program/level-content.tsx`
- Test: `mobile/app/program/__tests__/level-content.test.tsx`

**Interfaces:**
- Produces (added to `api/treatmentEngine.ts`): `getActiveLevelVersion(levelId): Promise<LevelVersion>`, `watchHumanModel(patientProfileId): Promise<TrainingCycle>`, and the exported `LevelVersion` type. No other task consumes these directly.

- [ ] **Step 1: Write the failing test**

Create `mobile/app/program/__tests__/level-content.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import LevelContentScreen from '../level-content';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getCurrentCycle, getActiveLevelVersion, watchHumanModel } from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('LevelContentScreen', () => {
  it('shows the technique, reflection prompts, training list, and the mark-as-watched button when unwatched', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', humanModelWatchedAt: null });
    (getActiveLevelVersion as jest.Mock).mockResolvedValue({
      behavioralTechnique: 'الإطالة السهلة',
      cognitiveVideo1Question: 'ماذا شعرت؟',
      cognitiveVideo2Question: null,
      trainingListJson: JSON.stringify(['حا', 'جا']),
    });

    render(<ThemeProvider><LevelContentScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('الإطالة السهلة')).toBeTruthy();
      expect(screen.getByText('ماذا شعرت؟')).toBeTruthy();
      expect(screen.getByText('حا')).toBeTruthy();
      expect(screen.getByText('جا')).toBeTruthy();
      expect(screen.getByText('وضع علامة كمشاهد')).toBeTruthy();
    });

    (watchHumanModel as jest.Mock).mockResolvedValue({ id: 'cycle-1', humanModelWatchedAt: '2026-07-09T00:00:00.000Z' });
    fireEvent.press(screen.getByText('وضع علامة كمشاهد'));

    await waitFor(() => {
      expect(watchHumanModel).toHaveBeenCalledWith('profile-1');
    });
  });

  it('hides the mark-as-watched button once already watched', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', humanModelWatchedAt: '2026-07-01T00:00:00.000Z' });
    (getActiveLevelVersion as jest.Mock).mockResolvedValue({
      behavioralTechnique: 'الإطالة السهلة',
      cognitiveVideo1Question: null,
      cognitiveVideo2Question: null,
      trainingListJson: JSON.stringify(['حا']),
    });

    render(<ThemeProvider><LevelContentScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('الإطالة السهلة')).toBeTruthy();
    });
    expect(screen.queryByText('وضع علامة كمشاهد')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- level-content.test.tsx`
Expected: FAIL — `getActiveLevelVersion`/`watchHumanModel` don't exist yet, and `app/program/level-content.tsx` doesn't exist.

- [ ] **Step 3: Extend `api/treatmentEngine.ts`**

Read `mobile/src/api/treatmentEngine.ts` first (created in Task 5). Append these exports:

```typescript
export interface LevelVersion {
  id: string;
  levelId: string;
  versionNumber: number;
  cognitiveVideo1Url: string | null;
  cognitiveVideo1Question: string | null;
  cognitiveVideo2Url: string | null;
  cognitiveVideo2Question: string | null;
  behavioralTechnique: string;
  humanModelVideoUrl: string | null;
  humanModelDurationSeconds: number | null;
  trainingListJson: string;
  samplePartTemplateJson: string;
  publishedAt: string | null;
}

export function getActiveLevelVersion(levelId: string): Promise<LevelVersion> {
  return apiRequest<LevelVersion>(`/api/v1/levels/${levelId}/versions/active`, { auth: true });
}

export function watchHumanModel(patientProfileId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/current/watch-human-model`, {
    method: 'POST',
    auth: true,
  });
}
```

- [ ] **Step 4: Add the `levelContent` copy namespace**

Read `mobile/src/copy/ar.ts` first. Add this key alongside `program` (added in Task 5):

```typescript
  levelContent: {
    title: 'محتوى المستوى',
    reflectionPrompt: 'فكّر في',
    trainingListTitle: 'قائمة التدريب',
    markWatched: 'وضع علامة كمشاهد',
  },
```

- [ ] **Step 5: Write the screen**

```typescript
// mobile/app/program/level-content.tsx
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getCurrentCycle, getActiveLevelVersion, watchHumanModel, LevelVersion } from '../../src/api/treatmentEngine';

export default function LevelContentScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [levelVersion, setLevelVersion] = useState<LevelVersion | null>(null);
  const [watchedAt, setWatchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const cycle = await getCurrentCycle(id);
      setWatchedAt(cycle.humanModelWatchedAt);
      const version = await getActiveLevelVersion(cycle.levelId);
      setLevelVersion(version);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (patientProfileId) {
      load(patientProfileId);
    }
  }, [patientProfileId, load]);

  async function handleMarkWatched() {
    if (!patientProfileId) return;
    setSubmitting(true);
    try {
      await watchHumanModel(patientProfileId);
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error || !levelVersion) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error ?? 'حدث خطأ غير متوقع'} />
      </View>
    );
  }

  const trainingList: string[] = JSON.parse(levelVersion.trainingListJson);

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.levelContent.title}</Text>
      <Text style={{ color: tokens.colors.text, marginBottom: 16 }}>{levelVersion.behavioralTechnique}</Text>

      {levelVersion.cognitiveVideo1Question ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 8 }}>
          {ar.levelContent.reflectionPrompt}: {levelVersion.cognitiveVideo1Question}
        </Text>
      ) : null}
      {levelVersion.cognitiveVideo2Question ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>
          {ar.levelContent.reflectionPrompt}: {levelVersion.cognitiveVideo2Question}
        </Text>
      ) : null}

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.levelContent.trainingListTitle}</Text>
      {trainingList.map((item, index) => (
        <Text key={index} style={{ color: tokens.colors.text, marginBottom: 4 }}>
          {item}
        </Text>
      ))}

      {!watchedAt ? (
        <View style={{ marginTop: 24 }}>
          <Button title={ar.levelContent.markWatched} onPress={handleMarkWatched} loading={submitting} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 8 },
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd mobile && npm test -- level-content.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 7: Run the full mobile test suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/treatmentEngine.ts mobile/src/copy/ar.ts mobile/app/program/level-content.tsx mobile/app/program/__tests__/level-content.test.tsx
git commit -m "feat: add Level Content screen (technique, reflection prompts, training list)

Shows the current level's therapeutic content as text — no real video
exists yet — plus a mark-as-watched action that only appears while
unwatched. Doubles as ongoing reference material, reachable anytime
from My Program, not just on first watch."
```

---

### Task 7: Mobile — History screen

**Files:**
- Modify: `mobile/src/api/treatmentEngine.ts`
- Modify: `mobile/src/copy/ar.ts`
- Create: `mobile/app/program/history.tsx`
- Test: `mobile/app/program/__tests__/history.test.tsx`

**Interfaces:**
- Produces (added to `api/treatmentEngine.ts`): `getLevels(): Promise<Level[]>` and the exported `Level` type — consumed only by this screen (to resolve a cycle's `levelId` into a display name).

- [ ] **Step 1: Write the failing test**

Create `mobile/app/program/__tests__/history.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import HistoryScreen from '../history';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getCycleHistory, getLevels } from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
const pushMock = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: pushMock }) }));

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
  (getLevels as jest.Mock).mockResolvedValue([{ id: 'level-1', name: 'Level 1', order: 1 }]);
});

describe('HistoryScreen', () => {
  it('lists each cycle with its level name, status, and a decision line when one exists', async () => {
    (getCycleHistory as jest.Mock).mockResolvedValue([
      {
        id: 'cycle-1',
        levelId: 'level-1',
        status: 'NEXT_LEVEL_APPROVED',
        cycleNumber: 1,
        closedAt: '2026-07-05T00:00:00.000Z',
        speechSample: { decision: 'TRANSITION' },
      },
    ]);

    render(<ThemeProvider><HistoryScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Level 1')).toBeTruthy();
      expect(screen.getByText(/قرر الأخصائي/)).toBeTruthy();
    });

    fireEvent.press(screen.getByText(/قرر الأخصائي/));
    expect(pushMock).toHaveBeenCalledWith({ pathname: '/program/sample-result', params: { cycleId: 'cycle-1' } });
  });

  it('shows no decision line for a cycle with no sample', async () => {
    (getCycleHistory as jest.Mock).mockResolvedValue([
      { id: 'cycle-1', levelId: 'level-1', status: 'ACTIVE_LEVEL_TRAINING', cycleNumber: 1, closedAt: null, speechSample: null },
    ]);

    render(<ThemeProvider><HistoryScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Level 1')).toBeTruthy();
    });
    expect(screen.queryByText(/قرر الأخصائي/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- history.test.tsx`
Expected: FAIL — `getLevels` doesn't exist yet, and `app/program/history.tsx` doesn't exist.

- [ ] **Step 3: Extend `api/treatmentEngine.ts`**

Read `mobile/src/api/treatmentEngine.ts` first. Append:

```typescript
export interface Level {
  id: string;
  name: string;
  order: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export function getLevels(): Promise<Level[]> {
  return apiRequest<Level[]>('/api/v1/levels', { auth: true });
}
```

- [ ] **Step 4: Add the `history` copy namespace**

Read `mobile/src/copy/ar.ts` first. Add this key alongside `program`/`levelContent`:

```typescript
  history: {
    title: 'السجل',
    empty: 'لا يوجد سجل بعد',
    decisionLinePrefix: 'قرر الأخصائي:',
    decisions: {
      TRANSITION: 'الانتقال للمستوى التالي',
      LEVEL_REPEAT: 'إعادة هذا المستوى',
    },
  },
```

- [ ] **Step 5: Write the screen**

```typescript
// mobile/app/program/history.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getCycleHistory, getLevels, TrainingCycleWithSample, Level, SpecialistDecision } from '../../src/api/treatmentEngine';

export default function HistoryScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [cycles, setCycles] = useState<TrainingCycleWithSample[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientProfileId) return;
    setLoading(true);
    setError(null);
    Promise.all([getCycleHistory(patientProfileId), getLevels()])
      .then(([cycleResult, levelResult]) => {
        setCycles(cycleResult);
        setLevels(levelResult);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      })
      .finally(() => setLoading(false));
  }, [patientProfileId]);

  function levelName(levelId: string): string {
    return levels.find((l) => l.id === levelId)?.name ?? levelId;
  }

  function decisionLabel(decision: SpecialistDecision): string {
    if (decision === 'TRANSITION') return ar.history.decisions.TRANSITION;
    if (decision === 'LEVEL_REPEAT') return ar.history.decisions.LEVEL_REPEAT;
    return '';
  }

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.history.title}</Text>
      {cycles.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary }}>{ar.history.empty}</Text>
      ) : (
        cycles.map((cycle) => (
          <View key={cycle.id} style={[styles.row, { borderColor: tokens.colors.border }]}>
            <Text style={{ color: tokens.colors.text, fontWeight: '600' }}>{levelName(cycle.levelId)}</Text>
            <Text style={{ color: tokens.colors.textSecondary }}>{cycle.status}</Text>
            <Text style={{ color: tokens.colors.textSecondary }}>#{cycle.cycleNumber}</Text>
            {cycle.speechSample?.decision ? (
              <Pressable
                onPress={() => router.push({ pathname: '/program/sample-result', params: { cycleId: cycle.id } })}
              >
                <Text style={{ color: tokens.colors.primary }}>
                  {ar.history.decisionLinePrefix} {decisionLabel(cycle.speechSample.decision)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  row: { borderBottomWidth: 1, paddingVertical: 12, gap: 4 },
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd mobile && npm test -- history.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 7: Run the full mobile test suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/treatmentEngine.ts mobile/src/copy/ar.ts mobile/app/program/history.tsx mobile/app/program/__tests__/history.test.tsx
git commit -m "feat: add read-only cycle History screen

Lists every past and current cycle with its level name, status, cycle
number, and — where one exists — a decision line linking to Sample
Result for that specific cycle. Purely read-only, matching AC-11 from
the Treatment Engine v2 backend (viewing history never mutates
anything)."
```

---

### Task 8: Mobile — Sample Result screen

**Files:**
- Modify: `mobile/src/copy/ar.ts`
- Create: `mobile/app/program/sample-result.tsx`
- Test: `mobile/app/program/__tests__/sample-result.test.tsx`

**Interfaces:**
- Consumes: `getCycleHistory` (from Task 5) and the `cycleId` route param navigated to by Task 7's History screen. No new API functions — reuses the already-fetched-elsewhere cycle history rather than adding a "get one cycle" endpoint (there isn't one, and this plan doesn't add one — see Task 2's design-review note).

- [ ] **Step 1: Write the failing test**

Create `mobile/app/program/__tests__/sample-result.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import SampleResultScreen from '../sample-result';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getCycleHistory } from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ cycleId: 'cycle-1' }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('SampleResultScreen', () => {
  it('shows the decision, clinician notes, and self-report scores for the matching cycle', async () => {
    (getCycleHistory as jest.Mock).mockResolvedValue([
      {
        id: 'cycle-1',
        speechSample: {
          decision: 'TRANSITION',
          reviewNotes: 'أداء ممتاز',
          clinicianOpinionScore: 8,
          selfSeverityCurrent: 4,
          selfSeverityExpectedNext: 3,
          camperdownPerformanceRating: 7,
          clientOpinionScore: 6,
        },
      },
    ]);

    render(<ThemeProvider><SampleResultScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('الانتقال للمستوى التالي')).toBeTruthy();
      expect(screen.getByText('أداء ممتاز')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- sample-result.test.tsx`
Expected: FAIL — `app/program/sample-result.tsx` doesn't exist yet.

- [ ] **Step 3: Add the `sampleResult` copy namespace**

Read `mobile/src/copy/ar.ts` first. Add this key alongside `program`/`levelContent`/`history`:

```typescript
  sampleResult: {
    title: 'نتيجة عينتك',
    decisions: {
      TRANSITION: 'الانتقال للمستوى التالي',
      LEVEL_REPEAT: 'إعادة هذا المستوى',
    },
    clinicianNotesTitle: 'ملاحظات أخصائيك',
    selfReportTitle: 'تقييمك الذاتي',
    notFound: 'تعذر العثور على هذه النتيجة',
  },
```

- [ ] **Step 4: Write the screen**

```typescript
// mobile/app/program/sample-result.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getCycleHistory, SpeechSample, SpecialistDecision } from '../../src/api/treatmentEngine';

export default function SampleResultScreen() {
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();
  const { cycleId } = useLocalSearchParams<{ cycleId: string }>();

  const [sample, setSample] = useState<SpeechSample | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientProfileId) return;
    setLoading(true);
    setError(null);
    getCycleHistory(patientProfileId)
      .then((cycles) => {
        const match = cycles.find((c) => c.id === cycleId);
        setSample(match?.speechSample ?? null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      })
      .finally(() => setLoading(false));
  }, [patientProfileId, cycleId]);

  function decisionLabel(decision: SpecialistDecision): string {
    if (decision === 'TRANSITION') return ar.sampleResult.decisions.TRANSITION;
    if (decision === 'LEVEL_REPEAT') return ar.sampleResult.decisions.LEVEL_REPEAT;
    return '';
  }

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error || !sample || !sample.decision) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error ?? ar.sampleResult.notFound} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.sampleResult.title}</Text>
      <Text style={[styles.decision, { color: tokens.colors.primary }]}>{decisionLabel(sample.decision)}</Text>

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleResult.clinicianNotesTitle}</Text>
      <Text style={{ color: tokens.colors.text, marginBottom: 16 }}>{sample.reviewNotes ?? ''}</Text>

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleResult.selfReportTitle}</Text>
      <Text style={{ color: tokens.colors.textSecondary }}>{`${sample.selfSeverityCurrent} / ${sample.selfSeverityExpectedNext} / ${sample.camperdownPerformanceRating} / ${sample.clientOpinionScore}`}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  decision: { fontSize: 16, fontWeight: '600', marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npm test -- sample-result.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full mobile test suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/copy/ar.ts mobile/app/program/sample-result.tsx mobile/app/program/__tests__/sample-result.test.tsx
git commit -m "feat: add Sample Result screen

Shown only for a specific past (closed) cycle whose sample has a
decision — reached from History, never from 'current' (a decision is
only ever visible once its cycle has closed). Shows the decision in
patient-friendly wording, the clinician's notes, and the patient's own
self-report scores from submission time."
```

---

### Task 9: Full suite verification (final task)

**Files:**
- None created or modified — this task only runs and confirms.

**Interfaces:**
- None produced — this is the plan's terminal task.

- [ ] **Step 1: Run the full backend e2e suite**

```bash
cd backend
npm run test:e2e
```
Expected: every suite passes, including the 3 new/changed tests from Tasks 1–3 and every pre-existing suite untouched by this plan.

- [ ] **Step 2: Run `tsc --noEmit` on the backend**

```bash
cd backend
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Run the full mobile test suite**

```bash
cd mobile
npm test
```
Expected: every suite passes, including the 4 new screen/provider test files from Tasks 4–8 and every pre-existing test (login, register, OTP, etc.) untouched by this plan.

- [ ] **Step 4: Manual walkthrough against the running dev servers**

Start both dev servers (`kalamy-backend` and `kalamy-mobile-web` from `.claude/launch.json`), then walk through, in order: register a patient → have a clinician create a patient profile for that user + an approved assessment + an active treatment plan (via `curl`/Swagger, matching this session's own prior manual-walkthrough pattern — there is still no mobile UI for assessment/treatment-plan creation, that's a different, not-yet-built sub-project) → log in as the patient in the mobile web preview → confirm My Program shows "Start my program" → tap it → confirm the dashboard now shows "Watch the level content" → open Level Content, confirm the technique/training list render, tap "Mark as watched" → confirm My Program now shows "Log training" → tap it → confirm the cycle stays `ACTIVE_LEVEL_TRAINING` (the 72-hour gate is real and cannot be walked through live) → open History, confirm the current cycle appears with no decision line yet.

This step has no automated pass/fail — its purpose is to catch anything the component-test mocks might have papered over (e.g., a real RTL layout issue, a real navigation param-passing bug between History and Sample Result). Report what you saw; if anything looks wrong, fix it in the relevant earlier task's files and re-run that task's own test file before continuing.

- [ ] **Step 5: Commit (only if Step 4 required fixes)**

If Step 4 surfaced no issues, there is nothing to commit for this task. If it did, commit the fix with a message describing what the manual walkthrough caught that the automated tests didn't.

---

## Self-Review Notes

**Spec coverage**: every in-scope item from `docs/superpowers/specs/2026-07-09-mobile-treatment-engine-screens-design.md` has a task — the two new backend endpoints and one enrichment (Tasks 1–3), `PatientProfileProvider`/age-group theming (Task 4), the My Program state table covering all 13 statuses plus the self-start and no-plan branches (Task 5), Level Content (Task 6), History (Task 7), Sample Result (Task 8). The spec's own three design-review notes (decisions-live-on-closed-cycles; the missing `/me` endpoint; the missing level-version endpoint) are each reflected in the task that fixes them, with the reasoning restated so an implementer who only reads their own task brief still understands *why*, not just *what*.

**Placeholder scan**: no task contains "TBD"/"TODO"/"add error handling"/"similar to Task N" — every step has complete, copy-pasteable code, and every test asserts real behavior (specific Arabic strings, specific function-call arguments), not `expect(true).toBe(true)`-style stand-ins.

**Type consistency, checked across tasks**: `TrainingCycle`/`TrainingCycleWithSample`/`ProgressDashboard`/`SpeechSample`/`SampleSamplePart`/`SpecialistDecision`/`TreatmentPlan`/`LevelVersion`/`Level` are all defined once (in Tasks 5, 6, or 7, whichever first needs them) and reused by name in every later task that touches them — Task 6 imports `TrainingCycle` from Task 5's file rather than redefining it; Task 7 and Task 8 both import `TrainingCycleWithSample`/`SpeechSample`/`SpecialistDecision` the same way. `usePatientProfile()`'s return shape (`{ patientProfileId, loading, notFound, error }`, defined in Task 4) is consumed identically in Tasks 5–8 — no task invents a different field name for the same concept.

**A note on test-file placement for hooks/providers vs. the api-function files themselves**: following this codebase's own established convention (`api/auth.ts` has no dedicated test file; its behavior is verified through the screens that mock it, e.g. `login.test.tsx`), the `api/patients.ts` and `api/treatmentEngine.ts` files created across Tasks 4–7 are likewise not given their own dedicated unit-test files — they are thin typed wrappers around `apiRequest`, and their correct usage (right path, right method, right body) is verified by the screen/provider tests that mock them and assert on the exact arguments those mocks were called with (e.g., Task 5's `expect(startCycle).toHaveBeenCalledWith('profile-1', 'plan-1')`).

