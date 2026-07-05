# Kalamy Clinical Core: Assessment + Treatment Plan + Exercise Library — Design

Status: Approved
Date: 2026-07-05

## Context

This is the second sub-project of the Kalamy backend, building on the completed **Foundation** (AUTH + Patient Profile modules, merged to `master`). It covers the three modules the design spec for the Foundation identified as the natural next step: **Assessment (ASM)**, **Treatment Plan (PLAN)**, and **Exercise Library (EX)**.

These three are bundled into one sub-project (rather than three separate ones) because they are tightly coupled in practice: a treatment plan cannot be built without exercises to assign to it, and exercises are only meaningful once filtered by the treatment phase a plan has assigned. Building them separately would mean discovering the coupling mid-way, the same reasoning that bundled AUTH+PAT in the Foundation.

Later sub-projects (Sessions/Progress, Reports, frontends, AI) remain out of scope, per the Foundation spec's recommended build order.

## Source document notes

Feedback on the docs, captured because it shapes this design:

- As with the Foundation, multiple overlapping SRS efforts describe these modules (root `SRS-007` for Assessment specifically; `KALAMY-001_SRS_Part2/Part3` FR-004/FR-005/FR-006/FR-007; `KALAMY-MVP-001` §8 data model and §9 endpoints; `KALAMY-CLINICAL-002/003/004` for the clinical protocol itself). `MVP-001` is treated as the execution-ready subset, same as in the Foundation.
- **Severity scoring**: the SRS/clinical docs describe stuttering severity as a 4-level qualitative outcome (mild/moderate/severe/very severe) based on clinician judgment, with no scoring algorithm. The user (an academic clinician) confirmed the clinic actually uses **SSI-4** (Stuttering Severity Instrument, a real published standardized instrument: three subscores — frequency, duration of the three longest stuttering events, physical concomitants — summed to a total score that maps to a severity category). This design stores the three subscores and total as numbers; the mapping from total score to severity category is **entered by the clinician**, not computed by the system, because the exact published cutoff/percentile tables are proprietary to the instrument's manual and weren't available to hard-code correctly. This is flagged as a known limitation, not silently guessed.
- **Assessment approval workflow**: the SRS assumes a clinician "approves" an assessment (SCR-005's "اعتماد التقييم" button) but never specifies who may approve or whether there's a reject/revise cycle. This design assumes **any user with the approval permission** (not necessarily the assessing clinician) can approve, and there is no reject cycle in this phase — an unapproved assessment can simply be edited and re-submitted.
- **Treatment plan approval**: unlike assessments, the SRS never describes an approval gate for treatment plans themselves — a plan is created and becomes active immediately (supervisor oversight happens via reporting, not a blocking approval). This design follows that reading.
- **Phase transitions**: `KALAMY-CLINICAL-004` explicitly defers "minimum success indicators" for exiting a phase to clinical judgment, not an automatable formula. This design treats a phase transition as a **clinician-recorded decision** (with an optional rationale note), not a system-computed eligibility check.
- **Re-assessment scheduling**: no interval or auto-trigger is specified anywhere. This design treats re-assessment as **manual/clinician-initiated**, consistent with the Foundation's decision to defer notifications/automation.
- **Exercise taxonomy**: `Category` and `Level` fields are named in `MVP-001` §8 but never enumerated. This design treats `Category` as free text (clinician/admin-authored, no fixed list) and `Level` as the treatment phase number (1–5) the exercise is intended for.
- Referenced companion documents `KALAMY-003` (Database Dictionary) and `KALAMY-004` (API Specification) still don't exist, same gap noted in the Foundation spec.

## Scope

**In scope:**
- Assessment: create/view/list per patient, SSI-4 subscores + total + clinician-assigned severity category, free-text clinical fields (history, difficult situations, anxiety level, initial goals, clinician notes), approval action, baseline comparison (diffing a re-assessment against the patient's first approved assessment)
- Treatment Plan: create (requires an approved assessment), view, update (goals/review date), single-active-plan-per-patient enforcement (creating a new plan deactivates the prior one — never deleted), 5-phase model with clinician-recorded phase transitions
- Exercise Library: create/view/list/archive exercises (title, category, phase level, instructions, media URL, duration), archive-not-delete when in use by an active plan
- Plan–Exercise linking: assign an exercise to a plan with frequency (times/week) and sequence (order), filtered-by-phase browsing
- RBAC extension: new permissions for these actions, following the existing `Permission`/`ROLE_PERMISSIONS` pattern (Foundation Task 4)
- Audit logging: reuses the existing global `AuditInterceptor` from the Foundation — no new interceptor needed, since it's already wired at the app level

**Out of scope (later sub-projects):**
- Therapy session execution and video/audio capture during exercises (Sessions module, SES)
- Progress dashboards, completion-rate analytics, reports (PRO/REP modules)
- Automated re-assessment reminders or phase-transition eligibility computation
- The exact SSI-4 total-score-to-severity-category cutoff table (deferred until the clinic provides the published table; the clinician assigns the category manually until then)
- Any frontend
- Media storage/upload infrastructure for exercise videos (this design stores a `mediaUrl` string; actual file upload/hosting is deferred, same as the Foundation deferred real SMS sending)

## Architecture

Extends the existing NestJS app (`backend/`) with three new feature modules mirroring the established pattern from `auth`/`patients`:

- `src/modules/assessments/` — `assessments.module.ts`, `.controller.ts`, `.service.ts`, `dto/`
- `src/modules/treatment-plans/` — same shape
- `src/modules/exercises/` — same shape, plus plan-exercise linking endpoints living on the treatment-plans controller (since a link is scoped to a specific plan)

No new cross-cutting infrastructure is needed — RBAC guards, the session guard, the audit interceptor, the global exception filter, and Zod validation piping are all already wired at the `AppModule` level and apply automatically to every new controller.

## Data model

Four new Prisma models, added to the existing `schema.prisma`:

- **Assessment** — id, patientProfileId (FK), clinicianUserId (FK to User), type (`INITIAL | PERIODIC | FINAL` enum), status (`DRAFT | APPROVED` enum), medicalHistory, difficultSituations, anxietyLevel, initialGoals, clinicianNotes (all text, nullable except where required), ssi4Frequency, ssi4Duration, ssi4PhysicalConcomitants, ssi4Total (numeric subscores), severityCategory (`MILD | MODERATE | SEVERE | VERY_SEVERE` enum, clinician-assigned), approvedAt, createdAt, updatedAt. Never deleted.
- **TreatmentPlan** — id, patientProfileId (FK), clinicianUserId (FK), assessmentId (FK to the approved Assessment it's based on), phase (`PHASE_1`..`PHASE_5` enum), goals (text), reviewDate, status (`ACTIVE | INACTIVE` enum, defaults `ACTIVE`), createdAt, updatedAt. Never deleted — creating a new plan for a patient sets the prior plan's status to `INACTIVE` inside the same transaction.
- **PhaseTransition** — id, treatmentPlanId (FK), fromPhase, toPhase (both the phase enum), clinicianUserId (FK), rationale (text, optional), createdAt. An append-only log of phase changes; the plan's current `phase` field is updated at the same time.
- **Exercise** — id, title, category (text), phaseLevel (1–5 int), instructions (text), mediaUrl (text, optional), durationMinutes (int), status (`ACTIVE | ARCHIVED` enum), createdByUserId (FK), createdAt, updatedAt.
- **PlanExercise** — id, treatmentPlanId (FK), exerciseId (FK), frequencyPerWeek (int), sequence (int), createdAt. `@@unique([treatmentPlanId, exerciseId])`.

All FKs to `PatientProfile`/`User` reuse the existing models from the Foundation; nothing about those models changes.

## API surface

**Assessments** (`/api/v1/patients/:patientId/assessments`):
- `POST /` (create, status `DRAFT`), `GET /` (list, newest first), `GET /:id`, `PUT /:id` (edit while `DRAFT`), `POST /:id/approve` (sets status `APPROVED`, `approvedAt`)
- `GET /:id/baseline-comparison` — diffs this assessment's SSI-4 numbers against the patient's first approved assessment

**Treatment Plans** (`/api/v1/patients/:patientId/treatment-plans`):
- `POST /` (requires an approved assessment; deactivates prior active plan), `GET /` (list), `GET /active` (the current active plan), `PUT /:id` (goals/review date)
- `POST /:id/phase-transition` (records a `PhaseTransition`, updates `phase`)
- `POST /:id/exercises` (link an exercise: exerciseId, frequencyPerWeek, sequence), `GET /:id/exercises`, `DELETE /:id/exercises/:exerciseId` (unlink, not an exercise delete)

**Exercises** (`/api/v1/exercises`):
- `POST /` (create), `GET /?phase=&category=` (filtered list), `GET /:id`, `PUT /:id`, `PATCH /:id/status` (archive — blocked if referenced by any `PlanExercise` row belonging to an `ACTIVE` plan)

## Cross-cutting concerns

- **RBAC**: new `Permission` values (`CREATE_ASSESSMENT`, `APPROVE_ASSESSMENT`, `VIEW_ASSESSMENT`, `CREATE_TREATMENT_PLAN`, `EDIT_TREATMENT_PLAN`, `MANAGE_EXERCISES`, `VIEW_EXERCISES`) added to the existing `ROLE_PERMISSIONS` map. Following the Foundation's pattern: CLINICIAN and ADMIN get the create/approve/manage permissions; PATIENT/CAREGIVER get view-only on their own linked profile's assessments/plans (ownership enforced in the service layer, same `assertCanAccess` pattern as `PatientsService`); SUPERVISOR gets view-only across all patients (oversight, no approval gate — matches the "no explicit approval" reading for plans).
- **Audit logging**: automatic via the existing global interceptor — no new work needed, though note this means assessment clinical notes/SSI-4 scores will be logged the same way patient PHI already is (tracked as the existing open PHI-audit-log policy decision from the Foundation, not re-solved here).
- **Errors**: reuses the existing global exception filter and `{ code, message, details }` shape.

## Testing approach

Same TDD approach as the Foundation: unit tests for pure logic (phase-transition state machine, single-active-plan enforcement logic), integration tests against a real Postgres (via the same `docker-compose.yml` already in `backend/`) for anything touching the database — e.g., creating a plan without an approved assessment returns 400, creating a second plan deactivates the first, archiving an in-use exercise is blocked.

## Non-goals / explicitly deferred

- SSI-4 total-to-severity-category automated mapping (needs the published cutoff table)
- Session execution, video capture, progress analytics, reports (later sub-projects)
- Automated re-assessment reminders or phase-transition eligibility computation
- Exercise media upload/hosting infrastructure
- Any frontend
