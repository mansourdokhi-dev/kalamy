# Staff Web App — Clinical Workflow (Sub-project 2) — Design Spec

## Context

This is sub-project 2 of the staff-facing web app project. Sub-project 1 (foundation — login, forced password-change, app shell, read-only patient search) is complete and merged to master. The backend already has full REST functionality for patient profiles, assessments, and treatment plans, built in earlier backend sub-projects — this sub-project adds the staff-web screens to use it, plus two small backend additions discovered to be missing during scoping.

Per the project decomposition (`docs/superpowers/specs/2026-07-11-staff-web-foundation-design.md`), this sub-project covers: **patient profile view/edit, assessment creation/approval, treatment plan management.**

## Backend API inventory (as found)

- **Patients** (`api/v1/patients`): create, `GET /me`, `GET /:id`, search (`?q=`), `PUT /:id` (currently only `fullName`/`address`/`referralSource`), `POST /:id/guardian`, `PATCH /:id/status` (enable/disable).
- **Assessments** (`api/v1/patients/:patientId/assessments`): create (bare draft, `type` only), list, get, `PUT /:id` (clinical/SSI-4 fields, only while `status=DRAFT`), `POST /:id/approve` (sets `severityCategory`, one-way `DRAFT`→`APPROVED`), `GET /:id/baseline-comparison`.
- **Treatment Plans** (`api/v1/patients/:patientId/treatment-plans`): create (requires an `APPROVED` assessment; auto-deactivates any prior active plan), list, `GET /active`, `PUT /:id` (goals/reviewDate), `POST /:id/phase-transition`, exercise linking (`POST`/`GET`/`DELETE` on `/:id/exercises`).
- **Permissions**: Clinician and Admin have identical write access across all three modules (`CREATE_*`, `EDIT_*`, `APPROVE_ASSESSMENT`, `DISABLE_PATIENT_PROFILE`, `LINK_GUARDIAN`). Supervisor has view-only permissions (`VIEW_PATIENT_PROFILE`, `VIEW_ASSESSMENT`, `VIEW_TREATMENT_PLAN`, `SEARCH_PATIENTS`) and no write access anywhere in this scope.
- **Treatment Engine v2** (`api/v1/patients/:patientId/cycles`, `api/v1/levels`) is a structurally separate module (cycle/level/sample-review state) that sits underneath a `TreatmentPlan` but is not part of this sub-project — it belongs to sub-project 3 ("Sample review & progress").

## Scope decisions from brainstorming

- **Clinical info becomes editable.** Today `PatientClinicalInfo` (`referralReason`, `initialDiagnosis`, `medicalHistory`, `medications`, `allergies`, `familyHistory`) can only be set once, at patient registration — there's no update path. The founder confirmed clinicians should be able to edit this after registration, so this sub-project adds that capability to the backend.
- **Patient search response gets slimmed.** The existing `GET /api/v1/patients?q=` endpoint returns the full patient record — including `clinicalInfo` (diagnosis, medications, allergies) — for every one of up to 50 results, with no lightweight summary DTO. Since this sub-project is already touching the `patients` module, this data-minimization fix (a dedicated search-result DTO with no clinical fields) is bundled in rather than deferred.
- **One Patient Detail Hub, not three separate flows.** A single route (`/patients/:id`) with Profile / Assessments / Treatment Plan sections, all sharing one loaded patient record. Reached by making sub-project 1's search-results rows clickable. Rejected alternatives: separate top-level pages per module (forces re-picking the same patient repeatedly) and a drawer/modal over the search list (breaks deep-linking to a specific patient's chart).
- **No supervisor approval workflow.** Assessment approval and treatment-plan creation remain single-clinician actions, matching the backend's current one-way `DRAFT`→`APPROVED` model and Supervisor's read-only permission set. Adding a second-reviewer sign-off step would be net-new backend business logic, not a UI concern, and is out of scope here.
- **Treatment Engine v2 (cycles/levels/sample review) is explicitly out of scope.** It's a separate module/controller from the classic `TreatmentPlan` (goals/phase/exercises) this sub-project covers, and belongs to sub-project 3.

## Architecture

