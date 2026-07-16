# Staff Web Sub-project 4: Reports & Complaints — Design

## Goal

This is sub-project 4 of the planned 5-part staff-web build (`project_kalamy_staff_web_status` memory). Sub-projects 1 (foundation), 2 (clinical workflow), and 3 (sample review & progress) are done and merged. This project gives staff a UI for the 7 already-shipped backend report endpoints and the Complaints module — both currently reachable only via Swagger/curl.

## Current state (investigated directly)

- **Stack, pinned**: same as prior sub-projects — Vite + React 19.2 + TypeScript, Mantine 9.4.1 exactly, React Router 7 classic `<Routes>`/`<Route>`, plain `apiRequest<T>()` client (no data-fetching library), Vitest 4 + RTL 16 + jsdom, `npm run build` = `tsc -b && vite build` is the only step that type-checks.
- **No `reports.ts` or `complaints.ts` API modules exist yet** in `staff-web/src/api/` — both created from scratch in this project.
- **No reports or complaints pages/routes exist yet.** Current pages: `LoginPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `ChangePasswordPage`, `PatientsPage`, `PatientDetailPage`. Current routes in `App.tsx`: `/`, `/login`, `/forgot-password`, `/reset-password`, `/change-password`, `/patients`, `/patients/:id`. `AppShell.tsx` navbar currently has exactly one `NavLink` ("Patients"), plus (post sub-project-3 merge) a review-queue link gated on `canReviewSample`.
- **`staff-web/src/auth/permissions.ts`** currently has `canEditClinicalData` and `canReviewSample`, one boolean-per-capability function per the established convention. This project adds more in the same style.
- **Card-section pattern** for patient-scoped UI (`TreatmentPlanSection.tsx` et al.): `Card withBorder`, `Title order={3}`, inline `Alert color="red"` for errors, `loadAll()` in a `useEffect` keyed on `patient?.id`, forms gated behind a role-check boolean, plain `useState` (no `@mantine/form`), `data-testid` on interactive rows/forms.
- **Reservation-queue-style global list page precedent**: `ReviewQueuePage.tsx` (sub-project 3) — a standalone route, own nav link gated by role, list with `data-testid="...-row-${id}"` rows, no patient context needed. This is the direct precedent for the global Complaints list page here.

## Backend API surface consumed (all already shipped — no backend changes)

### Reports (`/api/v1/reports/*`, all GET, no Zod DTOs — response shapes are plain TS interfaces in `reports.service.ts`)

| Endpoint | Permission | Scope |
|---|---|---|
| `GET /api/v1/reports/patients/:patientId/assessment-results` | `VIEW_PATIENT_REPORTS` | patient-scoped |
| `GET /api/v1/reports/patients/:patientId/medical` | `VIEW_PATIENT_REPORTS` | patient-scoped |
| `GET /api/v1/reports/operational-status` | `VIEW_ADMIN_REPORTS` | admin, global |
| `GET /api/v1/reports/registered-users` | `VIEW_ADMIN_REPORTS` | admin, global |
| `GET /api/v1/reports/service-modifications?from=&to=` | `VIEW_ADMIN_REPORTS` | admin, global, date-filterable |
| `GET /api/v1/reports/staff-performance` | `VIEW_ADMIN_REPORTS` | admin, global |
| `GET /api/v1/reports/complaints?status=&relatedClinicianUserId=` | `VIEW_ADMIN_REPORTS` | admin, global, filterable |

No generate/PDF/export endpoint exists for any report — every endpoint computes and returns data live on GET. There is no persisted `Report` entity. Response shapes (verbatim field names, from `reports.service.ts`):

```typescript
interface AssessmentResultsReportRow {
  id: string; type: string; status: string;
  ssi4Frequency: number | null; ssi4Duration: number | null;
  ssi4PhysicalConcomitants: number | null; ssi4Total: number | null;
  severityCategory: string | null; approvedAt: string | null; createdAt: string;
}

interface MedicalReport {
  patientProfileId: string; patientFullName: string;
  clinicalInfo: { referralReason: string | null; initialDiagnosis: string | null; medicalHistory: string | null; medications: string | null; allergies: string | null; familyHistory: string | null } | null;
  latestApprovedAssessment: { id: string; type: string; severityCategory: string | null; ssi4Total: number | null; approvedAt: string } | null;
  activeTreatmentPlan: { id: string; phase: string; goals: string; reviewDate: string | null } | null;
}

interface OperationalStatusReport {
  usersByRole: Record<'PATIENT' | 'CAREGIVER' | 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN', number>;
  patientProfilesByStatus: Record<'ACTIVE' | 'DISABLED', number>;
  treatmentPlansByStatus: Record<'ACTIVE' | 'INACTIVE', number>;
  trainingCyclesByStatus: Record<string, number>; // 14 cycle-status keys, zero-filled
}

interface RegisteredUserSummary {
  id: string; fullName: string; mobile: string; role: string; status: string;
  createdAt: string; caseProgressSummary: string; // e.g. "Level name (cycle status)" or "Not started"
}

interface ServiceModificationLogEntry {
  id: string; action: string; entity: string; entityId: string;
  actorFullName: string; actorRole: string; createdAt: string;
}

interface StaffPerformanceSummary {
  clinicianUserId: string; fullName: string; role: string;
  patientsHandled: number; reviewsApproved: number; reviewsRepeatRequired: number; complaintsAgainst: number;
}

// ComplaintsReport reuses the exact Complaint shape below.
```

### Complaints (`/api/v1/complaints`)

| Method | Path | Permission | Body/Query |
|---|---|---|---|
| POST | `/api/v1/complaints` | `SUBMIT_COMPLAINT` | `{ type: 'COMPLAINT'\|'SUGGESTION', subject: string, description: string, relatedClinicianUserId?: string }` |
| GET | `/api/v1/complaints` | `MANAGE_COMPLAINTS` | Query: `status?`, `relatedClinicianUserId?` — global list |
| GET | `/api/v1/complaints/mine` | `VIEW_COMPLAINT` | none — caller's own submitted complaints |
| GET | `/api/v1/complaints/:id` | `VIEW_COMPLAINT` | Service enforces ADMIN/SUPERVISOR see any; others only their own (403 otherwise) |
| PATCH | `/api/v1/complaints/:id/status` | `MANAGE_COMPLAINTS` | `{ status: 'OPEN'\|'REVIEWED'\|'RESOLVED' }` |

```typescript
interface Complaint {
  id: string;
  submittedByUserId: string;
  relatedClinicianUserId: string | null;
  type: 'COMPLAINT' | 'SUGGESTION';
  subject: string;
  description: string;
  status: 'OPEN' | 'REVIEWED' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
}
```

No state-machine guard on status transitions server-side — any status value is accepted on PATCH regardless of current status.

### RBAC role grants relevant to staff-web (CLINICIAN / SUPERVISOR / ADMIN only)

| Permission | CLINICIAN | SUPERVISOR | ADMIN |
|---|---|---|---|
| `SUBMIT_COMPLAINT` | ❌ | ❌ | ❌ |
| `VIEW_COMPLAINT` | ✅ | ✅ | ✅ |
| `MANAGE_COMPLAINTS` | ❌ | ✅ | ✅ |
| `VIEW_PATIENT_REPORTS` | ✅ | ✅ | ✅ |
| `VIEW_ADMIN_REPORTS` | ❌ | ✅ | ✅ |

No staff role holds `SUBMIT_COMPLAINT` (only PATIENT/CAREGIVER do) — staff-web never needs a "submit a complaint" form. CLINICIAN can view complaints (via `/mine` and `:id` where permitted) but never manage/list-all or see admin reports. SUPERVISOR/ADMIN get everything except submit.

## Scope

### In scope

1. **API modules** (new): `staff-web/src/api/reports.ts` (all 7 report fetchers), `staff-web/src/api/complaints.ts` (list, get-by-id, update-status — no create, since no staff role can submit).
2. **Patient-scoped report views** on the Patient Detail Hub: a new `ReportsSection` showing the assessment-results report and the medical report for that patient (`VIEW_PATIENT_REPORTS`, all three staff roles — no gating needed beyond the section existing).
3. **Admin Reports page** (new route `/admin-reports`, SUPERVISOR/ADMIN only): tabbed or stacked view of the five global reports (operational status, registered users, service modifications with date filter, staff performance, complaints report). One page, one nav link, internal navigation between report views (Mantine `Tabs`) rather than five separate routes — these are read-only dashboards a supervisor/admin will flip between in one sitting, and a single page avoids five near-identical route/page/test scaffolds for what's fundamentally one "reports" screen.
4. **Complaints list page** (new route `/complaints`, visible to all three staff roles but content differs): SUPERVISOR/ADMIN see the full global list (`MANAGE_COMPLAINTS`) with a status-update action per row; CLINICIAN sees only their own complaints via `/mine` (`VIEW_COMPLAINT`), read-only. Follows the `ReviewQueuePage` precedent: standalone route, own nav link, `data-testid="complaint-row-${id}"`.
5. **Complaint detail / status-update**: inline on the complaints list page (an expandable row or a status `Select` per row for SUPERVISOR/ADMIN), not a separate detail route — the `Complaint` shape has no nested data worth a dedicated page, and `PATCH .../status` is the only write action.
6. **Permission helpers** in `staff-web/src/auth/permissions.ts`: `canManageComplaints(role)` (SUPERVISOR/ADMIN), `canViewAdminReports(role)` (SUPERVISOR/ADMIN) — following the existing one-function-per-capability convention. `VIEW_PATIENT_REPORTS` and `VIEW_COMPLAINT` need no helper since all three staff roles hold them (same pattern as sub-project 3's progress dashboard, which needed no gating).
7. **Nav wiring**: "الشكاوى" (complaints) link visible to all staff roles; "التقارير الإدارية" (admin reports) link gated on `canViewAdminReports(user.role)`.

### Explicitly out of scope, and why

- **Submitting a complaint from staff-web.** No staff role (`CLINICIAN`/`SUPERVISOR`/`ADMIN`) holds `SUBMIT_COMPLAINT` on the backend — only `PATIENT`/`CAREGIVER` do. Building a submit form here would call an endpoint every staff user gets a 403 from. This is a mobile-app-only feature (and unclear whether it exists there yet — not this project's concern).
- **PDF/export/print of any report.** No backend endpoint exists for this (verified: zero `pdf`/`export` hits in the backend). Out of scope until a backend endpoint is designed.
- **Report history / persisted report list.** There is no `Report` entity — every report is computed live on GET. Nothing to list or version.
- **A generic "report viewer" abstraction shared across all 7 report types.** The 7 shapes are meaningfully different (a flat stats object vs. a list vs. a filterable audit log) — one shared component would need enough conditional branching to be a net loss of clarity. Each gets its own small render block instead, consistent with this codebase's demonstrated preference for concrete code over premature abstraction.
- **Complaint status state-machine enforcement in the frontend** (e.g. disabling "OPEN" once a complaint is RESOLVED). The backend enforces no such constraint (confirmed: any status is PATCH-able regardless of current value) — inventing a frontend-only restriction would contradict the backend's actual behavior and could block a legitimate correction. The `Select` offers all three values unconditionally.
- **A shared frontend permission-enum mirroring the backend's `Permission` enum.** Same reasoning as every prior sub-project — not an existing abstraction in this codebase, and introducing one is a cross-cutting refactor unrelated to this feature.
- **Bundle code-splitting** for the growing JS chunk (already >500kB, pre-existing warning). Unrelated to this feature.

## Architecture details

### `ReportsSection` (patient-scoped, on Patient Detail Hub)

Same `Card withBorder` pattern as `TreatmentPlanSection`. Two independent GETs on mount (`getAssessmentResultsReport(patientId)`, `getMedicalReport(patientId)`), rendered as two sub-blocks within the one card (or two cards — two cards, to keep loading/error state independent per the established one-concern-per-card convention). No write actions — pure display. Visible to all three staff roles (`VIEW_PATIENT_REPORTS` granted to CLINICIAN/SUPERVISOR/ADMIN alike), so no permission gate needed on the section itself, matching `ProgressSection`'s precedent.

- Assessment results: a `<Table>` of rows (type, status, SSI-4 fields, severity, approved/created dates), or an empty-state message if the array is empty.
- Medical report: key-value display of `clinicalInfo` fields (each `—` if null), `latestApprovedAssessment` summary line, `activeTreatmentPlan` summary line (each section showing "لا يوجد" if its parent value is null).

### Admin Reports page (`/admin-reports`, new route + page)

Gated entirely on `canViewAdminReports(user.role)` at the route/page level (render nothing / redirect if false — mirroring how `SampleReviewSection` guards on `canReviewSample`, except here it's a whole page, so the guard lives in the page component itself: `if (!user || !canViewAdminReports(user.role)) return null;`).

Layout: Mantine `Tabs` with 5 tabs, one per report — each tab's content fetches its own report lazily (on first activation, not eagerly for all 5 on page mount, matching the on-demand-fetch precedent set by sample-media playback in sub-project 3). Each tab is its own small component:

- **Operational status**: stat groups (`SimpleGrid` of small `Card`s) per record — role counts, profile-status counts, plan-status counts, cycle-status counts (only non-zero entries rendered as rows, to avoid a 14-row wall of zeroes; a "لا يوجد" fallback if all are zero).
- **Registered users**: a `<Table>` — name, mobile, role, status, created date, case-progress summary.
- **Service modifications**: two `DateInput`s (from/to, both optional) driving a refetch on change, then a `<Table>` of the audit log rows (action, entity, entity id, actor name/role, date).
- **Staff performance**: a `<Table>` — name, role, patients handled, reviews approved, reviews needing repeat, complaints against.
- **Complaints report**: reuses the same row-rendering as the Complaints list page's read-only row (see below) but driven by `getComplaintsReport({status, relatedClinicianUserId})` instead of `listComplaints` — same `Complaint[]` shape, different endpoint/permission (`VIEW_ADMIN_REPORTS` vs `MANAGE_COMPLAINTS`), so it's a thin wrapper passing the same row-renderer a different data source, not a duplicated table.

### Complaints page (`/complaints`, new route + page)

One page, role-branching data source at load time — not two separate pages, since the visual shape (a list of complaint rows) is identical for every role; only the query and the presence of a status-update control differ:

```typescript
const canManage = user ? canManageComplaints(user.role) : false;
const complaints = canManage
  ? await listComplaints({ status: statusFilter })       // MANAGE_COMPLAINTS: SUPERVISOR/ADMIN
  : await listMyComplaints();                              // VIEW_COMPLAINT: CLINICIAN sees only their own
```

Each row: `type` badge (COMPLAINT/SUGGESTION), `subject`, `description` (truncated with a "show more" toggle if long), `status` badge, `createdAt`. For `canManage` rows only: a `Select` bound to `status`, `onChange` calling `updateComplaintStatus(id, newStatus)` then refetching the list (mirroring sub-project 3's refetch-after-mutation fix — apply that lesson here from the start rather than re-discovering it in review). A `status` filter `Select` above the table for the manage view only (`ALL | OPEN | REVIEWED | RESOLVED`), re-querying `listComplaints` on change.

`data-testid="complaint-row-${id}"` and `data-testid="complaint-status-select-${id}"` per row, per the established convention.

## Testing

Vitest + RTL, colocated `*.test.tsx`, `vi.mock()` per API module, provider-wrapped renders, `data-testid` assertions — identical conventions to every prior sub-project. `npm run build` (`tsc -b`) gated at every task boundary in addition to `npm test`.

## Non-goals restated for clarity

Not building in this pass: complaint submission from staff-web (no staff role has the permission), PDF/export of any report (no backend endpoint), a persisted report history (no backend entity), a shared generic report-viewer component, frontend-enforced complaint status state-machine rules, a shared frontend permission enum, bundle code-splitting.
