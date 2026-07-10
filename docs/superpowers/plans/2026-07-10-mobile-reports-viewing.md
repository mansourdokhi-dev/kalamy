# Mobile Reports Viewing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a patient (or their caregiver) view their own assessment-results history and a consolidated medical report from the mobile app.

**Architecture:** Both backend endpoints already exist and are already scoped to the patient (no backend work at all). This plan adds a small, dedicated `mobile/src/api/reports.ts` API file (matching the existing `patients.ts` precedent — one small file per distinct backend module, rather than growing the already-251-line `treatmentEngine.ts` with an unrelated domain), one new read-only screen with two sections, and a Home-screen integration adding a third link.

**Tech Stack:** Expo/React Native (existing mobile app conventions only — no new dependencies).

## Global Constraints

- No backend changes of any kind — both endpoints (`GET /api/v1/reports/patients/:patientId/assessment-results`, `GET /api/v1/reports/patients/:patientId/medical`) already exist, already gated to `VIEW_PATIENT_REPORTS` (already granted to PATIENT and CAREGIVER).
- No new mobile dependencies.
- RTL and Arabic-only copy, matching the existing `src/copy/ar.ts` flat-nested-object convention exactly.
- This screen is permanently read-only — no mutations, no PDF export/sharing.
- A caregiver sees exactly the same full medical detail as the patient would — no redaction, no age-based restriction (a deliberate decision made during design, not an oversight).
- No admin-facing reports (operational-status, registered-users, service-modifications, staff-performance, admin complaints-report) — out of scope for this app.

---

### Task 1: Mobile — Reports API client

