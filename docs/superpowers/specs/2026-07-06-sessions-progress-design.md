# Kalamy Sessions + Progress — Design

Status: Approved
Date: 2026-07-06

## Context

This is the third backend sub-project for Kalamy, building on the Foundation (AUTH + Patient Profile) and Clinical Core (Assessment + Treatment Plan + Exercise Library), both merged to `master`. It covers **Sessions (SES)** and **Progress (PRO)**, the next step in the recommended build order.

## Source document notes — a major correction mid-design

The official SRS/MVP documents (`FR-008`/`FR-009`, `KALAMY-002` SCR-009) describe "sessions" generically: a clinician schedules an in-person or remote encounter and documents notes/homework afterward — essentially an appointment-booking model. Early drafting of this spec followed that reading.

**The clinical stakeholder (an academic clinician, and the actual designer of the real therapy program) corrected this mid-design**: therapy sessions are **not** clinician-scheduled encounters. They are delivered by the system itself, following a **fixed 30-session curriculum** (a Prolonged-Speech/Camperdown-style stuttering program), where:
- The patient trains against system-delivered content (a cognitive video + questions, a behavioral "SENSE" video + practice examples) for a required number of days (3–7, depending on which of 11 exercise categories the session belongs to — sessions 1–10 require 3 days, 11–14 require 4, 15–20 require 5, 21–25 require 6, 26–30 require 7).
- After that training period elapses, the patient submits their single best practice sample (a video reference/URL) plus self-ratings.
- The clinician reviews the sample and self-ratings and makes the **only** decision that advances the patient: approve (move to the next session) or require a repeat (same session, fresh training period, no attempt limit).

This concrete protocol exists **only** in the tech-partner contract's Appendix 2 (see `docs/KALAMY-CONTRACT-REFERENCE_Presentation_Content_Inspiration.md` §2 for the high-level narrative; the full per-session-category timing table and rating scales were re-extracted from the original contract text for this spec). The official SRS/MVP/Screen-Spec documents describe a materially different (and much simpler) generic scheduling model. **The clinical stakeholder confirmed explicitly that the contract's protocol is the real one to build against** — this is the same kind of divergence already documented for severity scoring in the Clinical Core spec (official docs are generic placeholders; the real clinical IP lives in the contract), not a new pattern.

Because of this correction, **this spec drops the earlier generic "Sessions = clinician-scheduled appointment" and "Progress = ad-hoc ProgressRecord" design** in favor of the fixed-curriculum model below. No code was written against the earlier draft, so there's nothing to revert.

## Scope

**In scope:**
- `SessionTemplate`: the 30 fixed session definitions (session number 1–30, one of 11 categories, cognitive/behavioral video references, required training-duration in days, practice instructions). Stored as **admin/clinician-editable data**, not hardcoded logic — mirrors the Exercise Library's existing pattern, so content changes don't require a deploy. Seeded once to match the real 30-session/11-category table; the exact video content is provided by the company later (fields accept URLs, no media hosting).
- `PatientSession`: one row per **attempt** at a specific session number for a specific patient. Tracks: which template, which attempt number, training start time, submitted sample (video reference), self-ratings, and the clinician's review outcome.
- Server-enforced training-duration gate: a patient cannot submit their sample until the template's required number of days has elapsed since the attempt started — enforced in the API, not just the UI.
- Self-rating fields, with exact bounds taken from the contract: a 0–8 stuttering-severity self-rating (current + expected-next-session, both submitted once at end of training), a 1–9 Camperdown-style task-performance self-rating (once, end of training), and 0–10 client/clinician opinion scores (entered at clinician review time).
- Clinician review action: approve (atomically creates the next `PatientSession` attempt, session number + 1) or require-repeat (atomically creates a new attempt at the same session number). **No retry limit** — confirmed by the clinical stakeholder.
- Starting the program (session 1, attempt 1) requires the patient to have an `ACTIVE` treatment plan, consistent with the existing "no session without an active plan" rule.
- Progress dashboard: a read-only aggregation over a patient's `PatientSession` history — current session number, sessions approved, total attempts, repeated sessions, and days elapsed since starting.
- **Architecture change this sub-project makes**: extract the patient-ownership check (`assertCanAccess`, currently duplicated identically in `PatientsService`, `AssessmentsService`, and `TreatmentPlansService`) into one shared helper, used by the new Sessions/Progress code and by nothing else retroactively (no unrelated refactor of the three existing services). This directly follows the Clinical Core final review's recommendation, made at exactly the point it said to make it (start of the next sub-project) — before a 4th copy gets added.

