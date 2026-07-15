# Staff Web Sample Review & Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give clinicians/admins a working UI for the specialist-review queue (list → reserve → view sample → decide/intervene) and give all staff roles a patient progress dashboard, on top of an already-shipped, unmodified backend.

**Architecture:** Four new API modules following `staff-web/src/api/*.ts`'s existing thin-wrapper-over-`apiRequest` pattern; a new top-level `/review-queue` route; two new `<Card>` sections (`SampleReviewSection`, `ProgressSection`) added to the existing `PatientDetailPage` alongside `ProfileSection`/`AssessmentsSection`/`TreatmentPlanSection`; one new permission helper (`canReviewSample`).

**Tech Stack:** Vite, React 19.2, TypeScript, Mantine **9.4.1 exactly** (already installed — do not let any dependency step re-resolve this), React Router 7 (classic `<Routes>` API), Vitest 4 + `@testing-library/react` 16.

## Global Constraints

- Mantine version is pinned at 9.4.1 in `package.json` already — no task in this plan touches `package.json` dependencies.
- Every task must pass `npm run build` (which runs `tsc -b` before `vite build`) in addition to `npm test` — `npm test` alone does not type-check in this project, and real bugs in the prior sub-project were only caught by the build step.
- All new copy goes into `staff-web/src/copy/ar.ts` under new namespaces (`ar.reviewQueue`, `ar.sampleReview`, `ar.progress`) — Arabic only, matching the existing flat-object, per-screen-namespace convention exactly.
- `SampleReviewSection` and the `/review-queue` route/nav-link are visible only when `canReviewSample(user.role)` is true (`CLINICIAN`/`ADMIN`) — a `SUPERVISOR` cannot call the underlying backend endpoints (403) and must not see broken UI for them.
- `ProgressSection` has no role gating — `VIEW_PROGRESS`/`VIEW_LEVELS` are granted to all three staff roles.
- Every new/changed component gets its own colocated `*.test.tsx` (no `__tests__` folders), following `AssessmentsSection.test.tsx`'s exact mocking/provider-wrapping conventions.
- Run tests with `npm test` and the type-check+build gate with `npm run build`, both from `staff-web/`. Current baseline on this branch: 47 tests across 17 files, clean build, before Task 1 starts.

---

### Task 1: API modules and permission helper

**Files:**
- Create: `staff-web/src/api/cycles.ts`
- Create: `staff-web/src/api/specialist-review.ts`
- Create: `staff-web/src/api/progress.ts`
- Create: `staff-web/src/api/sample-media.ts`
- Modify: `staff-web/src/auth/permissions.ts`
- Test: `staff-web/src/api/cycles.test.ts`, `staff-web/src/api/specialist-review.test.ts`, `staff-web/src/api/progress.test.ts`

**Interfaces:**
- Produces: `getCurrentCycle`, `TrainingCycle`, `LevelCycleStatus`, `SpeechSample`, `SampleSamplePart`, `SpecialistDecision` (`cycles.ts`); `listAvailableSamples`, `reserveSample`, `reviewSample`, `ReviewSampleInput`, `requestIntervention`, `completeIntervention`, `RequestInterventionInput`, `CompleteInterventionInput`, `AvailableSampleRow`, `InterventionType` (`specialist-review.ts`); `getProgressDashboard`, `ProgressDashboard`, `getPassedLevels`, `PassedLevelSummary` (`progress.ts`); `fetchSampleMediaBlob` (`sample-media.ts`); `canReviewSample(role): boolean` (`permissions.ts`) — all consumed by Tasks 2-5.

- [ ] **Step 1: Write the failing tests**

Create `staff-web/src/api/cycles.test.ts`:

```typescript
import { apiRequest } from './client';
import { getCurrentCycle } from './cycles';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('cycles API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCurrentCycle fetches the current cycle for a patient', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cycle-1',
      patientProfileId: 'patient-1',
      treatmentPlanId: 'plan-1',
      levelId: 'level-1',
      levelVersionId: 'version-1',
      cycleNumber: 1,
      status: 'WAITING_FOR_SPECIALIST',
      humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
      firstTrainingEventAt: '2026-07-01T00:00:00.000Z',
      closedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      speechSample: null,
    });

    const result = await getCurrentCycle('patient-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/cycles/current', { auth: true });
    expect(result.status).toBe('WAITING_FOR_SPECIALIST');
  });
});
```

Create `staff-web/src/api/specialist-review.test.ts`:

```typescript
import { apiRequest } from './client';
import { listAvailableSamples, reserveSample, reviewSample, requestIntervention, completeIntervention } from './specialist-review';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('specialist-review API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listAvailableSamples fetches the queue', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listAvailableSamples();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/available-samples', { auth: true });
  });

  it('reserveSample posts to the reserve endpoint for a cycle', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1' });
    await reserveSample('cycle-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/cycles/cycle-1/reserve', { method: 'POST', auth: true });
  });

  it('reviewSample posts a TRANSITION decision', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1', decision: 'TRANSITION' });
    await reviewSample('patient-1', { decision: 'TRANSITION', clinicianOpinionScore: 7, reviewNotes: 'good' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/cycles/current/review', {
      method: 'POST',
      auth: true,
      body: { decision: 'TRANSITION', clinicianOpinionScore: 7, reviewNotes: 'good' },
    });
  });

  it('requestIntervention posts type and reason', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1' });
    await requestIntervention('cycle-1', { interventionType: 'VIDEO_MEETING', reasonNote: 'needs direct observation' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/cycles/cycle-1/intervention', {
      method: 'POST',
      auth: true,
      body: { interventionType: 'VIDEO_MEETING', reasonNote: 'needs direct observation' },
    });
  });

  it('completeIntervention posts outcome notes', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1' });
    await completeIntervention('cycle-1', { outcomeNotes: 'observed session, improving' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/cycles/cycle-1/intervention/complete', {
      method: 'POST',
      auth: true,
      body: { outcomeNotes: 'observed session, improving' },
    });
  });
});
```

Create `staff-web/src/api/progress.test.ts`:

```typescript
import { apiRequest } from './client';
import { getProgressDashboard, getPassedLevels } from './progress';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('progress API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getProgressDashboard fetches the dashboard for a patient', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: 'Level 2',
      currentLevelOrder: 2,
      levelsCompleted: 1,
      totalTrainingEvents: 12,
      repeatedLevelOrders: [],
      daysInProgram: 30,
    });
    const result = await getProgressDashboard('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/progress', { auth: true });
    expect(result.levelsCompleted).toBe(1);
  });

  it('getPassedLevels fetches the passed-levels list for a patient', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await getPassedLevels('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/levels/passed', { auth: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- cycles.test specialist-review.test progress.test` (from `staff-web/`)
Expected: FAIL — none of the four API modules exist yet.

- [ ] **Step 3: Create `staff-web/src/api/cycles.ts`**

