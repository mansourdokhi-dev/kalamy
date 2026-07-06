# Kalamy Reports + Complaints — Design

Status: Approved
Date: 2026-07-06

## Context

This is the fourth backend sub-project for Kalamy, building on the Foundation (Auth + Patient Profile), Clinical Core (Assessment + Treatment Plan + Exercise Library), and Sessions + Progress modules, all merged to `master`. It covers **Reports (REP)** and a small new **Complaints** feature the Reports module depends on.

## Source document notes — same divergence pattern as Sessions

The official docs (`KALAMY-MVP-001` §6/§8/§9, `KALAMY-002` SCR-011) describe Reports as a single generic "progress report" — a report-type dropdown (no enumerated options), a date range, and a PDF export button, backed by a minimal `Reports` table (`ReportID, PatientID, ReportType, GeneratedBy, FileURL, CreatedAt`) and one endpoint (`GET /api/v1/reports/{patientId}`). `SRS-003` FR-011 additionally states approved reports are immutable with new versions on update, but no version/approval fields exist in the MVP-001 data model — an internal gap in the official docs themselves.

The tech-partner contract (previously catalogued in `docs/KALAMY-CONTRACT-REFERENCE_Presentation_Content_Inspiration.md`, admin-reports section referenced from the original contract text) names **9 specific report types**: assessment results, an auto-generated medical report, portal operational status, registered-visitor report, unregistered-visitor report, service-modification log, subscriber complaints/suggestions, clinician-and-supervisor performance (cross-referenced with complaints), and a financial/subscriptions report.

**The clinical stakeholder confirmed (2026-07-06) the contract's 9-report list is the real target**, the same divergence pattern already established for the Foundation's severity scoring and the Sessions module's actual protocol. Three of the nine are explicitly deferred, for reasons specific to each (not simply "too much work"):
- **Unregistered-visitor report**: requires anonymous pre-registration web-analytics tracking, a fundamentally different concern from this backend's patient/clinical data model — likely belongs to a marketing site, not this API, and is deferred pending a product decision on whether it belongs here at all.
- **Financial/subscriptions report**: requires a payments/subscriptions module, which doesn't exist anywhere in this codebase or its docs — already flagged as the single biggest scope gap when the tech-partner contract was first compared against the project's specs.
- The **complaints/suggestions report** is *not* deferred — the stakeholder asked for a minimal complaints-submission feature to be built alongside it specifically so this report has real data to draw from.

## Scope