**Files:**
- Create: `mobile/src/api/reports.ts`
- Test: none (thin API wrapper — matches this codebase's established convention of verifying such functions only through the screens that consume them, e.g. `patients.ts`/`treatmentEngine.ts` have no dedicated test files)

**Interfaces:**
- Consumes: `apiRequest` from `mobile/src/api/client.ts` (already exists, unchanged).
- Produces: `getAssessmentResultsReport(patientProfileId: string): Promise<AssessmentResultsReport>`, `getMedicalReport(patientProfileId: string): Promise<MedicalReport>`, plus the exported `AssessmentResultsReport` and `MedicalReport` types. Consumed by `reports.tsx` (Task 2).

- [ ] **Step 1: Write the file**

Create `mobile/src/api/reports.ts`:

```typescript
import { apiRequest } from './client';

export interface AssessmentResult {
  id: string;
  type: 'INITIAL' | 'PERIODIC' | 'FINAL';
  status: 'DRAFT' | 'APPROVED';
  ssi4Frequency: number | null;
  ssi4Duration: number | null;
  ssi4PhysicalConcomitants: number | null;
  ssi4Total: number | null;
  severityCategory: 'MILD' | 'MODERATE' | 'SEVERE' | 'VERY_SEVERE' | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface AssessmentResultsReport {
  patientProfileId: string;
  assessments: AssessmentResult[];
}

export interface MedicalReportClinicalInfo {
  referralReason: string | null;
  initialDiagnosis: string | null;
  medicalHistory: string | null;
  medications: string | null;
  allergies: string | null;
  familyHistory: string | null;
}

export interface MedicalReportLatestAssessment {
  id: string;
  type: 'INITIAL' | 'PERIODIC' | 'FINAL';
  severityCategory: 'MILD' | 'MODERATE' | 'SEVERE' | 'VERY_SEVERE' | null;
  ssi4Total: number | null;
  approvedAt: string | null;
}

export interface MedicalReportActivePlan {
  id: string;
  phase: string;
  goals: string;
  reviewDate: string;
}

export interface MedicalReport {
  patientProfileId: string;
  patientFullName: string;
  clinicalInfo: MedicalReportClinicalInfo | null;
  latestApprovedAssessment: MedicalReportLatestAssessment | null;
  activeTreatmentPlan: MedicalReportActivePlan | null;
}

export function getAssessmentResultsReport(patientProfileId: string): Promise<AssessmentResultsReport> {
  return apiRequest<AssessmentResultsReport>(`/api/v1/reports/patients/${patientProfileId}/assessment-results`, {
    auth: true,
  });
}

export function getMedicalReport(patientProfileId: string): Promise<MedicalReport> {
  return apiRequest<MedicalReport>(`/api/v1/reports/patients/${patientProfileId}/medical`, { auth: true });
}
```

- [ ] **Step 2: Confirm the project still compiles**

Run: `cd mobile && npx tsc --noEmit`
Expected: zero errors (this file has no consumers yet, but must be syntactically/type-valid on its own).

- [ ] **Step 3: Commit**

```bash
git add mobile/src/api/reports.ts
git commit -m "feat: add mobile API client for the reports module

New dedicated file (matching the patients.ts precedent) rather than
growing treatmentEngine.ts with an unrelated backend module. Both
endpoints already exist and are already patient-scoped — no backend
changes."
```

---

### Task 2: Mobile — `reports.tsx` screen

**Files:**
- Create: `mobile/app/program/reports.tsx`
- Modify: `mobile/src/copy/ar.ts` (add the `reports` namespace)
- Test: `mobile/app/program/__tests__/reports.test.tsx`

**Interfaces:**
- Consumes: `getAssessmentResultsReport`, `getMedicalReport`, `AssessmentResult`, `MedicalReport` (Task 1); `usePatientProfile()`; `ErrorBanner`; `useTheme()`.
- Produces: nothing consumed by later tasks (Task 3 only navigates to this screen's route, it doesn't import anything from this file).

- [ ] **Step 1: Add the `reports` copy namespace**

Read `mobile/src/copy/ar.ts` first. Add this key alongside `sampleRerecord` (before the closing `};`):

```typescript
  reports: {
    title: 'التقارير',
    assessmentResultsTitle: 'نتائج التقييمات',
    medicalReportTitle: 'التقرير الطبي',
    noAssessmentsYet: 'لا توجد تقييمات بعد',
    assessmentTypeLabel: 'النوع',
    assessmentStatusLabel: 'الحالة',
    types: {
      INITIAL: 'أولي',
      PERIODIC: 'دوري',
      FINAL: 'نهائي',
    },
    statuses: {
      DRAFT: 'مسودة',
      APPROVED: 'معتمد',
    },
    severities: {
      MILD: 'خفيف',
      MODERATE: 'متوسط',
      SEVERE: 'شديد',
      VERY_SEVERE: 'شديد جدًا',
    },
    severityLabel: 'شدة التلعثم',
    ssi4TotalLabel: 'مجموع SSI-4',
    approvedAtLabel: 'تاريخ الاعتماد',
    notApprovedYet: 'لم يُعتمد بعد',
    patientNameLabel: 'الاسم',
    referralReasonLabel: 'سبب الإحالة',
    initialDiagnosisLabel: 'التشخيص الأولي',
    medicalHistoryLabel: 'التاريخ الطبي',
    medicationsLabel: 'الأدوية',
    allergiesLabel: 'الحساسية',
    familyHistoryLabel: 'التاريخ العائلي',
    noClinicalInfo: 'لا توجد معلومات سريرية مسجّلة',
    latestAssessmentTitle: 'آخر تقييم معتمد',
    noApprovedAssessment: 'لا يوجد تقييم معتمد بعد',
    activePlanTitle: 'الخطة العلاجية الحالية',
    goalsLabel: 'الأهداف',
    reviewDateLabel: 'تاريخ المراجعة',
    noActivePlan: 'لا توجد خطة علاجية حالية',
    notAvailable: '-',
  },
```

- [ ] **Step 2: Write the failing test**

Create `mobile/app/program/__tests__/reports.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import ReportsScreen from '../reports';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getAssessmentResultsReport, getMedicalReport } from '../../../src/api/reports';
import { ApiError } from '../../../src/api/client';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/reports');

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('ReportsScreen', () => {
  it('renders both sections with full data', async () => {
    (getAssessmentResultsReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      assessments: [
        {
          id: 'assessment-1',
          type: 'INITIAL',
          status: 'APPROVED',
          ssi4Frequency: 10,
          ssi4Duration: 8,
          ssi4PhysicalConcomitants: 4,
          ssi4Total: 22,
          severityCategory: 'MODERATE',
          approvedAt: '2026-06-01T00:00:00.000Z',
          createdAt: '2026-05-30T00:00:00.000Z',
        },
      ],
    });
    (getMedicalReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      patientFullName: 'Patient One',
      clinicalInfo: {
        referralReason: 'تلعثم منذ الطفولة',
        initialDiagnosis: 'تلعثم متوسط',
        medicalHistory: 'لا يوجد',
        medications: 'لا يوجد',
        allergies: 'لا يوجد',
        familyHistory: 'أخ مصاب',
      },
      latestApprovedAssessment: {
        id: 'assessment-1',
        type: 'INITIAL',
        severityCategory: 'MODERATE',
        ssi4Total: 22,
        approvedAt: '2026-06-01T00:00:00.000Z',
      },
      activeTreatmentPlan: {
        id: 'plan-1',
        phase: 'PHASE_1',
        goals: 'Improve fluency',
        reviewDate: '2026-10-10T00:00:00.000Z',
      },
    });

    render(<ThemeProvider><ReportsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('نتائج التقييمات')).toBeTruthy();
      expect(screen.getByText('أولي')).toBeTruthy();
      expect(screen.getByText('متوسط')).toBeTruthy();
      expect(screen.getByText('22')).toBeTruthy();
      expect(screen.getByText('التقرير الطبي')).toBeTruthy();
      expect(screen.getByText('Patient One')).toBeTruthy();
      expect(screen.getByText('تلعثم منذ الطفولة')).toBeTruthy();
      expect(screen.getByText('Improve fluency')).toBeTruthy();
    });
  });

  it('shows the empty-assessments message when there are none', async () => {
    (getAssessmentResultsReport as jest.Mock).mockResolvedValue({ patientProfileId: 'profile-1', assessments: [] });
    (getMedicalReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      patientFullName: 'Patient One',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });

    render(<ThemeProvider><ReportsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد تقييمات بعد')).toBeTruthy();
    });
  });

  it('shows all three medical-report empty states when their fields are null', async () => {
    (getAssessmentResultsReport as jest.Mock).mockResolvedValue({ patientProfileId: 'profile-1', assessments: [] });
    (getMedicalReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      patientFullName: 'Patient One',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });

    render(<ThemeProvider><ReportsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد معلومات سريرية مسجّلة')).toBeTruthy();
      expect(screen.getByText('لا يوجد تقييم معتمد بعد')).toBeTruthy();
      expect(screen.getByText('لا توجد خطة علاجية حالية')).toBeTruthy();
    });
  });

  it('shows an ErrorBanner when the fetch fails', async () => {
    (getAssessmentResultsReport as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));
    (getMedicalReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      patientFullName: 'Patient One',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });

    render(<ThemeProvider><ReportsScreen /></ThemeProvider>);

    await waitFor(
      () => {
        expect(screen.getByText('Something broke')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npm test -- reports.test.tsx`
Expected: FAIL — `mobile/app/program/reports.tsx` doesn't exist yet.

- [ ] **Step 4: Write the screen**

Create `mobile/app/program/reports.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import {
  getAssessmentResultsReport,
  getMedicalReport,
  AssessmentResult,
  MedicalReport,
} from '../../src/api/reports';

function typeLabel(type: AssessmentResult['type']): string {
  return ar.reports.types[type];
}

function statusLabel(status: AssessmentResult['status']): string {
  return ar.reports.statuses[status];
}

function severityLabel(severity: AssessmentResult['severityCategory']): string {
  return severity ? ar.reports.severities[severity] : ar.reports.notAvailable;
}

export default function ReportsScreen() {
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<AssessmentResult[]>([]);
  const [medicalReport, setMedicalReport] = useState<MedicalReport | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [assessmentResults, medical] = await Promise.all([
        getAssessmentResultsReport(id),
        getMedicalReport(id),
      ]);
      const sorted = [...assessmentResults.assessments].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setAssessments(sorted);
      setMedicalReport(medical);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientProfileId]);

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
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.reports.title}</Text>

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.reports.assessmentResultsTitle}</Text>
      {assessments.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.reports.noAssessmentsYet}</Text>
      ) : (
        assessments.map((assessment) => (
          <View key={assessment.id} style={[styles.card, { borderColor: tokens.colors.border }]}>
            <Text style={{ color: tokens.colors.text }}>
              {ar.reports.assessmentTypeLabel}: {typeLabel(assessment.type)}
            </Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.reports.assessmentStatusLabel}: {statusLabel(assessment.status)}
            </Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.reports.severityLabel}: {severityLabel(assessment.severityCategory)}
            </Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.reports.ssi4TotalLabel}: {assessment.ssi4Total ?? ar.reports.notAvailable}
            </Text>
            <Text style={{ color: tokens.colors.textSecondary }}>
              {ar.reports.approvedAtLabel}: {assessment.approvedAt ?? ar.reports.notApprovedYet}
            </Text>
          </View>
        ))
      )}

      {medicalReport ? (
        <View style={{ marginTop: 24 }}>
          <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.reports.medicalReportTitle}</Text>
          <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>
            {ar.reports.patientNameLabel}: {medicalReport.patientFullName}
          </Text>

          {medicalReport.clinicalInfo ? (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.referralReasonLabel}: {medicalReport.clinicalInfo.referralReason ?? ar.reports.notAvailable}
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.initialDiagnosisLabel}: {medicalReport.clinicalInfo.initialDiagnosis ?? ar.reports.notAvailable}
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.medicalHistoryLabel}: {medicalReport.clinicalInfo.medicalHistory ?? ar.reports.notAvailable}
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.medicationsLabel}: {medicalReport.clinicalInfo.medications ?? ar.reports.notAvailable}
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.allergiesLabel}: {medicalReport.clinicalInfo.allergies ?? ar.reports.notAvailable}
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.familyHistoryLabel}: {medicalReport.clinicalInfo.familyHistory ?? ar.reports.notAvailable}
              </Text>
            </View>
          ) : (
            <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.reports.noClinicalInfo}</Text>
          )}

          <Text style={[styles.subSectionTitle, { color: tokens.colors.text }]}>{ar.reports.latestAssessmentTitle}</Text>
          {medicalReport.latestApprovedAssessment ? (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.assessmentTypeLabel}: {typeLabel(medicalReport.latestApprovedAssessment.type)}
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.severityLabel}: {severityLabel(medicalReport.latestApprovedAssessment.severityCategory)}
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.ssi4TotalLabel}: {medicalReport.latestApprovedAssessment.ssi4Total ?? ar.reports.notAvailable}
              </Text>
            </View>
          ) : (
            <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.reports.noApprovedAssessment}</Text>
          )}

          <Text style={[styles.subSectionTitle, { color: tokens.colors.text }]}>{ar.reports.activePlanTitle}</Text>
          {medicalReport.activeTreatmentPlan ? (
            <View>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.goalsLabel}: {medicalReport.activeTreatmentPlan.goals}
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.reviewDateLabel}: {medicalReport.activeTreatmentPlan.reviewDate}
              </Text>
            </View>
          ) : (
            <Text style={{ color: tokens.colors.textSecondary }}>{ar.reports.noActivePlan}</Text>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  subSectionTitle: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8, gap: 2 },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npm test -- reports.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 4 new tests.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/program/reports.tsx mobile/app/program/__tests__/reports.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add the Reports screen (assessment results + medical report)

Purely read-only: fetches both reports in parallel, sorts assessments
most-recent-first (matching History's convention), and handles all
four independent empty states (no assessments, no clinical info, no
approved assessment, no active plan) as plain text — never routed
through ErrorBanner, since these are expected states, not errors."
```

---

### Task 3: Mobile — Home screen integration

**Files:**
- Modify: `mobile/app/home.tsx`
- Modify: `mobile/src/copy/ar.ts` (add `viewReports` to the `program` namespace)
- Modify: `mobile/app/__tests__/home.test.tsx` (add 1 test to the existing file)

**Interfaces:**
- Consumes: nothing new — this task only adds a navigation button.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `viewReports` copy key**

Read `mobile/src/copy/ar.ts` first. In the existing `program` object, add this line alongside `viewHistory`:

```typescript
    viewReports: 'التقارير',
```

- [ ] **Step 2: Write the failing test**

Read `mobile/app/__tests__/home.test.tsx` first — add this test to its existing `describe` block (do not remove any existing tests):

```typescript
  it('always shows the "Reports" link in the links row, regardless of cycle status', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'ACTIVE_LEVEL_TRAINING', humanModelWatchedAt: '2026-07-01T00:00:00.000Z' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('التقارير')).toBeTruthy();
    });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npm test -- home.test.tsx`
Expected: FAIL on the new test — the "التقارير" text doesn't exist yet.

- [ ] **Step 4: Update `home.tsx`'s `linksRow`**

Read `mobile/app/home.tsx` first. Replace:

```typescript
      <View style={styles.linksRow}>
        <Button title={ar.program.viewLevelContent} onPress={() => router.push('/program/level-content')} />
        <Button title={ar.program.viewHistory} onPress={() => router.push('/program/history')} />
      </View>
```

with:

```typescript
      <View style={styles.linksRow}>
        <Button title={ar.program.viewLevelContent} onPress={() => router.push('/program/level-content')} />
        <Button title={ar.program.viewHistory} onPress={() => router.push('/program/history')} />
        <Button title={ar.program.viewReports} onPress={() => router.push('/program/reports')} />
      </View>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npm test -- home.test.tsx`
Expected: PASS, all 8 tests (7 pre-existing + 1 new).

- [ ] **Step 6: Run the full mobile suite to confirm no regressions**

Run: `cd mobile && npm test`
Expected: every existing test still passes, plus the 1 new test.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/home.tsx mobile/app/__tests__/home.test.tsx mobile/src/copy/ar.ts
git commit -m "feat: add a Reports link to Home, always visible regardless of cycle status

A patient can check their reports at any time, not gated behind
training progress — matching Level Content and History's existing
always-visible link behavior."
```

---

### Task 4: Full suite verification + manual walkthrough

**Files:**
- None created or modified — this task only runs and confirms.

**Interfaces:**
- None produced — verification only.

- [ ] **Step 1: Run the full backend e2e suite**

```bash
cd backend
npm run test:e2e
```
Expected: every suite passes (this plan makes no backend changes, so this is a pure regression check — expect the same count as the current baseline before this plan started).

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
Expected: every suite passes, including the new `reports.test.tsx` (4 tests) and the 1 new `home.test.tsx` test, plus every pre-existing test untouched by this plan.

- [ ] **Step 4: Manual walkthrough against the running dev servers**

Start both dev servers (`kalamy-backend` and `kalamy-mobile-web` from `.claude/launch.json`, or directly via `npm run start:dev` / `npm run web` if running inside an isolated worktree — confirm via the dev-server logs that they report starting from the correct worktree path, not a stale checkout).

1. Register a patient, verify OTP, log in.
2. As a clinician: create the patient's clinical profile (optionally include `clinicalInfo` this time, to exercise the populated-data path rather than only the empty-state path), create and approve an INITIAL assessment with real SSI-4 scores and a `severityCategory`, create an active treatment plan.
3. As the patient in the mobile app: from Home, tap "التقارير" — confirm the Reports screen shows the approved assessment (with correct Arabic type/status/severity labels and the real SSI-4 total) and the medical report (patient name, clinical info if you set it, the latest approved assessment summary, and the active plan's goals/phase/review date).
4. Confirm the "Reports" link is reachable regardless of the patient's current cycle status (try it both before and after starting a cycle).

This step has no automated pass/fail — its purpose is to catch anything the component-test mocks might have papered over (a real layout issue, a real Arabic-label mismatch against actual backend enum values). Report what you saw; if anything looks wrong, fix it in the relevant earlier task's files and re-run that task's own test file before continuing.

- [ ] **Step 5: Commit (only if Step 4 required fixes)**

If Step 4 surfaced no issues, there is nothing to commit for this task. If it did, commit the fix with a message describing what the manual walkthrough caught that the automated tests didn't.

---

## Self-Review Notes

**Spec coverage**: every in-scope item from `docs/superpowers/specs/2026-07-10-mobile-reports-viewing-design.md` has a task — the API client (Task 1), the Reports screen with both sections and all four empty states (Task 2), and the Home integration (Task 3). The spec's key decision (no caregiver redaction) required no task of its own, since it's the absence of a restriction, not a feature to build — confirmed the screen code never branches on role.

**Placeholder scan**: no task contains "TBD"/"TODO"/"add error handling"/"similar to Task N" — every step has complete, copy-pasteable code, and every test asserts real behavior (specific Arabic strings, specific field values), not `expect(true).toBe(true)`-style stand-ins.

**Type consistency, checked across tasks**: `AssessmentResult`, `AssessmentResultsReport`, `MedicalReport`, `MedicalReportClinicalInfo`, `MedicalReportLatestAssessment`, `MedicalReportActivePlan` are all defined once in Task 1's `reports.ts` and imported by name in Task 2's screen — no redefinition. `getAssessmentResultsReport`/`getMedicalReport`'s signatures match exactly between Task 1's definition and Task 2's usage.

**A note on the `phase` field**: `activeTreatmentPlan.phase` (e.g. `"PHASE_1"`) is displayed as its raw string value rather than translated to an Arabic label, since this plan doesn't have a confirmed, authoritative phase-name mapping to draw from (unlike `type`/`status`/`severityCategory`, whose Arabic labels are already used elsewhere in this codebase or are small, unambiguous enums). Translating it incorrectly would be worse than showing the raw value — flagging this as a known, deliberate gap rather than an oversight, in case a future sub-project has the correct phase-label mapping to add.

**A note on test-file placement for the API layer**: following this codebase's own established convention (`api/patients.ts`/`api/treatmentEngine.ts` have no dedicated test files; their behavior is verified through the screens that mock them), `reports.ts`'s two functions get no dedicated unit test — verified only through `reports.tsx`'s own test file, which asserts on the exact values those mocked functions return.
