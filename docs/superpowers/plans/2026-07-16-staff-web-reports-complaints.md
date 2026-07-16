# Staff Web Sub-project 4: Reports & Complaints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff-web a UI for the 7 already-shipped backend report endpoints and the Complaints module (list + status management), currently reachable only via Swagger/curl.

**Architecture:** Two new API modules (`reports.ts`, `complaints.ts`). A patient-scoped `ReportsSection` on the Patient Detail Hub (assessment-results + medical report, all staff roles). A standalone `/complaints` page (role-branching data source: full list for SUPERVISOR/ADMIN, own-only for CLINICIAN). A standalone `/admin-reports` page with 5 Mantine `Tabs` (SUPERVISOR/ADMIN only), each tab fetching its report lazily on first activation.

**Tech Stack:** Vite + React 19.2 + TypeScript, Mantine 9.4.1 exactly (no `@mantine/dates` — not installed; use plain `<input type="date">` via Mantine `TextInput` for the one date-filter need), React Router 7 classic API, Vitest 4 + `@testing-library/react` 16 + jsdom, `apiRequest<T>()` client (no data-fetching library).

## Global Constraints

- Mantine pinned at exactly `9.4.1` across all `@mantine/*` packages — do not run any install that could re-resolve this.
- No new npm dependencies. `@mantine/dates` is NOT installed; do not add it — use `<TextInput type="date">` for the date-range filter.
- No staff role holds `SUBMIT_COMPLAINT` — do not build a complaint-submission form anywhere in staff-web.
- No backend PDF/export endpoint exists for any report — do not build export/print UI.
- All Arabic copy goes in `staff-web/src/copy/ar.ts`, nowhere else. RTL is already forced app-wide; do not add direction-specific CSS.
- `npm run build` (`tsc -b && vite build`) is the only step that type-checks — run it at every task boundary in addition to `npm test`.
- Follow the existing Card-section pattern exactly: `Card withBorder`, `Title order={3}`, inline `Alert color="red"` for errors, `useEffect` keyed on `patient?.id`, plain `useState` (no `@mantine/form`), `data-testid` on interactive/list rows.
- Reuse existing copy maps where the underlying enum is already translated: `ar.patientDetail.assessmentTypes`, `ar.patientDetail.assessmentStatuses`, `ar.patientDetail.severityCategories`, `ar.patientDetail.phases`, `ar.patients.statuses`. Do not redefine these.
- After every mutation (complaint status update), refetch the list before updating state — do not locally patch state in place (lesson from sub-project 3's final review: stale-UI bugs came from skipping this).

---

### Task 1: API modules — `reports.ts` and `complaints.ts`

**Files:**
- Create: `staff-web/src/api/reports.ts`
- Create: `staff-web/src/api/reports.test.ts`
- Create: `staff-web/src/api/complaints.ts`
- Create: `staff-web/src/api/complaints.test.ts`

**Interfaces:**
- Consumes: `apiRequest<T>(path, options)` from `staff-web/src/api/client.ts` (signature: `apiRequest<T>(path: string, options?: { method?: string; body?: unknown; auth?: boolean }): Promise<T>`).
- Produces (for later tasks): from `reports.ts` — `AssessmentResultsReportRow`, `getAssessmentResultsReport(patientId)`; `MedicalReport`, `getMedicalReport(patientId)`; `OperationalStatusReport`, `getOperationalStatusReport()`; `RegisteredUserSummary`, `getRegisteredUsersReport()`; `ServiceModificationLogEntry`, `getServiceModificationsReport(filter?)`; `StaffPerformanceSummary`, `getStaffPerformanceReport()`; `getComplaintsReport(filter?)`. From `complaints.ts` — `Complaint`, `ComplaintType`, `ComplaintStatus`, `listComplaints(filter?)`, `listMyComplaints()`, `updateComplaintStatus(id, status)`.

- [ ] **Step 1: Write `complaints.ts` first (reports.ts imports its `Complaint` type)**

```typescript
// staff-web/src/api/complaints.ts
import { apiRequest } from './client';

export type ComplaintType = 'COMPLAINT' | 'SUGGESTION';
export type ComplaintStatus = 'OPEN' | 'REVIEWED' | 'RESOLVED';

export interface Complaint {
  id: string;
  submittedByUserId: string;
  relatedClinicianUserId: string | null;
  type: ComplaintType;
  subject: string;
  description: string;
  status: ComplaintStatus;
  createdAt: string;
  updatedAt: string;
}

export function listComplaints(filter: { status?: ComplaintStatus; relatedClinicianUserId?: string } = {}): Promise<Complaint[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.relatedClinicianUserId) params.set('relatedClinicianUserId', filter.relatedClinicianUserId);
  const query = params.toString();
  return apiRequest<Complaint[]>(`/api/v1/complaints${query ? `?${query}` : ''}`, { auth: true });
}

export function listMyComplaints(): Promise<Complaint[]> {
  return apiRequest<Complaint[]>('/api/v1/complaints/mine', { auth: true });
}

export function updateComplaintStatus(id: string, status: ComplaintStatus): Promise<Complaint> {
  return apiRequest<Complaint>(`/api/v1/complaints/${id}/status`, { method: 'PATCH', body: { status }, auth: true });
}
```

- [ ] **Step 2: Write `complaints.test.ts`**

```typescript
// staff-web/src/api/complaints.test.ts
import { apiRequest } from './client';
import { listComplaints, listMyComplaints, updateComplaintStatus } from './complaints';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('complaints API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listComplaints fetches with no query params when filter is empty', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listComplaints();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/complaints', { auth: true });
  });

  it('listComplaints appends status and relatedClinicianUserId as query params', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listComplaints({ status: 'OPEN', relatedClinicianUserId: 'clinician-1' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/complaints?status=OPEN&relatedClinicianUserId=clinician-1', { auth: true });
  });

  it('listMyComplaints fetches the caller-scoped endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listMyComplaints();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/complaints/mine', { auth: true });
  });

  it('updateComplaintStatus PATCHes the status endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'complaint-1', status: 'RESOLVED' });
    await updateComplaintStatus('complaint-1', 'RESOLVED');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/complaints/complaint-1/status', {
      method: 'PATCH',
      body: { status: 'RESOLVED' },
      auth: true,
    });
  });
});
```

- [ ] **Step 3: Run the complaints tests**

Run: `cd staff-web && npx vitest run src/api/complaints.test.ts`
Expected: 4 passed.

- [ ] **Step 4: Write `reports.ts`**

```typescript
// staff-web/src/api/reports.ts
import { apiRequest } from './client';
import type { Complaint, ComplaintStatus } from './complaints';

export interface AssessmentResultsReportRow {
  id: string;
  type: string;
  status: string;
  ssi4Frequency: number | null;
  ssi4Duration: number | null;
  ssi4PhysicalConcomitants: number | null;
  ssi4Total: number | null;
  severityCategory: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export function getAssessmentResultsReport(patientId: string): Promise<AssessmentResultsReportRow[]> {
  return apiRequest<AssessmentResultsReportRow[]>(`/api/v1/reports/patients/${patientId}/assessment-results`, { auth: true });
}

export interface MedicalReport {
  patientProfileId: string;
  patientFullName: string;
  clinicalInfo: {
    referralReason: string | null;
    initialDiagnosis: string | null;
    medicalHistory: string | null;
    medications: string | null;
    allergies: string | null;
    familyHistory: string | null;
  } | null;
  latestApprovedAssessment: {
    id: string;
    type: string;
    severityCategory: string | null;
    ssi4Total: number | null;
    approvedAt: string;
  } | null;
  activeTreatmentPlan: {
    id: string;
    phase: string;
    goals: string;
    reviewDate: string | null;
  } | null;
}

export function getMedicalReport(patientId: string): Promise<MedicalReport> {
  return apiRequest<MedicalReport>(`/api/v1/reports/patients/${patientId}/medical`, { auth: true });
}

export interface OperationalStatusReport {
  usersByRole: Record<string, number>;
  patientProfilesByStatus: Record<string, number>;
  treatmentPlansByStatus: Record<string, number>;
  trainingCyclesByStatus: Record<string, number>;
}

export function getOperationalStatusReport(): Promise<OperationalStatusReport> {
  return apiRequest<OperationalStatusReport>('/api/v1/reports/operational-status', { auth: true });
}

export interface RegisteredUserSummary {
  id: string;
  fullName: string;
  mobile: string;
  role: string;
  status: string;
  createdAt: string;
  caseProgressSummary: string;
}

export function getRegisteredUsersReport(): Promise<RegisteredUserSummary[]> {
  return apiRequest<RegisteredUserSummary[]>('/api/v1/reports/registered-users', { auth: true });
}

export interface ServiceModificationLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  actorFullName: string;
  actorRole: string;
  createdAt: string;
}

export function getServiceModificationsReport(filter: { from?: string; to?: string } = {}): Promise<ServiceModificationLogEntry[]> {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  const query = params.toString();
  return apiRequest<ServiceModificationLogEntry[]>(`/api/v1/reports/service-modifications${query ? `?${query}` : ''}`, { auth: true });
}

export interface StaffPerformanceSummary {
  clinicianUserId: string;
  fullName: string;
  role: string;
  patientsHandled: number;
  reviewsApproved: number;
  reviewsRepeatRequired: number;
  complaintsAgainst: number;
}

export function getStaffPerformanceReport(): Promise<StaffPerformanceSummary[]> {
  return apiRequest<StaffPerformanceSummary[]>('/api/v1/reports/staff-performance', { auth: true });
}

export function getComplaintsReport(filter: { status?: ComplaintStatus; relatedClinicianUserId?: string } = {}): Promise<Complaint[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.relatedClinicianUserId) params.set('relatedClinicianUserId', filter.relatedClinicianUserId);
  const query = params.toString();
  return apiRequest<Complaint[]>(`/api/v1/reports/complaints${query ? `?${query}` : ''}`, { auth: true });
}
```

- [ ] **Step 5: Write `reports.test.ts`**

```typescript
// staff-web/src/api/reports.test.ts
import { apiRequest } from './client';
import {
  getAssessmentResultsReport,
  getMedicalReport,
  getOperationalStatusReport,
  getRegisteredUsersReport,
  getServiceModificationsReport,
  getStaffPerformanceReport,
  getComplaintsReport,
} from './reports';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('reports API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('getAssessmentResultsReport fetches the patient-scoped endpoint', async () => {
    await getAssessmentResultsReport('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/patients/patient-1/assessment-results', { auth: true });
  });

  it('getMedicalReport fetches the patient-scoped endpoint', async () => {
    await getMedicalReport('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/patients/patient-1/medical', { auth: true });
  });

  it('getOperationalStatusReport fetches with no params', async () => {
    await getOperationalStatusReport();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/operational-status', { auth: true });
  });

  it('getRegisteredUsersReport fetches with no params', async () => {
    await getRegisteredUsersReport();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/registered-users', { auth: true });
  });

  it('getServiceModificationsReport fetches with no query when filter is empty', async () => {
    await getServiceModificationsReport();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/service-modifications', { auth: true });
  });

  it('getServiceModificationsReport appends from/to as query params', async () => {
    await getServiceModificationsReport({ from: '2026-01-01', to: '2026-02-01' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/service-modifications?from=2026-01-01&to=2026-02-01', { auth: true });
  });

  it('getStaffPerformanceReport fetches with no params', async () => {
    await getStaffPerformanceReport();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/staff-performance', { auth: true });
  });

  it('getComplaintsReport appends status and relatedClinicianUserId as query params', async () => {
    await getComplaintsReport({ status: 'OPEN', relatedClinicianUserId: 'clinician-1' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/complaints?status=OPEN&relatedClinicianUserId=clinician-1', { auth: true });
  });
});
```

- [ ] **Step 6: Run both test files and the build**

Run: `cd staff-web && npx vitest run src/api/reports.test.ts src/api/complaints.test.ts`
Expected: 12 passed (8 in reports.test.ts, 4 in complaints.test.ts).

Run: `cd staff-web && npm run build`
Expected: clean `tsc -b` + successful `vite build`.

- [ ] **Step 7: Commit**

```bash
git add staff-web/src/api/reports.ts staff-web/src/api/reports.test.ts staff-web/src/api/complaints.ts staff-web/src/api/complaints.test.ts
git commit -m "feat: add reports and complaints API modules"
```

---

### Task 2: `ReportsSection` on the Patient Detail Hub

**Files:**
- Create: `staff-web/src/patients/ReportsSection.tsx`
- Create: `staff-web/src/patients/ReportsSection.test.tsx`
- Modify: `staff-web/src/pages/PatientDetailPage.tsx` (add `<ReportsSection />` to the `Stack`)
- Modify: `staff-web/src/pages/PatientDetailPage.test.tsx` (mock `../api/reports` alongside the existing `../api/cycles`/`../api/progress` mocks)
- Modify: `staff-web/src/copy/ar.ts` (add a `reports` namespace)

**Interfaces:**
- Consumes: `getAssessmentResultsReport(patientId)`, `getMedicalReport(patientId)` from Task 1's `staff-web/src/api/reports.ts`; `usePatientDetail()` from `staff-web/src/patients/PatientDetailContext.tsx` (provides `{ patient, loading, error }`, `patient.id: string`); existing copy maps `ar.patientDetail.assessmentTypes`, `ar.patientDetail.assessmentStatuses`, `ar.patientDetail.severityCategories`, `ar.patientDetail.phases` (all `Record<string, string>`).
- Produces: `ReportsSection` component, no exports consumed by later tasks.

- [ ] **Step 1: Add the `reports` copy namespace to `staff-web/src/copy/ar.ts`**

Add this object as a new top-level key in the `ar` export (place it after the existing `progress` key, before `errors`):

```typescript
  reports: {
    patientSectionTitle: 'التقارير',
    assessmentResultsTitle: 'نتائج التقييمات',
    noAssessmentResults: 'لا توجد نتائج تقييمات',
    assessmentTypeLabel: 'النوع',
    assessmentStatusLabel: 'الحالة',
    ssi4TotalLabel: 'مجموع SSI-4',
    severityCategoryLabel: 'درجة الشدة',
    approvedAtLabel: 'تاريخ الاعتماد',
    medicalReportTitle: 'التقرير الطبي',
    noClinicalInfo: 'لا توجد معلومات سريرية',
    referralReasonLabel: 'سبب الإحالة',
    initialDiagnosisLabel: 'التشخيص الأولي',
    medicalHistoryLabel: 'التاريخ المرضي',
    medicationsLabel: 'الأدوية',
    allergiesLabel: 'الحساسية',
    familyHistoryLabel: 'التاريخ العائلي',
    latestAssessmentTitle: 'آخر تقييم معتمد',
    noLatestAssessment: 'لا يوجد تقييم معتمد',
    activePlanTitle: 'الخطة العلاجية النشطة',
    noActivePlanForReport: 'لا توجد خطة علاجية نشطة',
    reviewDateLabel: 'تاريخ المراجعة',
    adminReportsTitle: 'التقارير الإدارية',
    tabs: {
      operationalStatus: 'الحالة التشغيلية',
      registeredUsers: 'المستخدمون المسجلون',
      serviceModifications: 'سجل التعديلات',
      staffPerformance: 'أداء الطاقم',
      complaintsReport: 'تقرير الشكاوى',
    },
    usersByRoleTitle: 'المستخدمون حسب الدور',
    patientProfilesByStatusTitle: 'ملفات المرضى حسب الحالة',
    treatmentPlansByStatusTitle: 'الخطط العلاجية حسب الحالة',
    trainingCyclesByStatusTitle: 'دورات التدريب حسب الحالة',
    noData: 'لا توجد بيانات',
    roles: {
      PATIENT: 'مستفيد',
      CAREGIVER: 'ولي أمر',
      CLINICIAN: 'أخصائي',
      SUPERVISOR: 'مشرف',
      ADMIN: 'مدير النظام',
    } as Record<string, string>,
    planStatuses: { ACTIVE: 'نشطة', INACTIVE: 'غير نشطة' } as Record<string, string>,
    cycleStatuses: {
      ACTIVE_LEVEL_TRAINING: 'تدريب المستوى النشط',
      SAMPLE_ELIGIBLE: 'مؤهل لتسجيل عينة',
      SAMPLE_PREPARATION: 'تحضير العينة',
      SAMPLE_SUBMISSION_DELAYED: 'تأخر إرسال العينة',
      SAMPLE_SUBMITTED: 'تم إرسال العينة',
      WAITING_FOR_SPECIALIST: 'بانتظار الأخصائي',
      UNDER_REVIEW: 'قيد المراجعة',
      DIRECT_INTERVENTION_REQUIRED: 'يتطلب تدخلًا مباشرًا',
      WAITING_FINAL_DECISION_AFTER_INTERVENTION: 'بانتظار القرار النهائي بعد التدخل',
      TECHNICAL_PARTIAL_RERECORD: 'إعادة تسجيل جزئي (فني)',
      LEVEL_REPEAT_DECIDED: 'تقرر إعادة المستوى',
      NEXT_LEVEL_APPROVED: 'تم اعتماد المستوى التالي',
      CLOSED_DUE_TO_INACTIVITY: 'أُغلقت بسبب عدم النشاط',
      SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN: 'انتهى الاشتراك (المسار السريري مفتوح)',
    } as Record<string, string>,
    fullNameLabel: 'الاسم الكامل',
    mobileLabel: 'رقم الجوال',
    roleLabel: 'الدور',
    statusLabel: 'الحالة',
    caseProgressLabel: 'حالة التقدم',
    fromDateLabel: 'من تاريخ',
    toDateLabel: 'إلى تاريخ',
    actionLabel: 'الإجراء',
    entityLabel: 'الكيان',
    actorLabel: 'المستخدم',
    dateLabel: 'التاريخ',
    noServiceModifications: 'لا توجد تعديلات في هذه الفترة',
    patientsHandledLabel: 'عدد المرضى',
    reviewsApprovedLabel: 'المراجعات المعتمدة',
    reviewsRepeatRequiredLabel: 'مراجعات تتطلب إعادة',
    complaintsAgainstLabel: 'الشكاوى المقدمة ضده',
    noStaffPerformance: 'لا توجد بيانات أداء',
    noRegisteredUsers: 'لا يوجد مستخدمون',
  },
```

- [ ] **Step 2: Write `ReportsSection.tsx`**

```typescript
// staff-web/src/patients/ReportsSection.tsx
import { useEffect, useState } from 'react';
import { Card, Title, Text, Table, Alert, Stack } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { getAssessmentResultsReport, getMedicalReport } from '../api/reports';
import type { AssessmentResultsReportRow, MedicalReport } from '../api/reports';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function ReportsSection() {
  const { patient } = usePatientDetail();

  const [assessmentResults, setAssessmentResults] = useState<AssessmentResultsReportRow[] | null>(null);
  const [medicalReport, setMedicalReport] = useState<MedicalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient) return;
    setError(null);
    Promise.all([getAssessmentResultsReport(patient.id), getMedicalReport(patient.id)])
      .then(([resultsResponse, medicalResponse]) => {
        setAssessmentResults(resultsResponse);
        setMedicalReport(medicalResponse);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  if (!patient) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.reports.patientSectionTitle}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      <Text fw={600} mb="xs">{ar.reports.assessmentResultsTitle}</Text>
      {assessmentResults === null ? null : assessmentResults.length === 0 ? (
        <Text c="dimmed" mb="md">{ar.reports.noAssessmentResults}</Text>
      ) : (
        <Table mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.reports.assessmentTypeLabel}</Table.Th>
              <Table.Th>{ar.reports.assessmentStatusLabel}</Table.Th>
              <Table.Th>{ar.reports.ssi4TotalLabel}</Table.Th>
              <Table.Th>{ar.reports.severityCategoryLabel}</Table.Th>
              <Table.Th>{ar.reports.approvedAtLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {assessmentResults.map((row) => (
              <Table.Tr key={row.id} data-testid={`assessment-result-row-${row.id}`}>
                <Table.Td>{ar.patientDetail.assessmentTypes[row.type] ?? row.type}</Table.Td>
                <Table.Td>{ar.patientDetail.assessmentStatuses[row.status] ?? row.status}</Table.Td>
                <Table.Td>{row.ssi4Total ?? '—'}</Table.Td>
                <Table.Td>
                  {row.severityCategory ? (ar.patientDetail.severityCategories[row.severityCategory] ?? row.severityCategory) : '—'}
                </Table.Td>
                <Table.Td>{row.approvedAt ? formatDate(row.approvedAt) : '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Text fw={600} mb="xs">{ar.reports.medicalReportTitle}</Text>
      {medicalReport === null ? null : (
        <Stack gap="xs">
          {medicalReport.clinicalInfo ? (
            <Stack gap={4}>
              <Text>{ar.reports.referralReasonLabel}: {medicalReport.clinicalInfo.referralReason ?? '—'}</Text>
              <Text>{ar.reports.initialDiagnosisLabel}: {medicalReport.clinicalInfo.initialDiagnosis ?? '—'}</Text>
              <Text>{ar.reports.medicalHistoryLabel}: {medicalReport.clinicalInfo.medicalHistory ?? '—'}</Text>
              <Text>{ar.reports.medicationsLabel}: {medicalReport.clinicalInfo.medications ?? '—'}</Text>
              <Text>{ar.reports.allergiesLabel}: {medicalReport.clinicalInfo.allergies ?? '—'}</Text>
              <Text>{ar.reports.familyHistoryLabel}: {medicalReport.clinicalInfo.familyHistory ?? '—'}</Text>
            </Stack>
          ) : (
            <Text c="dimmed">{ar.reports.noClinicalInfo}</Text>
          )}

          <Text fw={600}>{ar.reports.latestAssessmentTitle}</Text>
          {medicalReport.latestApprovedAssessment ? (
            <Text data-testid="latest-assessment-summary">
              {ar.patientDetail.assessmentTypes[medicalReport.latestApprovedAssessment.type] ?? medicalReport.latestApprovedAssessment.type}
              {' — '}
              {medicalReport.latestApprovedAssessment.severityCategory
                ? (ar.patientDetail.severityCategories[medicalReport.latestApprovedAssessment.severityCategory] ?? medicalReport.latestApprovedAssessment.severityCategory)
                : '—'}
              {' — '}
              {formatDate(medicalReport.latestApprovedAssessment.approvedAt)}
            </Text>
          ) : (
            <Text c="dimmed">{ar.reports.noLatestAssessment}</Text>
          )}

          <Text fw={600}>{ar.reports.activePlanTitle}</Text>
          {medicalReport.activeTreatmentPlan ? (
            <Text data-testid="active-plan-summary">
              {ar.patientDetail.phases[medicalReport.activeTreatmentPlan.phase] ?? medicalReport.activeTreatmentPlan.phase}
              {' — '}
              {medicalReport.activeTreatmentPlan.goals}
              {medicalReport.activeTreatmentPlan.reviewDate ? ` — ${formatDate(medicalReport.activeTreatmentPlan.reviewDate)}` : ''}
              {ar.reports.reviewDateLabel ? null : null}
            </Text>
          ) : (
            <Text c="dimmed">{ar.reports.noActivePlanForReport}</Text>
          )}
        </Stack>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Write `ReportsSection.test.tsx`** (following `AssessmentsSection.test.tsx`'s render-helper pattern)

```typescript
// staff-web/src/patients/ReportsSection.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReportsSection } from './ReportsSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getAssessmentResultsReport, getMedicalReport } from '../api/reports';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/reports');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderSection() {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role: 'CLINICIAN',
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <ReportsSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReportsSection', () => {
  it('shows the empty state when there are no assessment results', async () => {
    (getAssessmentResultsReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getMedicalReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      patientProfileId: 'patient-1',
      patientFullName: 'مريض',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد نتائج تقييمات')).toBeTruthy();
    });
  });

  it('renders an assessment result row', async () => {
    (getAssessmentResultsReport as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'assessment-1',
        type: 'INITIAL',
        status: 'APPROVED',
        ssi4Frequency: 3,
        ssi4Duration: 2,
        ssi4PhysicalConcomitants: 1,
        ssi4Total: 6,
        severityCategory: 'MILD',
        approvedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2025-12-01T00:00:00.000Z',
      },
    ]);
    (getMedicalReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      patientProfileId: 'patient-1',
      patientFullName: 'مريض',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId('assessment-result-row-assessment-1')).toBeTruthy();
    });
  });

  it('shows clinical info and active plan summary from the medical report', async () => {
    (getAssessmentResultsReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getMedicalReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      patientProfileId: 'patient-1',
      patientFullName: 'مريض',
      clinicalInfo: {
        referralReason: 'إحالة من مدرسة',
        initialDiagnosis: null,
        medicalHistory: null,
        medications: null,
        allergies: null,
        familyHistory: null,
      },
      latestApprovedAssessment: {
        id: 'assessment-1',
        type: 'INITIAL',
        severityCategory: 'MILD',
        ssi4Total: 6,
        approvedAt: '2026-01-01T00:00:00.000Z',
      },
      activeTreatmentPlan: {
        id: 'plan-1',
        phase: 'PHASE_1',
        goals: 'تحسين الطلاقة',
        reviewDate: null,
      },
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('إحالة من مدرسة', { exact: false })).toBeTruthy();
      expect(screen.getByTestId('latest-assessment-summary')).toBeTruthy();
      expect(screen.getByTestId('active-plan-summary')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 4: Wire `ReportsSection` into `PatientDetailPage.tsx`**

In `staff-web/src/pages/PatientDetailPage.tsx`, add the import and render it after `<TreatmentPlanSection />` (before `<SampleReviewSection />`, matching backend build order: assessments → plan → reports → sample review → progress — an arbitrary but consistent placement):

```typescript
import { ReportsSection } from '../patients/ReportsSection';
```

```typescript
      <ProfileSection />
      <AssessmentsSection />
      <TreatmentPlanSection />
      <ReportsSection />
      <SampleReviewSection />
      <ProgressSection />
```

- [ ] **Step 5: Update `PatientDetailPage.test.tsx` to mock `../api/reports`**

Add the import and mock, and a rejected-promise default in `beforeEach` (same reasoning as the existing `cycles`/`progress` mocks — `ReportsSection` also chains `.then()`/`.catch()` un-awaited):

```typescript
import { getAssessmentResultsReport, getMedicalReport } from '../api/reports';
```

```typescript
vi.mock('../api/reports');
```

```typescript
  (getAssessmentResultsReport as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not mocked in this test'));
  (getMedicalReport as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not mocked in this test'));
```
(add these two lines alongside the existing `getCurrentCycle`/`getProgressDashboard`/`getPassedLevels` rejected-mock lines in the same `beforeEach`)

- [ ] **Step 6: Run tests and build**

Run: `cd staff-web && npx vitest run src/patients/ReportsSection.test.tsx src/pages/PatientDetailPage.test.tsx`
Expected: all passed (3 in ReportsSection.test.tsx + the 2 existing PatientDetailPage tests).

Run: `cd staff-web && npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add staff-web/src/patients/ReportsSection.tsx staff-web/src/patients/ReportsSection.test.tsx staff-web/src/pages/PatientDetailPage.tsx staff-web/src/pages/PatientDetailPage.test.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add ReportsSection with assessment-results and medical report to the Patient Detail Hub"
```

---

### Task 3: Complaints page

**Files:**
- Create: `staff-web/src/pages/ComplaintsPage.tsx`
- Create: `staff-web/src/pages/ComplaintsPage.test.tsx`
- Modify: `staff-web/src/auth/permissions.ts` (add `canManageComplaints`)
- Modify: `staff-web/src/App.tsx` (add `/complaints` route)
- Modify: `staff-web/src/components/AppShell.tsx` (add nav link, visible to all staff roles)
- Modify: `staff-web/src/copy/ar.ts` (add a `complaints` namespace)

**Interfaces:**
- Consumes: `listComplaints(filter?)`, `listMyComplaints()`, `updateComplaintStatus(id, status)`, `Complaint`, `ComplaintStatus` from Task 1's `staff-web/src/api/complaints.ts`; `useAuth()` from `staff-web/src/auth/AuthProvider.tsx` (provides `{ user: StaffUser | null }`).
- Produces: `canManageComplaints(role: StaffRole): boolean` in `staff-web/src/auth/permissions.ts`, consumed by Task 4's Admin Reports nav gating is separate (`canViewAdminReports`) — this one is consumed only within this task's page and `AppShell`.

- [ ] **Step 1: Add `canManageComplaints` to `staff-web/src/auth/permissions.ts`**

```typescript
export function canManageComplaints(role: StaffRole): boolean {
  return role === 'SUPERVISOR' || role === 'ADMIN';
}
```

- [ ] **Step 2: Add the `complaints` copy namespace to `staff-web/src/copy/ar.ts`** (place after the `reports` key added in Task 2, before `errors`)

```typescript
  complaints: {
    title: 'الشكاوى',
    emptyState: 'لا توجد شكاوى',
    typeLabel: 'النوع',
    types: { COMPLAINT: 'شكوى', SUGGESTION: 'اقتراح' } as Record<string, string>,
    subjectLabel: 'الموضوع',
    descriptionLabel: 'الوصف',
    statusLabel: 'الحالة',
    statuses: { OPEN: 'مفتوحة', REVIEWED: 'تمت مراجعتها', RESOLVED: 'تم حلها' } as Record<string, string>,
    createdAtLabel: 'تاريخ التقديم',
    statusFilterLabel: 'تصفية حسب الحالة',
    statusFilterAll: 'الكل',
  },
```

Also add the nav-link label to the existing `shell` namespace:
```typescript
    complaintsLink: 'الشكاوى',
```
(add this line inside `shell`, alongside `patientsLink`/`reviewQueueLink`)

- [ ] **Step 3: Write `ComplaintsPage.tsx`**

```typescript
// staff-web/src/pages/ComplaintsPage.tsx
import { useEffect, useState } from 'react';
import { Container, Title, Table, Text, Badge, Alert, Select } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canManageComplaints } from '../auth/permissions';
import { listComplaints, listMyComplaints, updateComplaintStatus } from '../api/complaints';
import type { Complaint, ComplaintStatus } from '../api/complaints';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

const STATUS_OPTIONS: ComplaintStatus[] = ['OPEN', 'REVIEWED', 'RESOLVED'];

export function ComplaintsPage() {
  const { user } = useAuth();
  const canManage = user ? canManageComplaints(user.role) : false;

  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = canManage
        ? await listComplaints(statusFilter ? { status: statusFilter } : {})
        : await listMyComplaints();
      setComplaints(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, statusFilter]);

  async function handleStatusChange(id: string, status: ComplaintStatus) {
    setUpdatingId(id);
    setError(null);
    try {
      await updateComplaintStatus(id, status);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.complaints.title}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {canManage ? (
        <Select
          data-testid="status-filter-select"
          label={ar.complaints.statusFilterLabel}
          value={statusFilter ?? 'ALL'}
          onChange={(value) => setStatusFilter(value === 'ALL' ? null : (value as ComplaintStatus))}
          data={[
            { value: 'ALL', label: ar.complaints.statusFilterAll },
            ...STATUS_OPTIONS.map((status) => ({ value: status, label: ar.complaints.statuses[status] })),
          ]}
          mb="md"
          w={220}
        />
      ) : null}

      {complaints === null ? null : complaints.length === 0 ? (
        <Text c="dimmed">{ar.complaints.emptyState}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.complaints.typeLabel}</Table.Th>
              <Table.Th>{ar.complaints.subjectLabel}</Table.Th>
              <Table.Th>{ar.complaints.descriptionLabel}</Table.Th>
              <Table.Th>{ar.complaints.createdAtLabel}</Table.Th>
              <Table.Th>{ar.complaints.statusLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {complaints.map((complaint) => (
              <Table.Tr key={complaint.id} data-testid={`complaint-row-${complaint.id}`}>
                <Table.Td>
                  <Badge color={complaint.type === 'COMPLAINT' ? 'red' : 'blue'}>
                    {ar.complaints.types[complaint.type]}
                  </Badge>
                </Table.Td>
                <Table.Td>{complaint.subject}</Table.Td>
                <Table.Td>{complaint.description}</Table.Td>
                <Table.Td>{formatDate(complaint.createdAt)}</Table.Td>
                <Table.Td>
                  {canManage ? (
                    <Select
                      data-testid={`complaint-status-select-${complaint.id}`}
                      value={complaint.status}
                      disabled={updatingId === complaint.id}
                      onChange={(value) => value && handleStatusChange(complaint.id, value as ComplaintStatus)}
                      data={STATUS_OPTIONS.map((status) => ({ value: status, label: ar.complaints.statuses[status] }))}
                      w={160}
                    />
                  ) : (
                    <Badge>{ar.complaints.statuses[complaint.status]}</Badge>
                  )}
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

- [ ] **Step 4: Write `ComplaintsPage.test.tsx`** (following `ReviewQueuePage.test.tsx`'s render-helper pattern)

```typescript
// staff-web/src/pages/ComplaintsPage.test.tsx
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ComplaintsPage } from './ComplaintsPage';
import { AuthProvider } from '../auth/AuthProvider';
import { listComplaints, listMyComplaints, updateComplaintStatus } from '../api/complaints';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/complaints');
vi.mock('../api/auth');
vi.mock('../storage/session');

const complaintRow = {
  id: 'complaint-1',
  submittedByUserId: 'patient-user-1',
  relatedClinicianUserId: null,
  type: 'COMPLAINT' as const,
  subject: 'تأخر الموعد',
  description: 'تأخرت الجلسة عن موعدها المحدد',
  status: 'OPEN' as const,
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
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
      <AuthProvider>
        <ComplaintsPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ComplaintsPage', () => {
  it('CLINICIAN sees only their own complaints via listMyComplaints, with no status control', async () => {
    (listMyComplaints as ReturnType<typeof vi.fn>).mockResolvedValue([complaintRow]);
    renderPage('CLINICIAN');

    await waitFor(() => expect(screen.getByTestId('complaint-row-complaint-1')).toBeTruthy());
    expect(listMyComplaints).toHaveBeenCalled();
    expect(listComplaints).not.toHaveBeenCalled();
    expect(screen.queryByTestId('complaint-status-select-complaint-1')).toBeNull();
    expect(screen.queryByTestId('status-filter-select')).toBeNull();
  });

  it('SUPERVISOR sees the full list via listComplaints, with a status control', async () => {
    (listComplaints as ReturnType<typeof vi.fn>).mockResolvedValue([complaintRow]);
    renderPage('SUPERVISOR');

    await waitFor(() => expect(screen.getByTestId('complaint-row-complaint-1')).toBeTruthy());
    expect(listComplaints).toHaveBeenCalledWith({});
    expect(screen.getByTestId('complaint-status-select-complaint-1')).toBeTruthy();
    expect(screen.getByTestId('status-filter-select')).toBeTruthy();
  });

  it('shows the empty state when there are no complaints', async () => {
    (listMyComplaints as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('CLINICIAN');
    await waitFor(() => {
      expect(screen.getByText('لا توجد شكاوى')).toBeTruthy();
    });
  });

  it('updates status and refetches the list on success', async () => {
    (listComplaints as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([complaintRow])
      .mockResolvedValue([{ ...complaintRow, status: 'RESOLVED' }]);
    (updateComplaintStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...complaintRow, status: 'RESOLVED' });
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('complaint-status-select-complaint-1')).toBeTruthy());

    // Mantine Select's input is a read-only combobox — fireEvent.change on it
    // is silently ignored (same lesson already documented in
    // TreatmentPlanSection.test.tsx). Open it and click the option instead.
    fireEvent.click(within(screen.getByTestId('complaint-status-select-complaint-1')).getByRole('combobox'));
    fireEvent.click(await screen.findByText('تم حلها'));

    await waitFor(() => {
      expect(updateComplaintStatus).toHaveBeenCalledWith('complaint-1', 'RESOLVED');
      expect(listComplaints).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 5: Wire the `/complaints` route into `App.tsx`**

```typescript
import { ComplaintsPage } from './pages/ComplaintsPage';
```

```typescript
          <Route
            path="/complaints"
            element={
              <RequireAuth>
                <AppShell>
                  <ComplaintsPage />
                </AppShell>
              </RequireAuth>
            }
          />
```
(add this `Route` block alongside the existing `/review-queue` one)

- [ ] **Step 6: Add the nav link in `AppShell.tsx`** (visible to all staff roles — no gating, since every role holds `VIEW_COMPLAINT`)

```typescript
        <NavLink component={Link} to="/complaints" label={ar.shell.complaintsLink} />
```
(add this line inside `MantineAppShell.Navbar`, after the `patientsLink` `NavLink` and before the conditional `review-queue` one)

- [ ] **Step 7: Run tests and build**

Run: `cd staff-web && npx vitest run src/pages/ComplaintsPage.test.tsx`
Expected: 4 passed.

Run: `cd staff-web && npm test -- --run`
Expected: all existing tests still pass (no regressions from the `AppShell`/`App.tsx` edits — check for any existing `AppShell.test.tsx` or `App.test.tsx` that asserts an exact nav-link count).

Run: `cd staff-web && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add staff-web/src/pages/ComplaintsPage.tsx staff-web/src/pages/ComplaintsPage.test.tsx staff-web/src/auth/permissions.ts staff-web/src/App.tsx staff-web/src/components/AppShell.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add the complaints page with role-branching data source"
```

---

### Task 4: Admin Reports page

**Files:**
- Create: `staff-web/src/pages/AdminReportsPage.tsx`
- Create: `staff-web/src/pages/AdminReportsPage.test.tsx`
- Modify: `staff-web/src/auth/permissions.ts` (add `canViewAdminReports`)
- Modify: `staff-web/src/App.tsx` (add `/admin-reports` route)
- Modify: `staff-web/src/components/AppShell.tsx` (add nav link, gated on `canViewAdminReports`)
- Modify: `staff-web/src/copy/ar.ts` (add `shell.adminReportsLink`)

**Interfaces:**
- Consumes: `getOperationalStatusReport()`, `getRegisteredUsersReport()`, `getServiceModificationsReport(filter?)`, `getStaffPerformanceReport()`, `getComplaintsReport(filter?)` from Task 1's `staff-web/src/api/reports.ts`; `useAuth()` from `staff-web/src/auth/AuthProvider.tsx`.
- Produces: `canViewAdminReports(role: StaffRole): boolean` in `staff-web/src/auth/permissions.ts`.

- [ ] **Step 1: Add `canViewAdminReports` to `staff-web/src/auth/permissions.ts`**

```typescript
export function canViewAdminReports(role: StaffRole): boolean {
  return role === 'SUPERVISOR' || role === 'ADMIN';
}
```

- [ ] **Step 2: Add `shell.adminReportsLink` to `staff-web/src/copy/ar.ts`** (inside the existing `shell` namespace, alongside `complaintsLink`)

```typescript
    adminReportsLink: 'التقارير الإدارية',
```

- [ ] **Step 3: Write `AdminReportsPage.tsx`**

Each tab fetches its own report lazily on first activation (a `Set<string>` of already-activated tab keys gates the fetch), not eagerly for all 5 on page mount.

```typescript
// staff-web/src/pages/AdminReportsPage.tsx
import { useEffect, useState } from 'react';
import { Container, Title, Tabs, Table, Text, Alert, SimpleGrid, Card, TextInput } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canViewAdminReports } from '../auth/permissions';
import {
  getOperationalStatusReport,
  getRegisteredUsersReport,
  getServiceModificationsReport,
  getStaffPerformanceReport,
  getComplaintsReport,
} from '../api/reports';
import type {
  OperationalStatusReport,
  RegisteredUserSummary,
  ServiceModificationLogEntry,
  StaffPerformanceSummary,
} from '../api/reports';
import type { Complaint } from '../api/complaints';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : ar.errors.unexpected;
}

function OperationalStatusTab() {
  const [report, setReport] = useState<OperationalStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOperationalStatusReport().then(setReport).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!report) return null;

  const groups: Array<{ title: string; data: Record<string, number>; labels: Record<string, string> }> = [
    { title: ar.reports.usersByRoleTitle, data: report.usersByRole, labels: ar.reports.roles },
    { title: ar.reports.patientProfilesByStatusTitle, data: report.patientProfilesByStatus, labels: ar.patients.statuses },
    { title: ar.reports.treatmentPlansByStatusTitle, data: report.treatmentPlansByStatus, labels: ar.reports.planStatuses },
    { title: ar.reports.trainingCyclesByStatusTitle, data: report.trainingCyclesByStatus, labels: ar.reports.cycleStatuses },
  ];

  return (
    <Stack gap="md">
      {groups.map((group) => {
        const nonZeroEntries = Object.entries(group.data).filter(([, count]) => count > 0);
        return (
          <div key={group.title}>
            <Text fw={600} mb="xs">{group.title}</Text>
            {nonZeroEntries.length === 0 ? (
              <Text c="dimmed">{ar.reports.noData}</Text>
            ) : (
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                {nonZeroEntries.map(([key, count]) => (
                  <Card withBorder key={key} data-testid={`stat-${key}`}>
                    <Text size="sm" c="dimmed">{group.labels[key] ?? key}</Text>
                    <Text fw={700} size="lg">{count}</Text>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </div>
        );
      })}
    </Stack>
  );
}

function RegisteredUsersTab() {
  const [rows, setRows] = useState<RegisteredUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRegisteredUsersReport().then(setRows).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (rows === null) return null;
  if (rows.length === 0) return <Text c="dimmed">{ar.reports.noRegisteredUsers}</Text>;

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{ar.reports.fullNameLabel}</Table.Th>
          <Table.Th>{ar.reports.mobileLabel}</Table.Th>
          <Table.Th>{ar.reports.roleLabel}</Table.Th>
          <Table.Th>{ar.reports.statusLabel}</Table.Th>
          <Table.Th>{ar.reports.caseProgressLabel}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.id} data-testid={`registered-user-row-${row.id}`}>
            <Table.Td>{row.fullName}</Table.Td>
            <Table.Td>{row.mobile}</Table.Td>
            <Table.Td>{ar.reports.roles[row.role] ?? row.role}</Table.Td>
            <Table.Td>{ar.patients.statuses[row.status] ?? row.status}</Table.Td>
            <Table.Td>{row.caseProgressSummary}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ServiceModificationsTab() {
  const [rows, setRows] = useState<ServiceModificationLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    getServiceModificationsReport({ from: from || undefined, to: to || undefined })
      .then(setRows)
      .catch((err) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  return (
    <Stack gap="md">
      <Group>
        <TextInput
          data-testid="service-modifications-from"
          type="date"
          label={ar.reports.fromDateLabel}
          value={from}
          onChange={(event) => setFrom(event.currentTarget.value)}
        />
        <TextInput
          data-testid="service-modifications-to"
          type="date"
          label={ar.reports.toDateLabel}
          value={to}
          onChange={(event) => setTo(event.currentTarget.value)}
        />
      </Group>
      {error ? <Alert color="red">{error}</Alert> : null}
      {rows === null ? null : rows.length === 0 ? (
        <Text c="dimmed">{ar.reports.noServiceModifications}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.reports.actionLabel}</Table.Th>
              <Table.Th>{ar.reports.entityLabel}</Table.Th>
              <Table.Th>{ar.reports.actorLabel}</Table.Th>
              <Table.Th>{ar.reports.dateLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.id} data-testid={`service-modification-row-${row.id}`}>
                <Table.Td>{row.action}</Table.Td>
                <Table.Td>{row.entity}</Table.Td>
                <Table.Td>{row.actorFullName}</Table.Td>
                <Table.Td>{formatDate(row.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function StaffPerformanceTab() {
  const [rows, setRows] = useState<StaffPerformanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStaffPerformanceReport().then(setRows).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (rows === null) return null;
  if (rows.length === 0) return <Text c="dimmed">{ar.reports.noStaffPerformance}</Text>;

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{ar.reports.fullNameLabel}</Table.Th>
          <Table.Th>{ar.reports.roleLabel}</Table.Th>
          <Table.Th>{ar.reports.patientsHandledLabel}</Table.Th>
          <Table.Th>{ar.reports.reviewsApprovedLabel}</Table.Th>
          <Table.Th>{ar.reports.reviewsRepeatRequiredLabel}</Table.Th>
          <Table.Th>{ar.reports.complaintsAgainstLabel}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.clinicianUserId} data-testid={`staff-performance-row-${row.clinicianUserId}`}>
            <Table.Td>{row.fullName}</Table.Td>
            <Table.Td>{ar.reports.roles[row.role] ?? row.role}</Table.Td>
            <Table.Td>{row.patientsHandled}</Table.Td>
            <Table.Td>{row.reviewsApproved}</Table.Td>
            <Table.Td>{row.reviewsRepeatRequired}</Table.Td>
            <Table.Td>{row.complaintsAgainst}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ComplaintsReportTab() {
  const [rows, setRows] = useState<Complaint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getComplaintsReport().then(setRows).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (rows === null) return null;
  if (rows.length === 0) return <Text c="dimmed">{ar.complaints.emptyState}</Text>;

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{ar.complaints.typeLabel}</Table.Th>
          <Table.Th>{ar.complaints.subjectLabel}</Table.Th>
          <Table.Th>{ar.complaints.statusLabel}</Table.Th>
          <Table.Th>{ar.complaints.createdAtLabel}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.id} data-testid={`complaints-report-row-${row.id}`}>
            <Table.Td>{ar.complaints.types[row.type]}</Table.Td>
            <Table.Td>{row.subject}</Table.Td>
            <Table.Td>{ar.complaints.statuses[row.status]}</Table.Td>
            <Table.Td>{formatDate(row.createdAt)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function AdminReportsPage() {
  const { user } = useAuth();

  if (!user || !canViewAdminReports(user.role)) {
    return null;
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.reports.adminReportsTitle}</Title>
      <Tabs defaultValue="operationalStatus" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="operationalStatus" data-testid="tab-operationalStatus">{ar.reports.tabs.operationalStatus}</Tabs.Tab>
          <Tabs.Tab value="registeredUsers" data-testid="tab-registeredUsers">{ar.reports.tabs.registeredUsers}</Tabs.Tab>
          <Tabs.Tab value="serviceModifications" data-testid="tab-serviceModifications">{ar.reports.tabs.serviceModifications}</Tabs.Tab>
          <Tabs.Tab value="staffPerformance" data-testid="tab-staffPerformance">{ar.reports.tabs.staffPerformance}</Tabs.Tab>
          <Tabs.Tab value="complaintsReport" data-testid="tab-complaintsReport">{ar.reports.tabs.complaintsReport}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="operationalStatus" pt="md"><OperationalStatusTab /></Tabs.Panel>
        <Tabs.Panel value="registeredUsers" pt="md"><RegisteredUsersTab /></Tabs.Panel>
        <Tabs.Panel value="serviceModifications" pt="md"><ServiceModificationsTab /></Tabs.Panel>
        <Tabs.Panel value="staffPerformance" pt="md"><StaffPerformanceTab /></Tabs.Panel>
        <Tabs.Panel value="complaintsReport" pt="md"><ComplaintsReportTab /></Tabs.Panel>
      </Tabs>
    </Container>
  );
}
```

**Note for the implementer:** this code uses `Stack` and `Group` (in `OperationalStatusTab` and `ServiceModificationsTab`) — add them to the `@mantine/core` import list at the top of the file (`import { Container, Title, Tabs, Table, Text, Alert, SimpleGrid, Card, TextInput, Stack, Group } from '@mantine/core';`).

Mantine's `Tabs` component keeps ALL panels mounted by default (`keepMounted` defaults to `true`) — without `keepMounted={false}` on the `<Tabs>` element (already included above), every tab's `useEffect` would fire on page load and all 5 reports would be fetched eagerly, contradicting the "fetch lazily on first activation" requirement. `keepMounted={false}` makes Mantine only mount the active panel, so each tab's fetch genuinely fires on first activation.

- [ ] **Step 4: Write `AdminReportsPage.test.tsx`**

```typescript
// staff-web/src/pages/AdminReportsPage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AdminReportsPage } from './AdminReportsPage';
import { AuthProvider } from '../auth/AuthProvider';
import {
  getOperationalStatusReport,
  getRegisteredUsersReport,
  getServiceModificationsReport,
  getStaffPerformanceReport,
  getComplaintsReport,
} from '../api/reports';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/reports');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'SUPERVISOR') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getOperationalStatusReport as ReturnType<typeof vi.fn>).mockResolvedValue({
    usersByRole: { PATIENT: 5, CAREGIVER: 0, CLINICIAN: 2, SUPERVISOR: 0, ADMIN: 1 },
    patientProfilesByStatus: { ACTIVE: 4, DISABLED: 1 },
    treatmentPlansByStatus: { ACTIVE: 3, INACTIVE: 0 },
    trainingCyclesByStatus: { WAITING_FOR_SPECIALIST: 2 },
  });
  (getRegisteredUsersReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getServiceModificationsReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getStaffPerformanceReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getComplaintsReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  return render(
    <MantineProvider>
      <AuthProvider>
        <AdminReportsPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminReportsPage', () => {
  it('renders nothing for a CLINICIAN', async () => {
    renderPage('CLINICIAN');
    await waitFor(() => {
      expect(screen.queryByText('التقارير الإدارية')).toBeNull();
    });
  });

  it('SUPERVISOR sees the operational status tab with non-zero stats only', async () => {
    renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByTestId('stat-PATIENT')).toBeTruthy();
      expect(screen.getByTestId('stat-CLINICIAN')).toBeTruthy();
    });
    expect(screen.queryByTestId('stat-CAREGIVER')).toBeNull();
    expect(screen.queryByTestId('stat-SUPERVISOR')).toBeNull();
  });

  it('fetches the registered-users report when its tab is activated', async () => {
    renderPage('ADMIN');
    await waitFor(() => expect(screen.getByTestId('tab-registeredUsers')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tab-registeredUsers'));
    await waitFor(() => {
      expect(getRegisteredUsersReport).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 5: Wire the `/admin-reports` route into `App.tsx`**

```typescript
import { AdminReportsPage } from './pages/AdminReportsPage';
```

```typescript
          <Route
            path="/admin-reports"
            element={
              <RequireAuth>
                <AppShell>
                  <AdminReportsPage />
                </AppShell>
              </RequireAuth>
            }
          />
```

- [ ] **Step 6: Add the gated nav link in `AppShell.tsx`**

```typescript
        {user && canViewAdminReports(user.role) ? (
          <NavLink component={Link} to="/admin-reports" label={ar.shell.adminReportsLink} />
        ) : null}
```
(add this after the `complaints` `NavLink` from Task 3, alongside the existing `canReviewSample`-gated block; also add `canViewAdminReports` to the import from `../auth/permissions`)

- [ ] **Step 7: Run tests and build**

Run: `cd staff-web && npx vitest run src/pages/AdminReportsPage.test.tsx`
Expected: 3 passed.

Run: `cd staff-web && npm test -- --run`
Expected: all tests pass, no regressions.

Run: `cd staff-web && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add staff-web/src/pages/AdminReportsPage.tsx staff-web/src/pages/AdminReportsPage.test.tsx staff-web/src/auth/permissions.ts staff-web/src/App.tsx staff-web/src/components/AppShell.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add the admin reports page with 5 lazily-fetched tabs"
```

---

## Post-plan: final whole-branch review and browser verification

After all 4 tasks are complete and individually reviewed, dispatch a final whole-branch code review (per `superpowers:subagent-driven-development`), fix any findings, then do a real browser click-through verification (login as CLINICIAN and as SUPERVISOR/ADMIN against seeded data; check the Reports section on a patient with an approved assessment, the Complaints page in both role modes, and the Admin Reports page's 5 tabs) before merging to `master`, per the established pattern from every prior staff-web sub-project this session.