Builds on the existing `staff-web/` app (Vite + React + TypeScript + Mantine + React Router, from sub-project 1). No new libraries. New API client modules (`assessments.ts`, `treatment-plans.ts`) alongside the existing `patients.ts`, following the established `apiRequest`/`ApiError` pattern. A new `PatientDetailProvider` (mirroring the mobile app's `PatientProfileProvider` pattern) loads the patient record once per `/patients/:id` visit and is shared by all three sections, avoiding three separate fetches of the same patient.

### Backend changes

1. **`backend/src/modules/patients/`**: extend `UpdatePatientDto` with an optional nested `clinicalInfo` object (all fields optional); `PatientsService.update()` upserts `PatientClinicalInfo` when the field is present. `GET`/`PUT` responses continue to include the full nested `clinicalInfo` as they do today.
2. **`backend/src/modules/patients/`**: add `PatientSearchResultDto` (`id`, `fullName`, `nationalId`, `gender`, `dateOfBirth`, `status` — no `clinicalInfo`) and have the search endpoint's controller/service map to it before returning. `GET /:id` and `GET /me` are unaffected (they still return the full profile with `clinicalInfo`, which the Detail Hub's Profile section needs).

### Screens

- **Patient Detail Hub** (`/patients/:id`) — a page-level header (name, national ID, status badge) with three sections rendered together (not routed sub-tabs, to keep this sub-project's scope to straightforward sections rather than nested routing):
  - **Profile**: read view of all fields including clinical info; an Edit button opens a form (all `UpdatePatientDto` fields, now including the clinical-info block) that calls the extended `PUT`. A status toggle button (Disable/Enable) calls `PATCH /:id/status`. A "Link Guardian" action (form: guardian mobile number) calls `POST /:id/guardian`, shown only when relevant (patient has no guardian yet) — this mirrors the backend's existing validation, it does not duplicate the under-18 rule client-side.
  - **Assessments**: table of the patient's assessments (type, status, created date) sorted newest-first. "New Assessment" button → choose `type` (Initial/Periodic/Final) → creates a `DRAFT` → immediately opens the intake form (medical history, difficult situations, anxiety level, initial goals, clinician notes, SSI-4 frequency/duration/physical-concomitants/total) which calls `PUT` to save while still `DRAFT`. An "Approve" button (visible only on `DRAFT` assessments) opens a small dialog to pick `severityCategory` and calls `POST /:id/approve`. Once more than one `APPROVED` assessment exists for the patient, a baseline-comparison view (calling `GET /:id/baseline-comparison`) shows current vs. baseline SSI-4 totals and the delta.
  - **Treatment Plan**: shows the current active plan (`GET /active`, 404 tolerated as "no active plan") — goals, phase, review date, linked exercises table. "New Plan" button requires picking one of the patient's `APPROVED` assessments from a dropdown, then goals + review date, calling `POST`. A "Transition Phase" action (pick target `PHASE_1`.."PHASE_5" + optional rationale) calls the phase-transition endpoint. An exercise-linking widget lists the exercise catalog (via the existing Exercises module's list endpoint) with an "Add to plan" action (frequency 1-21/week, sequence) and a remove action on already-linked exercises. A collapsible "Past Plans" list shows plan history.
  - All write actions (edit, disable/enable, link guardian, create/edit/approve assessment, create/edit plan, phase-transition, exercise link/unlink) are hidden — not just disabled — for Supervisor, based on the same permission-derived role check pattern already used for the "Patients" nav link in the app shell.

### Data flow & error handling

Same conventions as sub-project 1: a typed `ApiError` from the shared `apiRequest` client, surfaced via Mantine notifications; Mantine loading/skeleton primitives for in-flight requests; forms use Mantine's form hook with client-side required-field validation matching each DTO's required fields (server remains the source of truth — client validation is a UX convenience, not a substitute).

### RTL & copy

All new user-facing strings go into `staff-web/src/copy/ar.ts` under new namespaces (`patientDetail`, `assessments`, `treatmentPlan`), following the existing convention — no inline strings in components.

### Testing

Vitest + React Testing Library, mirroring sub-project 1: mocked API modules, real-string assertions, TDD per task. Every task gated on `npx tsc -b --noEmit` and `npm run build` in addition to `npm test`, per the Mantine-version-drift lesson from sub-project 1 (Vitest does not type-check).

## Out of scope for this sub-project

- Treatment Engine v2 (cycles, levels, sample submission/review, progress dashboards) — sub-project 3.
- Any supervisor/second-reviewer approval workflow — would require new backend business logic, not requested.
- Reports, complaints management — sub-project 4.
- Staff account management, clinician-supervisor assignment — sub-project 5.
- Pagination on patient search beyond the existing 50-result cap (unchanged from sub-project 1).
- Nested client-side routing for the three Detail Hub sections (they render together on one page; if the page grows unwieldy in a later sub-project, splitting into routed tabs is a reasonable follow-up, not needed now).
