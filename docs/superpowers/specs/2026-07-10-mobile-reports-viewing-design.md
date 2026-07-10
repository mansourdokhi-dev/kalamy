# Mobile Reports Viewing — Design Spec

Sub-project 4/5 of the Kalamy mobile app (Expo/React Native, Arabic-only, RTL), following the completed mobile-foundation (sub-project 1), mobile Treatment Engine screens (sub-project 2), and mobile sample recording flow (sub-project 3) — all merged to master.

## Context

The backend's Reports module (built in an earlier backend-only sub-project, already merged) exposes two patient-scoped, read-only report endpoints — assessment results and a consolidated medical report — both already gated to the `VIEW_PATIENT_REPORTS` permission, already granted to both PATIENT and CAREGIVER roles. Neither has any mobile UI yet. This sub-project wires them up: no backend work at all, purely mobile.

## Scope

**In scope:**
- Mobile: 2 new API client functions (`getAssessmentResultsReport`, `getMedicalReport`) plus their types.
- Mobile: one new screen, `reports.tsx`, with two read-only sections (Assessment Results, Medical Report).
- Home screen integration: a third link added to the existing `linksRow` (alongside Level Content and History), always visible regardless of cycle status.

**Out of scope (Non-Goals):**
- Editing any report data — this screen is permanently read-only.
- PDF export, sharing, or printing.
- Admin-facing reports (operational-status, registered-users, service-modifications, staff-performance, admin complaints-report) — permanently out of scope for this patient/caregiver-facing app.
- Complaints (submit/view) — deliberately deferred to sub-project 5.

## Key Decision Made During Brainstorming

- **No caregiver redaction**: a caregiver viewing a child/teen patient's medical report sees exactly the same full detail (medical history, medications, allergies, referral reason, diagnosis) as the patient themselves would. The backend already returns the same report regardless of which of the two permitted roles requests it, and this sub-project does not add any mobile-side or backend-side restriction on top of that.
- **Screen structure**: one `reports.tsx` screen with two sections (not two separate screens) — both reports are small, read-only, and conceptually "my reports," so one destination avoids proliferating tiny screens for what's fundamentally one navigation entry point.

## 1. Mobile: API Client Additions

Two new functions (exact file placement — `treatmentEngine.ts` vs. a new `reports.ts` — decided during planning, whichever keeps files focused):

```typescript
export function getAssessmentResultsReport(patientProfileId: string): Promise<AssessmentResultsReport> {
  return apiRequest<AssessmentResultsReport>(`/api/v1/reports/patients/${patientProfileId}/assessment-results`, { auth: true });
}

export function getMedicalReport(patientProfileId: string): Promise<MedicalReport> {
  return apiRequest<MedicalReport>(`/api/v1/reports/patients/${patientProfileId}/medical`, { auth: true });
}
```

Types mirror the backend's real response shapes (`backend/src/modules/reports/reports.service.ts`) exactly:

```typescript
export interface AssessmentResultsReport {
  patientProfileId: string;
  assessments: Array<{
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
  }>;
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
    approvedAt: string | null;
  } | null;
  activeTreatmentPlan: {
    id: string;
    phase: string;
    goals: string;
    reviewDate: string;
  } | null;
}
```

(Dates are ISO strings over the wire, matching every other endpoint's convention already established in this codebase — not `Date` objects.)

## 2. Screen: `reports.tsx`

- Fetches both reports in parallel on mount (`Promise.all`), matching Home's established pattern.
- **Title**: "التقارير".
- **Section 1 — Assessment Results** ("نتائج التقييمات"): renders `assessments` sorted most-recent-first by `createdAt` (matching History's convention), each row showing: type (translated: INITIAL/PERIODIC/FINAL), status, severity category, SSI-4 total, and approval date — any null field renders as "-". Empty array renders a plain empty-state line, not an error.
- **Section 2 — Medical Report** ("التقرير الطبي"):
  - Patient's full name.
  - Clinical info fields, each labeled and shown or "-" if null; if `clinicalInfo` itself is `null`, one empty-state line replaces the whole section's fields.
  - Latest approved assessment summary (type, severity, SSI-4 total, approval date) or an empty-state line if `null`.
  - Active treatment plan summary (goals, phase, review date) or an empty-state line if `null`.
- No mutations anywhere on this screen — purely read-only, consistent with sibling read-only screens (History, Sample Result).

## 3. Home Screen Integration

- `mobile/app/home.tsx`'s existing `linksRow` (currently `viewLevelContent` + `viewHistory`) gains a third button: `ar.program.viewReports` → `router.push('/program/reports')`.
- Always visible regardless of cycle status, same as the other two links — a patient can check their reports at any time, not gated behind training progress.

## 4. Copy, Error Handling, Testing

- New `ar.reports` copy namespace: screen title, both section titles, every field label, empty-state messages, and Arabic labels for the `type` enum values (`INITIAL`/`PERIODIC`/`FINAL`) reused consistently across both sections wherever an assessment `type` is shown.
- **Error handling**: a genuine fetch failure (network/auth/permission error) shows `ErrorBanner`. A `null clinicalInfo`, `null latestApprovedAssessment`, `null activeTreatmentPlan`, or empty `assessments` array are all expected empty states rendered as plain text — never routed through `ErrorBanner`.
- **Testing**: one test file for `reports.tsx`, mocking both API functions, asserting real Arabic label rendering for populated data and each of the four empty-state branches independently. No dedicated unit tests for the 2 thin API wrapper functions — verified only through the screen's tests, matching this codebase's established convention for every prior API-function addition.

## Non-Goals

(Restated from Scope, for a single reference point.)
- Editing any report data.
- PDF export/sharing/printing.
- Admin-facing reports.
- Complaints (deferred to sub-project 5).