```typescript
import { apiRequest } from './client';

export type LevelCycleStatus =
  | 'ACTIVE_LEVEL_TRAINING'
  | 'SAMPLE_ELIGIBLE'
  | 'SAMPLE_PREPARATION'
  | 'SAMPLE_SUBMISSION_DELAYED'
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

export type SpecialistDecision = 'TRANSITION' | 'LEVEL_REPEAT' | 'TECHNICAL_RERECORD';
export type InterventionType = 'VIDEO_MEETING' | 'VOICE_CONSULTATION' | 'TARGETED_MESSAGE' | 'CLINICAL_ACTION';

export interface SampleSamplePart {
  id: string;
  partType: string;
  label: string;
  order: number;
  recordingUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
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
  reservedByUserId: string | null;
  reservedAt: string | null;
  reviewDeadlineAt: string | null;
  interventionType: InterventionType | null;
  interventionRequestedAt: string | null;
  interventionDeadlineAt: string | null;
  interventionCompletedAt: string | null;
  interventionOutcomeNotes: string | null;
  parts: SampleSamplePart[];
}

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
  speechSample?: SpeechSample | null;
}

export function getCurrentCycle(patientId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientId}/cycles/current`, { auth: true });
}
```

- [ ] **Step 4: Create `staff-web/src/api/specialist-review.ts`**

```typescript
import { apiRequest } from './client';
import type { SpeechSample, InterventionType } from './cycles';

export interface AvailableSampleRow {
  id: string;
  patientProfileId: string;
  levelId: string;
  status: string;
  speechSample: SpeechSample | null;
  patientProfile: { id: string; fullName: string };
}

export function listAvailableSamples(): Promise<AvailableSampleRow[]> {
  return apiRequest<AvailableSampleRow[]>('/api/v1/specialist-review/available-samples', { auth: true });
}

export function reserveSample(cycleId: string): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/specialist-review/cycles/${cycleId}/reserve`, { method: 'POST', auth: true });
}

export type ReviewSampleInput =
  | { decision: 'TRANSITION'; clinicianOpinionScore: number; reviewNotes?: string }
  | { decision: 'LEVEL_REPEAT'; clinicianOpinionScore: number; reviewNotes?: string }
  | { decision: 'TECHNICAL_RERECORD'; damagedPartIds: string[]; reviewNotes?: string };

export function reviewSample(patientId: string, input: ReviewSampleInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/patients/${patientId}/cycles/current/review`, {
    method: 'POST',
    auth: true,
    body: input,
  });
}

export interface RequestInterventionInput {
  interventionType: InterventionType;
  reasonNote: string;
}

export function requestIntervention(cycleId: string, input: RequestInterventionInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/specialist-review/cycles/${cycleId}/intervention`, {
    method: 'POST',
    auth: true,
    body: input,
  });
}

export interface CompleteInterventionInput {
  outcomeNotes: string;
}

export function completeIntervention(cycleId: string, input: CompleteInterventionInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/specialist-review/cycles/${cycleId}/intervention/complete`, {
    method: 'POST',
    auth: true,
    body: input,
  });
}
```

- [ ] **Step 5: Create `staff-web/src/api/progress.ts`**

```typescript
import { apiRequest } from './client';

export interface ProgressDashboard {
  currentLevelName: string | null;
  currentLevelOrder: number | null;
  levelsCompleted: number;
  totalTrainingEvents: number;
  repeatedLevelOrders: number[];
  daysInProgram: number;
}

export function getProgressDashboard(patientId: string): Promise<ProgressDashboard> {
  return apiRequest<ProgressDashboard>(`/api/v1/patients/${patientId}/progress`, { auth: true });
}

export interface PassedLevelSummary {
  levelId: string;
  levelName: string;
  order: number;
  levelVersionId: string;
  passedAt: string | null;
}

export function getPassedLevels(patientId: string): Promise<PassedLevelSummary[]> {
  return apiRequest<PassedLevelSummary[]>(`/api/v1/patients/${patientId}/levels/passed`, { auth: true });
}
```

- [ ] **Step 6: Create `staff-web/src/api/sample-media.ts`**

```typescript
import { getToken } from '../storage/session';
import { ApiError } from './client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export async function fetchSampleMediaBlob(patientId: string, partId: string): Promise<string> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}/api/v1/patients/${patientId}/sample-parts/${partId}/media`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'MEDIA_FETCH_FAILED', 'تعذر تحميل التسجيل');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
```

- [ ] **Step 7: Add the permission helper**

In `staff-web/src/auth/permissions.ts`, the file currently reads:

```typescript
import type { StaffRole } from '../api/auth';

export function canEditClinicalData(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'ADMIN';
}
```

Add `canReviewSample` (identical rule today, but expressed as its own named capability since it's a genuinely separate backend permission (`REVIEW_SAMPLE`) that happens to share the same role set as `canEditClinicalData`'s `EDIT_PATIENT_PROFILE`-adjacent checks — don't conflate the two just because they currently agree):

```typescript
import type { StaffRole } from '../api/auth';

export function canEditClinicalData(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'ADMIN';
}