**In scope — 7 reports, all computed on-demand from existing data (no PDF rendering/file storage — consistent with every prior module's decision to defer real media/file infrastructure):**

1. **Assessment Results Report** (patient-scoped) — a patient's assessment history: type, SSI-4 subscores/total, clinician-assigned severity category, approval date.
2. **Medical Report** (patient-scoped) — a structured summary combining the patient's clinical profile (`PatientClinicalInfo`), their latest approved assessment, and their current treatment plan's phase/goals. This is the "auto-generated medical report" the contract describes — "auto-generated" here means computed on request from existing data, not a separately-triggered background job.
3. **Portal Operational Status Report** (system-wide, staff-only) — aggregate counts: total users by role, active vs. disabled patient profiles, active treatment plans, in-progress vs. completed session attempts.
4. **Registered Users Report** (system-wide, staff-only) — the list of registered users with role, registration date, account status, and (for patients) a one-line case-progress summary. This reinterprets the contract's "visitor" framing as *registered platform users*, not anonymous web visitors (see deferral note above) — an explicit, deliberate scope translation, not a literal implementation of the contract's wording.
5. **Service Modification Log Report** (system-wide, staff-only) — a filtered, formatted view over the existing `AuditLog` table (date range, action, entity, actor). No new data model — this report is a read shape over data that already exists specifically to support this kind of thing.
6. **Clinician & Supervisor Performance Report** (system-wide, staff-only) — per-clinician aggregates: patients handled, session reviews performed (approve vs. repeat counts), cross-referenced with the count of complaints filed against that clinician.
7. **Complaints & Suggestions Report** (system-wide, staff-only) — the list of submitted complaints/suggestions, filterable by status and by the clinician they reference.

**New minimal Complaints feature** (not a report — the data source for report #7 and an input to report #6):
- A patient or caregiver can submit a complaint or suggestion, optionally naming the clinician it concerns.
- Staff (ADMIN/SUPERVISOR) can list/filter complaints and update their status (`OPEN → REVIEWED → RESOLVED`).
- No escalation workflow, no notifications, no threaded replies — deliberately minimal, exactly enough to make report #7 and #6 meaningful.

**Out of scope (deferred):**
- Unregistered-visitor analytics report (needs web-analytics infrastructure, product-scope question).
- Financial/subscriptions report (needs a payments module that doesn't exist).
- Real PDF generation and file storage/hosting for any report.
- Report versioning/approval workflow (the official docs' FR-011 rule) — reports here are always-fresh computed views, not stored/approved documents, so "immutable approved version" doesn't apply; if the business later needs official, signed-off report documents, that's a distinct feature built on top of this.
- Any notification/escalation workflow for complaints.
- Any frontend.

## Architecture

Two new feature modules:

- `src/modules/complaints/` — `complaints.module.ts`, `.controller.ts`, `.service.ts`, `dto/`. Standalone CRUD (create, list/filter, get, update-status).
- `src/modules/reports/` — `reports.module.ts`, `.controller.ts`, `.service.ts`. Each report is a method on `ReportsService` reading existing tables directly via `PrismaService` (matching the established pattern of `ProgressService` querying `PatientSession` directly rather than going through `PatientSessionsService`), not by importing other feature services, to keep this module a pure read layer with no cross-module service coupling.

No other new cross-cutting infrastructure — RBAC guards, the session guard, the shared `PatientAccessService` (from the Sessions+Progress sub-project), and the audit interceptor are already in place and reused.

## Data model

One new Prisma model:

- **Complaint** — id, submittedByUserId (FK User), relatedClinicianUserId (FK User, optional), type (enum `COMPLAINT | SUGGESTION`), subject (String), description (String), status (enum `OPEN | REVIEWED | RESOLVED`, default `OPEN`), createdAt, updatedAt. Never deleted.

No new model for Reports — every report is computed from `User`, `PatientProfile`, `PatientClinicalInfo`, `Assessment`, `TreatmentPlan`, `PatientSession`, `AuditLog`, and the new `Complaint` table.

## API surface

**Complaints** (`/api/v1/complaints`):
- `POST /` — patient/caregiver submits (type, subject, description, optional relatedClinicianUserId)
- `GET /` — staff lists/filters (by status, by relatedClinicianUserId)
- `GET /:id` — staff or the original submitter views one
- `PATCH /:id/status` — staff updates status

**Reports** (`/api/v1/reports/...`):
- `GET /patients/:patientId/assessment-results` — report #1
- `GET /patients/:patientId/medical` — report #2
- `GET /operational-status` — report #3
- `GET /registered-users` — report #4
- `GET /service-modifications?from=&to=` — report #5
- `GET /staff-performance` — report #6
- `GET /complaints` — report #7 (distinct from the Complaints module's own `GET /api/v1/complaints` — this one returns the same underlying data shaped as a report; see Non-goals note below on why this isn't consolidated)

**Note on the two `/complaints`-ish endpoints**: `/api/v1/complaints` (Complaints module) is the operational CRUD surface staff use to triage individual complaints. `/api/v1/reports/complaints` (Reports module) is a read-only reporting view (e.g., could add aggregation/grouping later without touching the CRUD surface). Keeping them separate follows the same reasoning as `ProgressService` not reusing `PatientSessionsService.listHistory()` in the prior module — a report's read shape is allowed to diverge from an operational list endpoint's shape.

## Cross-cutting concerns

- **RBAC**: new permissions — `SUBMIT_COMPLAINT` (PATIENT/CAREGIVER), `MANAGE_COMPLAINTS` (ADMIN/SUPERVISOR — covers list/get/update-status), `VIEW_PATIENT_REPORTS` (all 5 roles, ownership-enforced via the existing `PatientAccessService` for reports #1-2), `VIEW_ADMIN_REPORTS` (ADMIN/SUPERVISOR only — covers reports #3-7, matching the contract's framing of these as admin-portal/oversight functions, not clinician day-to-day tools).
- **Ownership enforcement**: reports #1-2 use `PatientAccessService.assertCanAccess`, same as every patient-scoped endpoint since the Sessions+Progress sub-project.
- **Audit logging**: the existing global interceptor covers `Complaint` mutations automatically; report endpoints are all `GET` (non-mutating) and are not audit-logged, consistent with the interceptor only firing on POST/PUT/PATCH/DELETE.
- **PHI-in-audit-log**: the service-modifications report (#5) surfaces `AuditLog` rows, which per the still-open Clinical Core policy decision may contain unredacted PHI. This report does not make that situation better or worse — it's a read view over already-existing data — so it's not this sub-project's job to resolve; noted for whoever picks up that decision.

## Testing approach

Same TDD approach as prior modules: e2e tests against a real Postgres for every report (seed data across the relevant tables, assert the computed shape), unit/e2e tests for the Complaints CRUD, and a final smoke test walking through submitting a complaint and seeing it surface in both the Complaints list and the staff-performance/complaints reports.

## Non-goals / explicitly deferred

- Unregistered-visitor analytics report
- Financial/subscriptions report
- Real PDF generation and file storage
- Report versioning/approval workflow
- Complaint escalation, notifications, threaded replies
- Any frontend