**Out of scope (deferred, consistent with every prior module's deferral pattern):**
- Actual video upload/storage infrastructure — `sampleVideoUrl` is a plain string reference, same as `Exercise.mediaUrl`.
- Cognitive/behavioral video content itself — the company provides real URLs later; templates accept placeholder/empty values until then.
- Granular daily-practice-attempt telemetry (the contract describes an 8-attempts/day, 1-hour-between-attempts logging table) — this is exercise-player UI telemetry, not backend record-keeping; only the single end-of-training submission is modeled.
- Guardian review of submitted samples — confirmed unnecessary; guardians remain view-only, same as elsewhere.
- The post-session-30 "monthly maintenance video for 6 months" follow-up loop — a distinct, smaller feature for a later pass.
- Automated reminders/notifications.
- Any frontend.

## Architecture

Two new feature modules plus one shared addition:

- `src/common/patient-access/` — the new shared ownership-check helper (see below), used by `sessions` and `progress`.
- `src/modules/sessions/` — `sessions.module.ts`, `.controller.ts`, `.service.ts`, `dto/`. Owns both `SessionTemplate` (admin CRUD) and `PatientSession` (attempt lifecycle: start, submit sample+ratings, clinician review).
- `src/modules/progress/` — `progress.module.ts`, `.controller.ts`, `.service.ts`. A single read endpoint aggregating over `PatientSession`.

No other cross-cutting infrastructure is needed — RBAC guards, session guard, audit interceptor, exception filter, and Zod validation are already global.

### Shared ownership-check extraction

Currently `PatientsService`, `AssessmentsService`, and `TreatmentPlansService` each define an identical private `assertCanAccess(actor, profile)` method (CLINICIAN/SUPERVISOR/ADMIN bypass; PATIENT self-check; CAREGIVER via `GuardianLink`; else deny). This sub-project extracts it into `src/common/patient-access/patient-access.service.ts` — an injectable `PatientAccessService` with one method, `assertCanAccess(actor, profile)`, identical logic, used by the new `SessionsService`/`ProgressService`. **The three existing services are not touched or migrated in this sub-project** — that would be an unrelated refactor of already-shipped, already-reviewed code. The new shared service exists so the 4th and every future copy uses the declarative, hard-to-forget version from day one.

## Data model

Three new Prisma models:

- **SessionTemplate** — id, sessionNumber (Int, 1–30, unique), category (Int, 1–11), cognitiveVideoUrl (String, optional), behavioralVideoUrl (String, optional), trainingDurationDays (Int), instructions (String), createdAt, updatedAt.
- **PatientSession** — id, patientProfileId (FK), treatmentPlanId (FK), sessionTemplateId (FK), attemptNumber (Int, starts at 1), status (enum `IN_TRAINING | SUBMITTED | APPROVED | REPEAT_REQUIRED`), trainingStartedAt (DateTime), sampleVideoUrl (String, optional), sampleSubmittedAt (DateTime, optional), selfSeverityCurrent (Int, 0–8, optional), selfSeverityExpectedNext (Int, 0–8, optional), camperdownPerformanceRating (Int, 1–9, optional), clientOpinionScore (Int, 0–10, optional), clinicianOpinionScore (Int, 0–10, optional), clinicianUserId (FK, optional), reviewNotes (String, optional), reviewedAt (DateTime, optional), createdAt, updatedAt. Never deleted.
- No new model needed for Progress — it's a computed read over `PatientSession`.

## API surface

**Session Templates** (`/api/v1/session-templates`, staff-managed content):
- `POST /`, `GET /`, `GET /:id`, `PUT /:id` — standard CRUD, mirrors the Exercise Library's shape.

**Patient Sessions** (`/api/v1/patients/:patientId/sessions`):
- `POST /start` — creates the first `PatientSession` (sessionNumber 1, attempt 1); requires an `ACTIVE` treatment plan; 409 if a session already exists for this patient.
- `GET /current` — the patient's current (not-yet-approved) attempt.
- `GET /` — full attempt history, ordered by creation.
- `PUT /current/ratings` — patient/caregiver submits/updates their own self-ratings while `IN_TRAINING`: severity current/expected (0–8 each), Camperdown performance (1–9), and `clientOpinionScore` (0–10, the patient's own opinion of their result). 400 if the attempt is no longer `IN_TRAINING` (sample already submitted).
- `POST /current/submit` — submit the sample video URL; 400 if the required training-duration hasn't elapsed yet; sets status `SUBMITTED`.
- `POST /current/review` — clinician-only: records `decision` (`APPROVE | REPEAT`), `reviewNotes`, and `clinicianOpinionScore` (0–10, the clinician's own opinion, separate from the patient's `clientOpinionScore`); atomically creates the next attempt row (next session on approve, same session new attempt on repeat).

**Progress** (`/api/v1/patients/:patientId/progress`):
- `GET /` — aggregated dashboard: `currentSessionNumber`, `sessionsApproved`, `totalAttempts`, `repeatedSessionNumbers`, `daysInProgram`.

## Cross-cutting concerns

- **RBAC**: new permissions `MANAGE_SESSION_TEMPLATES` (CLINICIAN/ADMIN), `VIEW_SESSION_TEMPLATES` (all roles), `START_SESSION`/`SUBMIT_SESSION` (PATIENT/CAREGIVER — a caregiver acts for a linked minor, consistent with existing patterns), `VIEW_SESSION` (all roles, ownership-enforced), `REVIEW_SESSION` (CLINICIAN/ADMIN only), `VIEW_PROGRESS` (all roles, ownership-enforced).
- **Ownership enforcement**: via the new shared `PatientAccessService`, applied to every read/write scoped to a specific patient — the exact gap class fixed in the Clinical Core final review.
- **Audit logging**: automatic via the existing global interceptor.

## Testing approach

Same TDD approach as prior modules: unit tests for pure logic (the training-duration-elapsed check, the shared `PatientAccessService`), integration tests against real Postgres for anything touching the database (e.g., submitting a sample before the training period elapses returns 400; approving an attempt atomically creates the next one; a patient cannot start session 2 by calling `/start` again).

## Non-goals / explicitly deferred

- Video upload/storage infrastructure
- Actual cognitive/behavioral video content
- Granular daily-practice-attempt telemetry
- Guardian review of samples
- Post-session-30 monthly-maintenance follow-up loop
- Automated reminders/notifications
- Any frontend