export function canReviewSample(role: StaffRole): boolean {
  return role === 'CLINICIAN' || role === 'ADMIN';
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- cycles.test specialist-review.test progress.test` (from `staff-web/`)
Expected: all 8 tests PASS (1 + 5 + 2).

- [ ] **Step 9: Run the full test suite and the build to check for regressions**

Run: `npm test && npm run build` (from `staff-web/`)
Expected: everything PASSES — 55 tests (47 + 8 new), 20 test files (17 + 3 new); `tsc -b` reports no errors.

- [ ] **Step 10: Commit**

```bash
git add staff-web/src/api/cycles.ts staff-web/src/api/specialist-review.ts staff-web/src/api/progress.ts staff-web/src/api/sample-media.ts staff-web/src/auth/permissions.ts staff-web/src/api/cycles.test.ts staff-web/src/api/specialist-review.test.ts staff-web/src/api/progress.test.ts
git commit -m "feat: add API modules and permission helper for sample review and progress"
```

---

### Task 2: Review Queue page

**Files:**
- Create: `staff-web/src/pages/ReviewQueuePage.tsx`
- Test: `staff-web/src/pages/ReviewQueuePage.test.tsx`
- Modify: `staff-web/src/App.tsx`
- Modify: `staff-web/src/components/AppShell.tsx`
- Modify: `staff-web/src/copy/ar.ts`

**Interfaces:**
- Consumes: `listAvailableSamples`, `reserveSample`, `AvailableSampleRow` (Task 1), `canReviewSample` (Task 1).

- [ ] **Step 1: Add copy**

In `staff-web/src/copy/ar.ts`, add a `reviewQueue` block right after `patients` (before `patientDetail`), and add the nav-link string to `shell`:

```typescript
  shell: {
    patientsLink: 'المرضى',
    reviewQueueLink: 'قائمة المراجعة',
    logoutButton: 'تسجيل الخروج',
    roles: {
      CLINICIAN: 'أخصائي',
      SUPERVISOR: 'مشرف',
      ADMIN: 'مدير النظام',
    },
  },
```

```typescript
  reviewQueue: {
    title: 'قائمة المراجعة',
    emptyState: 'لا توجد عينات بانتظار المراجعة',
    patientNameLabel: 'المريض',
    submittedAtLabel: 'تاريخ الإرسال',
    escalatedLabel: 'مصعّدة',
    reserveButton: 'حجز للمراجعة',
  },
```

- [ ] **Step 2: Write the failing tests**

Create `staff-web/src/pages/ReviewQueuePage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { ReviewQueuePage } from './ReviewQueuePage';
import { AuthProvider } from '../auth/AuthProvider';
import { listAvailableSamples, reserveSample } from '../api/specialist-review';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/specialist-review');
vi.mock('../api/auth');
vi.mock('../storage/session');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const queueRow = {
  id: 'cycle-1',
  patientProfileId: 'patient-1',
  levelId: 'level-1',
  status: 'WAITING_FOR_SPECIALIST',
  speechSample: { id: 'sample-1', submittedAt: '2026-07-14T00:00:00.000Z', escalatedAt: null },
  patientProfile: { id: 'patient-1', fullName: 'مريض تجريبي' },
};

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });

  return render(
    <MantineProvider>
      <MemoryRouter>
        <AuthProvider>
          <ReviewQueuePage />
        </AuthProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReviewQueuePage', () => {
  it('shows the empty state when there are no available samples', async () => {
    (listAvailableSamples as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('لا توجد عينات بانتظار المراجعة')).toBeTruthy();
    });
  });

  it('lists an available sample with the patient name', async () => {
    (listAvailableSamples as ReturnType<typeof vi.fn>).mockResolvedValue([queueRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('مريض تجريبي')).toBeTruthy();
    });
  });

  it('reserves a sample and navigates to the patient detail page', async () => {
    (listAvailableSamples as ReturnType<typeof vi.fn>).mockResolvedValue([queueRow]);
    (reserveSample as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1' });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('queue-row-cycle-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('reserve-button-cycle-1'));

    await waitFor(() => {
      expect(reserveSample).toHaveBeenCalledWith('cycle-1');
      expect(mockNavigate).toHaveBeenCalledWith('/patients/patient-1');
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- ReviewQueuePage.test` (from `staff-web/`)
Expected: FAIL — `staff-web/src/pages/ReviewQueuePage.tsx` doesn't exist yet.

- [ ] **Step 4: Create the page**

Create `staff-web/src/pages/ReviewQueuePage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Title, Table, Button, Text, Badge, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { listAvailableSamples, reserveSample } from '../api/specialist-review';
import type { AvailableSampleRow } from '../api/specialist-review';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function ReviewQueuePage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AvailableSampleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reservingId, setReservingId] = useState<string | null>(null);

  useEffect(() => {
    listAvailableSamples()
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
  }, []);

  async function handleReserve(row: AvailableSampleRow) {
    setReservingId(row.id);
    setError(null);
    try {
      await reserveSample(row.id);
      navigate(`/patients/${row.patientProfileId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setReservingId(null);
    }
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.reviewQueue.title}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}
      {rows === null ? null : rows.length === 0 ? (
        <Text c="dimmed">{ar.reviewQueue.emptyState}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.reviewQueue.patientNameLabel}</Table.Th>
              <Table.Th>{ar.reviewQueue.submittedAtLabel}</Table.Th>
              <Table.Th />
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.id} data-testid={`queue-row-${row.id}`}>
                <Table.Td>{row.patientProfile.fullName}</Table.Td>
                <Table.Td>{row.speechSample?.submittedAt ? formatDate(row.speechSample.submittedAt) : '—'}</Table.Td>
                <Table.Td>
                  {row.speechSample?.escalatedAt ? <Badge color="red">{ar.reviewQueue.escalatedLabel}</Badge> : null}
                </Table.Td>
                <Table.Td>
                  <Button
                    data-testid={`reserve-button-${row.id}`}
                    loading={reservingId === row.id}
                    onClick={() => handleReserve(row)}
                  >
                    {ar.reviewQueue.reserveButton}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
```

- [ ] **Step 5: Wire the route into `App.tsx`**

In `staff-web/src/App.tsx`, the file currently reads:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDetailPage } from './pages/PatientDetailPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
          <Route
            path="/patients"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientsPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/patients/:id"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientDetailPage />
                </AppShell>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

Replace with (adding the import and the new route, right after `/patients`):

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
          <Route
            path="/patients"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientsPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/patients/:id"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientDetailPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/review-queue"
            element={
              <RequireAuth>
                <AppShell>
                  <ReviewQueuePage />
                </AppShell>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 6: Add the nav link, gated on role**

In `staff-web/src/components/AppShell.tsx`, the file currently reads:

```typescript
import type { ReactNode } from 'react';
import { AppShell as MantineAppShell, Group, Text, Button, NavLink } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <MantineAppShell header={{ height: 60 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={600}>كلامي</Text>
          <Group>
            {user ? (
              <Group gap={4}>
                <Text size="sm">{user.fullName}</Text>
                <Text size="sm">—</Text>
                <Text size="sm">{ar.shell.roles[user.role]}</Text>
              </Group>
            ) : null}
            <Button variant="subtle" onClick={handleLogout}>{ar.shell.logoutButton}</Button>
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="md">
        <NavLink component={Link} to="/patients" label={ar.shell.patientsLink} />
      </MantineAppShell.Navbar>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  );
}
```

Replace with (adding the `canReviewSample` import and a conditionally-rendered nav link):

```typescript
import type { ReactNode } from 'react';
import { AppShell as MantineAppShell, Group, Text, Button, NavLink } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canReviewSample } from '../auth/permissions';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <MantineAppShell header={{ height: 60 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={600}>كلامي</Text>
          <Group>
            {user ? (
              <Group gap={4}>
                <Text size="sm">{user.fullName}</Text>
                <Text size="sm">—</Text>
                <Text size="sm">{ar.shell.roles[user.role]}</Text>
              </Group>
            ) : null}
            <Button variant="subtle" onClick={handleLogout}>{ar.shell.logoutButton}</Button>
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="md">
        <NavLink component={Link} to="/patients" label={ar.shell.patientsLink} />
        {user && canReviewSample(user.role) ? (
          <NavLink component={Link} to="/review-queue" label={ar.shell.reviewQueueLink} />
        ) : null}
      </MantineAppShell.Navbar>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- ReviewQueuePage.test` (from `staff-web/`)
Expected: all 3 tests PASS.

- [ ] **Step 8: Run the full suite and the build**

Run: `npm test && npm run build` (from `staff-web/`)
Expected: everything PASSES — 58 tests (55 + 3 new), 21 test files; clean `tsc -b`.

- [ ] **Step 9: Commit**

```bash
git add staff-web/src/pages/ReviewQueuePage.tsx staff-web/src/pages/ReviewQueuePage.test.tsx staff-web/src/App.tsx staff-web/src/components/AppShell.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add the review queue page"
```

---

### Task 3: `SampleReviewSection` — view and decision form

**Files:**
- Create: `staff-web/src/patients/SampleReviewSection.tsx`
- Test: `staff-web/src/patients/SampleReviewSection.test.tsx`
- Modify: `staff-web/src/copy/ar.ts`

**Interfaces:**
- Consumes: `getCurrentCycle`, `TrainingCycle`, `SpeechSample`, `SampleSamplePart` (Task 1), `reviewSample`, `ReviewSampleInput` (Task 1), `fetchSampleMediaBlob` (Task 1), `canReviewSample` (Task 1), `usePatientDetail` (existing), `useAuth` (existing).
- Produces: nothing consumed by a later task in this plan (Task 4 extends this same file directly, not a separate consumer).

- [ ] **Step 1: Add copy**

In `staff-web/src/copy/ar.ts`, add a `sampleReview` block right after `patientDetail`, before `errors`:

```typescript
  sampleReview: {
    title: 'مراجعة العينة',
    reservedByOtherLabel: 'محجوزة لأخصائي آخر',
    selfReportTitle: 'التقييم الذاتي للمستفيد',
    selfSeverityCurrentLabel: 'شدة التلعثم الحالية',
    selfSeverityExpectedNextLabel: 'الشدة المتوقعة للمستوى التالي',
    camperdownPerformanceLabel: 'تقييم الأداء (Camperdown)',
    clientOpinionLabel: 'رأي المستفيد في أدائه',
    partsTitle: 'أجزاء العينة',
    playButton: 'تشغيل',
    loadingMedia: 'جارٍ تحميل التسجيل...',
    mediaError: 'تعذر تحميل التسجيل',
    decisionTitle: 'قرار المراجعة',
    decisionLabel: 'القرار',
    decisions: {
      TRANSITION: 'الانتقال إلى المستوى التالي',
      LEVEL_REPEAT: 'إعادة المستوى الحالي',
      TECHNICAL_RERECORD: 'طلب إعادة تسجيل أجزاء تقنيًا',
    } as Record<string, string>,
    clinicianOpinionScoreLabel: 'تقييم الأخصائي (1-9)',
    reviewNotesLabel: 'ملاحظات المراجعة',
    damagedPartsLabel: 'الأجزاء التي تحتاج إعادة تسجيل',
    submitDecisionButton: 'إرسال القرار',
  },
```

- [ ] **Step 2: Write the failing tests**

Create `staff-web/src/patients/SampleReviewSection.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SampleReviewSection } from './SampleReviewSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getCurrentCycle } from '../api/cycles';
import { reviewSample } from '../api/specialist-review';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/cycles');
vi.mock('../api/specialist-review');
vi.mock('../api/auth');
vi.mock('../storage/session');

const baseCycle = {
  id: 'cycle-1',
  patientProfileId: 'patient-1',
  treatmentPlanId: 'plan-1',
  levelId: 'level-1',
  levelVersionId: 'version-1',
  cycleNumber: 1,
  status: 'UNDER_REVIEW',
  humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
  firstTrainingEventAt: '2026-07-01T00:00:00.000Z',
  closedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  speechSample: {
    id: 'sample-1',
    trainingCycleId: 'cycle-1',
    selfSeverityCurrent: 5,
    selfSeverityExpectedNext: 3,
    camperdownPerformanceRating: 6,
    clientOpinionScore: 7,
    submittedAt: '2026-07-14T00:00:00.000Z',
    reviewedByUserId: null,
    clinicianOpinionScore: null,
    reviewNotes: null,
    reviewedAt: null,
    decision: null,
    reservedByUserId: 'staff-1',
    reservedAt: '2026-07-14T01:00:00.000Z',
    reviewDeadlineAt: '2026-07-16T01:00:00.000Z',
    interventionType: null,
    interventionRequestedAt: null,
    interventionDeadlineAt: null,
    interventionCompletedAt: null,
    interventionOutcomeNotes: null,
    parts: [
      { id: 'part-1', partType: 'READING', label: 'قراءة نص', order: 1, recordingUrl: 'x', mimeType: 'video/mp4', fileSizeBytes: 1000, durationSeconds: 30, technicallyDamaged: false },
    ],
  },
};

function renderSection(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <SampleReviewSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SampleReviewSection', () => {
  it('renders nothing for a SUPERVISOR', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    const { container } = renderSection('SUPERVISOR');
    await waitFor(() => {
      expect(container.textContent).not.toContain('مراجعة العينة');
    });
  });

  it('renders nothing when the cycle is not in a review-relevant status', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle, status: 'ACTIVE_LEVEL_TRAINING', speechSample: null });
    const { container } = renderSection();
    await waitFor(() => {
      expect(container.textContent).not.toContain('مراجعة العينة');
    });
  });

  it('shows the self-report fields for a reviewable sample', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('مراجعة العينة')).toBeTruthy();
      expect(screen.getByText(/5/)).toBeTruthy();
    });
  });

  it('hides the decision form when the sample is reserved by a different specialist', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseCycle,
      speechSample: { ...baseCycle.speechSample, reservedByUserId: 'someone-else' },
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('محجوزة لأخصائي آخر')).toBeTruthy();
    });
    expect(screen.queryByText('إرسال القرار')).toBeNull();
  });

  it('submits a TRANSITION decision with the entered score', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (reviewSample as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle.speechSample, decision: 'TRANSITION' });
    renderSection();

    await waitFor(() => expect(screen.getByLabelText('تقييم الأخصائي (1-9)')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('تقييم الأخصائي (1-9)'), { target: { value: '8' } });
    fireEvent.click(screen.getByText('إرسال القرار'));

    await waitFor(() => {
      expect(reviewSample).toHaveBeenCalledWith('patient-1', { decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: '' });
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- SampleReviewSection.test` (from `staff-web/`)
Expected: FAIL — `staff-web/src/patients/SampleReviewSection.tsx` doesn't exist yet.

- [ ] **Step 4: Create the section**

Create `staff-web/src/patients/SampleReviewSection.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Card, Title, Text, Stack, Group, Select, NumberInput, Textarea, Button, Alert, MultiSelect } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canReviewSample } from '../auth/permissions';
import { getCurrentCycle } from '../api/cycles';
import type { TrainingCycle, SpecialistDecision } from '../api/cycles';
import { reviewSample } from '../api/specialist-review';
import { ApiError } from '../api/client';

const REVIEW_RELEVANT_STATUSES = new Set([
  'WAITING_FOR_SPECIALIST',
  'UNDER_REVIEW',
  'DIRECT_INTERVENTION_REQUIRED',
  'WAITING_FINAL_DECISION_AFTER_INTERVENTION',
  'TECHNICAL_PARTIAL_RERECORD',
]);

// Mirrors the backend's own `reviewableStatuses` guard in `review()`
// (`specialist-review.service.ts`) exactly: a decision can only ever be
// submitted from these two statuses. `DIRECT_INTERVENTION_REQUIRED` and
// `TECHNICAL_PARTIAL_RERECORD` are in REVIEW_RELEVANT_STATUSES above (so the
// section still shows the read-only sample detail) but NOT here, so the
// decision form itself doesn't render for them — submitting from either
// would 409 on the backend.
const DECISION_SUBMITTABLE_STATUSES = new Set(['UNDER_REVIEW', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION']);

export function SampleReviewSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();

  const [cycle, setCycle] = useState<TrainingCycle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [decision, setDecision] = useState<SpecialistDecision>('TRANSITION');
  const [clinicianOpinionScore, setClinicianOpinionScore] = useState<number | ''>('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [damagedPartIds, setDamagedPartIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient) return;
    getCurrentCycle(patient.id)
      .then(setCycle)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  if (!patient || !user || !canReviewSample(user.role)) {
    return null;
  }
  if (!cycle || !REVIEW_RELEVANT_STATUSES.has(cycle.status) || !cycle.speechSample) {
    return null;
  }

  const sample = cycle.speechSample;
  const isReservationHolder = sample.reservedByUserId === user.id;

  async function handleSubmitDecision() {
    if (!patient) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (decision === 'TECHNICAL_RERECORD') {
        await reviewSample(patient.id, { decision: 'TECHNICAL_RERECORD', damagedPartIds, reviewNotes: reviewNotes || undefined });
      } else {
        await reviewSample(patient.id, {
          decision,
          clinicianOpinionScore: clinicianOpinionScore === '' ? 0 : clinicianOpinionScore,
          reviewNotes,
        });
      }
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.sampleReview.title}</Title>
      {loadError ? <Alert color="red" mb="sm">{loadError}</Alert> : null}

      <Stack gap="xs" mb="md">
        <Text fw={600}>{ar.sampleReview.selfReportTitle}</Text>
        <Text>{ar.sampleReview.selfSeverityCurrentLabel}: {sample.selfSeverityCurrent ?? '—'}</Text>
        <Text>{ar.sampleReview.selfSeverityExpectedNextLabel}: {sample.selfSeverityExpectedNext ?? '—'}</Text>
        <Text>{ar.sampleReview.camperdownPerformanceLabel}: {sample.camperdownPerformanceRating ?? '—'}</Text>
        <Text>{ar.sampleReview.clientOpinionLabel}: {sample.clientOpinionScore ?? '—'}</Text>
      </Stack>

      {!isReservationHolder ? (
        <Alert color="yellow">{ar.sampleReview.reservedByOtherLabel}</Alert>
      ) : (
        <Stack gap="md">
          {submitError ? <Alert color="red">{submitError}</Alert> : null}
          {DECISION_SUBMITTABLE_STATUSES.has(cycle.status) ? (
            <>
              <Text fw={600}>{ar.sampleReview.decisionTitle}</Text>
              <Select
                label={ar.sampleReview.decisionLabel}
                data={[
                  { value: 'TRANSITION', label: ar.sampleReview.decisions.TRANSITION },
                  { value: 'LEVEL_REPEAT', label: ar.sampleReview.decisions.LEVEL_REPEAT },
                  { value: 'TECHNICAL_RERECORD', label: ar.sampleReview.decisions.TECHNICAL_RERECORD },
                ]}
                value={decision}
                onChange={(value) => setDecision((value as SpecialistDecision) ?? 'TRANSITION')}
              />
              {decision === 'TECHNICAL_RERECORD' ? (
                <MultiSelect
                  label={ar.sampleReview.damagedPartsLabel}
                  data={sample.parts.map((part) => ({ value: part.id, label: part.label }))}
                  value={damagedPartIds}
                  onChange={setDamagedPartIds}
                />
              ) : (
                <NumberInput
                  label={ar.sampleReview.clinicianOpinionScoreLabel}
                  value={clinicianOpinionScore}
                  onChange={(v) => setClinicianOpinionScore(typeof v === 'number' ? v : '')}
                  min={1}
                  max={9}
                />
              )}
              <Textarea
                label={ar.sampleReview.reviewNotesLabel}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.currentTarget.value)}
              />
              <Group>
                <Button onClick={handleSubmitDecision} loading={submitting}>{ar.sampleReview.submitDecisionButton}</Button>
              </Group>
            </>
          ) : null}
        </Stack>
      )}
    </Card>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- SampleReviewSection.test` (from `staff-web/`)
Expected: all 5 tests PASS. (`baseCycle`'s status is `UNDER_REVIEW`, inside `DECISION_SUBMITTABLE_STATUSES`, so none of Task 3's existing tests change behavior — this gate only affects `DIRECT_INTERVENTION_REQUIRED`/`TECHNICAL_PARTIAL_RERECORD`, neither of which any Task 3 test uses.)

- [ ] **Step 6: Run the full suite and the build**

Run: `npm test && npm run build` (from `staff-web/`)
Expected: everything PASSES — 63 tests (58 + 5 new), 22 test files; clean `tsc -b`.

- [ ] **Step 7: Commit**

```bash
git add staff-web/src/patients/SampleReviewSection.tsx staff-web/src/patients/SampleReviewSection.test.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add SampleReviewSection with self-report view and decision form"
```

---

### Task 4: Media playback and intervention controls

**Files:**
- Modify: `staff-web/src/patients/SampleReviewSection.tsx`
- Modify: `staff-web/src/patients/SampleReviewSection.test.tsx`
- Modify: `staff-web/src/copy/ar.ts`

**Interfaces:**
- Consumes: `fetchSampleMediaBlob` (Task 1), `requestIntervention`, `completeIntervention`, `RequestInterventionInput`, `CompleteInterventionInput` (Task 1).

- [ ] **Step 1: Add copy**

In `staff-web/src/copy/ar.ts`, extend the `sampleReview` block added in Task 3 (insert these keys anywhere inside that object, e.g. right after `mediaError`):

```typescript
    interventionTitle: 'التدخل المباشر',
    interventionTypeLabel: 'نوع التدخل',
    interventionTypes: {
      VIDEO_MEETING: 'لقاء مرئي',
      VOICE_CONSULTATION: 'استشارة صوتية',
      TARGETED_MESSAGE: 'رسالة موجهة',
      CLINICAL_ACTION: 'إجراء سريري',
    } as Record<string, string>,
    interventionReasonLabel: 'سبب التدخل',
    requestInterventionButton: 'طلب تدخل مباشر',
    interventionOutcomeLabel: 'نتيجة التدخل',
    completeInterventionButton: 'إنهاء التدخل',
```

- [ ] **Step 2: Write the failing tests**

Add these tests to `staff-web/src/patients/SampleReviewSection.test.tsx`, inside the existing `describe('SampleReviewSection', ...)` block, after the last existing `it(...)`. They reuse the file's existing `baseCycle` fixture and `renderSection` helper — do not redefine them. Add these imports to the top of the file alongside the existing ones:

```typescript
import { fetchSampleMediaBlob } from '../api/sample-media';
import { requestIntervention, completeIntervention } from '../api/specialist-review';
```

and add `vi.mock('../api/sample-media');` alongside the file's existing `vi.mock(...)` calls.

New tests:

```typescript
  it('plays a sample part by fetching an authenticated blob URL', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (fetchSampleMediaBlob as ReturnType<typeof vi.fn>).mockResolvedValue('blob:mock-url');
    renderSection();

    await waitFor(() => expect(screen.getByText('قراءة نص')).toBeTruthy());
    fireEvent.click(screen.getAllByText('تشغيل')[0]);

    await waitFor(() => {
      expect(fetchSampleMediaBlob).toHaveBeenCalledWith('patient-1', 'part-1');
    });
  });

  it('requests an intervention with the entered type and reason', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (requestIntervention as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle.speechSample, interventionType: 'VIDEO_MEETING' });
    renderSection();

    await waitFor(() => expect(screen.getByText('طلب تدخل مباشر')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('سبب التدخل'), { target: { value: 'يحتاج ملاحظة مباشرة' } });
    fireEvent.click(screen.getByText('طلب تدخل مباشر'));

    await waitFor(() => {
      expect(requestIntervention).toHaveBeenCalledWith('cycle-1', { interventionType: 'VIDEO_MEETING', reasonNote: 'يحتاج ملاحظة مباشرة' });
    });
  });

  it('completes an intervention with the entered outcome notes', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseCycle,
      status: 'DIRECT_INTERVENTION_REQUIRED',
      speechSample: {
        ...baseCycle.speechSample,
        interventionType: 'VIDEO_MEETING',
        interventionRequestedAt: '2026-07-14T02:00:00.000Z',
        interventionDeadlineAt: '2026-07-21T02:00:00.000Z',
      },
    });
    (completeIntervention as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle.speechSample, interventionCompletedAt: '2026-07-14T03:00:00.000Z' });
    renderSection();

    await waitFor(() => expect(screen.getByLabelText('نتيجة التدخل')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('نتيجة التدخل'), { target: { value: 'تحسّن ملحوظ' } });
    fireEvent.click(screen.getByText('إنهاء التدخل'));

    await waitFor(() => {
      expect(completeIntervention).toHaveBeenCalledWith('cycle-1', { outcomeNotes: 'تحسّن ملحوظ' });
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- SampleReviewSection.test` (from `staff-web/`)
Expected: FAIL — the "play" button, intervention-request form, and intervention-complete form don't exist in the component yet.

- [ ] **Step 4: Extend the component**

In `staff-web/src/patients/SampleReviewSection.tsx`, add the two new imports at the top, alongside the existing ones:

```typescript
import { fetchSampleMediaBlob } from '../api/sample-media';
import { requestIntervention, completeIntervention } from '../api/specialist-review';
import type { InterventionType } from '../api/cycles';
```

Add new state, right after the existing `submitError` state declaration:

```typescript
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [loadingPartId, setLoadingPartId] = useState<string | null>(null);

  const [interventionType, setInterventionType] = useState<InterventionType>('VIDEO_MEETING');
  const [reasonNote, setReasonNote] = useState('');
  const [requestingIntervention, setRequestingIntervention] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [completingIntervention, setCompletingIntervention] = useState(false);
  const [interventionError, setInterventionError] = useState<string | null>(null);
```

Add new handlers, right after `handleSubmitDecision`:

```typescript
  async function handlePlayPart(partId: string) {
    if (!patient) return;
    setLoadingPartId(partId);
    setMediaError(null);
    try {
      const url = await fetchSampleMediaBlob(patient.id, partId);
      setMediaUrls((prev) => ({ ...prev, [partId]: url }));
    } catch (err) {
      setMediaError(err instanceof ApiError ? err.message : ar.sampleReview.mediaError);
    } finally {
      setLoadingPartId(null);
    }
  }

  async function handleRequestIntervention() {
    setRequestingIntervention(true);
    setInterventionError(null);
    try {
      await requestIntervention(cycle.id, { interventionType, reasonNote });
    } catch (err) {
      setInterventionError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setRequestingIntervention(false);
    }
  }

  async function handleCompleteIntervention() {
    setCompletingIntervention(true);
    setInterventionError(null);
    try {
      await completeIntervention(cycle.id, { outcomeNotes });
    } catch (err) {
      setInterventionError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setCompletingIntervention(false);
    }
  }
```

Add a parts list with playback, right after the self-report `<Stack>` and before the `{!isReservationHolder ? ... }` block:

```typescript
      <Stack gap="xs" mb="md">
        <Text fw={600}>{ar.sampleReview.partsTitle}</Text>
        {mediaError ? <Alert color="red">{mediaError}</Alert> : null}
        {sample.parts.map((part) => (
          <Group key={part.id}>
            <Text>{part.label}</Text>
            {mediaUrls[part.id] ? (
              part.mimeType?.startsWith('audio/') ? (
                <audio controls src={mediaUrls[part.id]} />
              ) : (
                <video controls width={240} src={mediaUrls[part.id]} />
              )
            ) : (
              <Button
                variant="light"
                size="xs"
                loading={loadingPartId === part.id}
                onClick={() => handlePlayPart(part.id)}
              >
                {ar.sampleReview.playButton}
              </Button>
            )}
          </Group>
        ))}
      </Stack>
```

Add intervention controls inside the `isReservationHolder` branch, as siblings of the `{DECISION_SUBMITTABLE_STATUSES.has(cycle.status) ? (...) : null}` block Task 3 added — insert them right after that block's closing `) : null}` and before the outer `</Stack>` that block sits inside:

```typescript
          {interventionError ? <Alert color="red">{interventionError}</Alert> : null}
          {cycle.status === 'UNDER_REVIEW' ? (
            <Stack gap="xs">
              <Text fw={600}>{ar.sampleReview.interventionTitle}</Text>
              <Select
                label={ar.sampleReview.interventionTypeLabel}
                data={[
                  { value: 'VIDEO_MEETING', label: ar.sampleReview.interventionTypes.VIDEO_MEETING },
                  { value: 'VOICE_CONSULTATION', label: ar.sampleReview.interventionTypes.VOICE_CONSULTATION },
                  { value: 'TARGETED_MESSAGE', label: ar.sampleReview.interventionTypes.TARGETED_MESSAGE },
                  { value: 'CLINICAL_ACTION', label: ar.sampleReview.interventionTypes.CLINICAL_ACTION },
                ]}
                value={interventionType}
                onChange={(value) => setInterventionType((value as InterventionType) ?? 'VIDEO_MEETING')}
              />
              <Textarea
                label={ar.sampleReview.interventionReasonLabel}
                value={reasonNote}
                onChange={(e) => setReasonNote(e.currentTarget.value)}
              />
              <Group>
                <Button variant="light" onClick={handleRequestIntervention} loading={requestingIntervention}>
                  {ar.sampleReview.requestInterventionButton}
                </Button>
              </Group>
            </Stack>
          ) : null}
          {cycle.status === 'DIRECT_INTERVENTION_REQUIRED' ? (
            <Stack gap="xs">
              <Textarea
                label={ar.sampleReview.interventionOutcomeLabel}
                value={outcomeNotes}
                onChange={(e) => setOutcomeNotes(e.currentTarget.value)}
              />
              <Group>
                <Button variant="light" onClick={handleCompleteIntervention} loading={completingIntervention}>
                  {ar.sampleReview.completeInterventionButton}
                </Button>
              </Group>
            </Stack>
          ) : null}
```

Note: Task 3 already gates the decision form itself on `DECISION_SUBMITTABLE_STATUSES` (`UNDER_REVIEW` / `WAITING_FINAL_DECISION_AFTER_INTERVENTION` only), so it correctly disappears during `DIRECT_INTERVENTION_REQUIRED` — this task's two new intervention blocks (gated on `UNDER_REVIEW` and `DIRECT_INTERVENTION_REQUIRED` respectively) are mutually exclusive with each other and complementary to that existing gate: at any given status, at most one of {decision form, request-intervention block, complete-intervention block} is visible, matching exactly which action is actually valid for that status on the backend.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- SampleReviewSection.test` (from `staff-web/`)
Expected: all 8 tests PASS (5 from Task 3 + 3 new).

- [ ] **Step 6: Run the full suite and the build**

Run: `npm test && npm run build` (from `staff-web/`)
Expected: everything PASSES — 66 tests (63 + 3 new), 22 test files (unchanged count — same file extended); clean `tsc -b`.

- [ ] **Step 7: Commit**

```bash
git add staff-web/src/patients/SampleReviewSection.tsx staff-web/src/patients/SampleReviewSection.test.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add sample media playback and intervention controls to SampleReviewSection"
```

---

### Task 5: `ProgressSection` — dashboard and passed levels

**Files:**
- Create: `staff-web/src/patients/ProgressSection.tsx`
- Test: `staff-web/src/patients/ProgressSection.test.tsx`
- Modify: `staff-web/src/copy/ar.ts`

**Interfaces:**
- Consumes: `getProgressDashboard`, `ProgressDashboard`, `getPassedLevels`, `PassedLevelSummary` (Task 1).

- [ ] **Step 1: Add copy**

In `staff-web/src/copy/ar.ts`, add a `progress` block right after `sampleReview`, before `errors`:

```typescript
  progress: {
    title: 'التقدم',
    currentLevelLabel: 'المستوى الحالي',
    levelsCompletedLabel: 'المستويات المكتملة',
    totalTrainingEventsLabel: 'إجمالي التدريبات',
    daysInProgramLabel: 'عدد أيام البرنامج',
    repeatedLevelsLabel: 'المستويات المعادة',
    noRepeatedLevels: 'لا يوجد',
    passedLevelsTitle: 'المستويات المجتازة',
    noPassedLevels: 'لم يُجتز أي مستوى بعد',
    levelNameLabel: 'المستوى',
    levelOrderLabel: 'الترتيب',
    passedAtLabel: 'تاريخ الاجتياز',
    notPassedYet: '—',
  },
```

- [ ] **Step 2: Write the failing tests**

Create `staff-web/src/patients/ProgressSection.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ProgressSection } from './ProgressSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getProgressDashboard, getPassedLevels } from '../api/progress';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/progress');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderSection() {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role: 'SUPERVISOR',
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <ProgressSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProgressSection', () => {
  it('shows the dashboard stats', async () => {
    (getProgressDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: 'المستوى الثاني',
      currentLevelOrder: 2,
      levelsCompleted: 1,
      totalTrainingEvents: 12,
      repeatedLevelOrders: [],
      daysInProgram: 30,
    });
    (getPassedLevels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('المستوى الثاني')).toBeTruthy();
      expect(screen.getByText(/30/)).toBeTruthy();
    });
  });

  it('is visible to a SUPERVISOR (no role gating)', async () => {
    (getProgressDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: null,
      currentLevelOrder: null,
      levelsCompleted: 0,
      totalTrainingEvents: 0,
      repeatedLevelOrders: [],
      daysInProgram: 0,
    });
    (getPassedLevels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('التقدم')).toBeTruthy();
    });
  });

  it('shows the empty state when no levels have been passed', async () => {
    (getProgressDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: 'Level 1', currentLevelOrder: 1, levelsCompleted: 0, totalTrainingEvents: 0, repeatedLevelOrders: [], daysInProgram: 1,
    });
    (getPassedLevels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('لم يُجتز أي مستوى بعد')).toBeTruthy();
    });
  });

  it('lists passed levels with their passed-at date', async () => {
    (getProgressDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: 'Level 2', currentLevelOrder: 2, levelsCompleted: 1, totalTrainingEvents: 12, repeatedLevelOrders: [], daysInProgram: 30,
    });
    (getPassedLevels as ReturnType<typeof vi.fn>).mockResolvedValue([
      { levelId: 'level-1', levelName: 'المستوى الأول', order: 1, levelVersionId: 'version-1', passedAt: '2026-07-10T00:00:00.000Z' },
    ]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('المستوى الأول')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- ProgressSection.test` (from `staff-web/`)
Expected: FAIL — `staff-web/src/patients/ProgressSection.tsx` doesn't exist yet.

- [ ] **Step 4: Create the section**

Create `staff-web/src/patients/ProgressSection.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Card, Title, Text, Stack, Table, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { getProgressDashboard, getPassedLevels } from '../api/progress';
import type { ProgressDashboard, PassedLevelSummary } from '../api/progress';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function ProgressSection() {
  const { patient } = usePatientDetail();

  const [dashboard, setDashboard] = useState<ProgressDashboard | null>(null);
  const [passedLevels, setPassedLevels] = useState<PassedLevelSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient) return;
    setError(null);
    Promise.all([getProgressDashboard(patient.id), getPassedLevels(patient.id)])
      .then(([dashboardResult, passedResult]) => {
        setDashboard(dashboardResult);
        setPassedLevels(passedResult);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  if (!patient) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.progress.title}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {dashboard ? (
        <Stack gap="xs" mb="md">
          <Text>{ar.progress.currentLevelLabel}: {dashboard.currentLevelName ?? '—'}</Text>
          <Text>{ar.progress.levelsCompletedLabel}: {dashboard.levelsCompleted}</Text>
          <Text>{ar.progress.totalTrainingEventsLabel}: {dashboard.totalTrainingEvents}</Text>
          <Text>{ar.progress.daysInProgramLabel}: {dashboard.daysInProgram}</Text>
          <Text>
            {ar.progress.repeatedLevelsLabel}: {dashboard.repeatedLevelOrders.length > 0 ? dashboard.repeatedLevelOrders.join('، ') : ar.progress.noRepeatedLevels}
          </Text>
        </Stack>
      ) : null}

      <Text fw={600} mb="xs">{ar.progress.passedLevelsTitle}</Text>
      {passedLevels === null ? null : passedLevels.length === 0 ? (
        <Text c="dimmed">{ar.progress.noPassedLevels}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.progress.levelNameLabel}</Table.Th>
              <Table.Th>{ar.progress.levelOrderLabel}</Table.Th>
              <Table.Th>{ar.progress.passedAtLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {passedLevels.map((level) => (
              <Table.Tr key={level.levelId}>
                <Table.Td>{level.levelName}</Table.Td>
                <Table.Td>{level.order}</Table.Td>
                <Table.Td>{level.passedAt ? formatDate(level.passedAt) : ar.progress.notPassedYet}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- ProgressSection.test` (from `staff-web/`)
Expected: all 4 tests PASS.

- [ ] **Step 6: Run the full suite and the build**

Run: `npm test && npm run build` (from `staff-web/`)
Expected: everything PASSES — 70 tests (66 + 4 new), 23 test files; clean `tsc -b`.

- [ ] **Step 7: Commit**

```bash
git add staff-web/src/patients/ProgressSection.tsx staff-web/src/patients/ProgressSection.test.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add ProgressSection with dashboard stats and passed levels"
```

---

### Task 6: Wire sections into the Patient Detail Hub and verify visually

**Files:**
- Modify: `staff-web/src/pages/PatientDetailPage.tsx`

**Interfaces:**
- Consumes: `SampleReviewSection` (Task 3/4), `ProgressSection` (Task 5).

- [ ] **Step 1: Wire the two new sections into the page**

In `staff-web/src/pages/PatientDetailPage.tsx`, the file currently reads:

```typescript
import { useParams } from 'react-router-dom';
import { Container, Title, Badge, Group, Loader, Alert, Stack } from '@mantine/core';
import { ar } from '../copy/ar';
import { PatientDetailProvider, usePatientDetail } from '../patients/PatientDetailContext';
import { ProfileSection } from '../patients/ProfileSection';
import { AssessmentsSection } from '../patients/AssessmentsSection';
import { TreatmentPlanSection } from '../patients/TreatmentPlanSection';

function PatientDetailContent() {
  const { patient, loading, error } = usePatientDetail();

  if (loading) {
    return <Loader />;
  }
  if (error || !patient) {
    return <Alert color="red">{error ?? ar.patientDetail.loadError}</Alert>;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{patient.fullName}</Title>
        <Badge color={patient.status === 'ACTIVE' ? 'green' : 'gray'}>
          {ar.patients.statuses[patient.status]}
        </Badge>
      </Group>
      <ProfileSection />
      <AssessmentsSection />
      <TreatmentPlanSection />
    </Stack>
  );
}
```

Replace with (adding the two new imports and rendering them after `TreatmentPlanSection`):

```typescript
import { useParams } from 'react-router-dom';
import { Container, Title, Badge, Group, Loader, Alert, Stack } from '@mantine/core';
import { ar } from '../copy/ar';
import { PatientDetailProvider, usePatientDetail } from '../patients/PatientDetailContext';
import { ProfileSection } from '../patients/ProfileSection';
import { AssessmentsSection } from '../patients/AssessmentsSection';
import { TreatmentPlanSection } from '../patients/TreatmentPlanSection';
import { SampleReviewSection } from '../patients/SampleReviewSection';
import { ProgressSection } from '../patients/ProgressSection';

function PatientDetailContent() {
  const { patient, loading, error } = usePatientDetail();

  if (loading) {
    return <Loader />;
  }
  if (error || !patient) {
    return <Alert color="red">{error ?? ar.patientDetail.loadError}</Alert>;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{patient.fullName}</Title>
        <Badge color={patient.status === 'ACTIVE' ? 'green' : 'gray'}>
          {ar.patients.statuses[patient.status]}
        </Badge>
      </Group>
      <ProfileSection />
      <AssessmentsSection />
      <TreatmentPlanSection />
      <SampleReviewSection />
      <ProgressSection />
    </Stack>
  );
}
```

`PatientDetailPage` itself (the outer component wrapping `PatientDetailContent` in `<PatientDetailProvider>`) is unchanged.

- [ ] **Step 2: Run the full suite and the build**

Run: `npm test && npm run build` (from `staff-web/`)
Expected: everything PASSES — 70 tests, 23 test files (no new tests this task — pure wiring); clean `tsc -b`. No existing `PatientDetailPage`-adjacent test asserts on an exhaustive section count, so this addition cannot break an existing test (verify this assumption holds by checking any existing `PatientDetailPage.test.tsx` if one exists, before committing).

- [ ] **Step 3: Commit**

```bash
git add staff-web/src/pages/PatientDetailPage.tsx
git commit -m "feat: wire SampleReviewSection and ProgressSection into the Patient Detail Hub"
```

---

## Self-Review Notes

- **Spec coverage:** every in-scope item from the design (API modules, review queue page + nav gating, sample review view + decision form, intervention controls, media playback, progress dashboard + passed levels, permission helper) maps to exactly one task. The two explicit deferrals (transfer responsibility, historical level-content review) are documented with reasons in the design spec, not silently dropped.
- **No placeholders:** every step has complete, runnable code including all six new/extended test files and the exact before/after diffs for every modified file.
- **Type consistency:** `TrainingCycle`/`SpeechSample`/`SampleSamplePart`/`SpecialistDecision`/`InterventionType` (Task 1, `cycles.ts`) are imported with identical names and shapes into `specialist-review.ts` (Task 1), `SampleReviewSection.tsx` (Tasks 3-4), and their test files. `ReviewSampleInput`'s three-variant union matches the backend's `ReviewSampleSchema` discriminated union exactly (verified directly against `backend/src/modules/treatment-engine/dto/review-sample.dto.ts` while writing this plan, not from memory).
- **Cross-task ordering verified:** Task 4 extends Task 3's same file and test file rather than creating new ones — its brief explicitly quotes the exact insertion points in the Task-3-authored code so the diff is unambiguous. Task 6 depends on both Task 3/4's and Task 5's exports existing, and is ordered last.
- **Build-gate discipline carried through every task**: every task's verification step runs `npm run build` in addition to `npm test`, per the explicit lesson recorded from sub-project 2 (Vitest alone did not catch real Mantine-version/type-only-import bugs there).
