# §98 Return-After-Long-Inactivity Fix — Design

Status: Approved (brainstormed with the founder 2026-07-14 — one scope question resolved below)
Date: 2026-07-14

## Context

The gap analysis (`docs/superpowers/specs/2026-07-13-gap-analysis-corrected-spec.md`, section 7) flagged §98 as "partial, needs direct verification." Direct code inspection this session confirmed it's worse than partial: it's a dead end.

`TrainingCyclesService.getCurrent` (`backend/src/modules/treatment-engine/training-cycles.service.ts:116`) correctly marks a cycle `CLOSED_DUE_TO_INACTIVITY` once 30 days pass with no qualifying activity. But two things are missing:

1. **No path back exists.** After that closing read, `getCurrent`'s query (`where: { patientProfileId, closedAt: null }`) matches zero rows on every subsequent call, so it throws `NotFoundException` forever. `startFirstCycle` (`training-cycles.service.ts:34`) — the only place that ever creates a cycle outside of a specialist decision — refuses if the patient has **any** cycle at all, regardless of status, so it can't be used to recover either.
2. **The mobile app's own messaging contradicts what little UI exists.** `mobile/app/home.tsx:160` already shows *"توقف برنامجك بسبب عدم النشاط — تواصل مع عيادتك لاستئنافه"* ("Your program stopped due to inactivity — contact your clinic to resume it") when it sees `CLOSED_DUE_TO_INACTIVITY` — but that status is only visible on the exact read that performs the closure. Every read after that gets the 404 above, which the app's `cycleNotFound` branch (`home.tsx:133`) treats as "never started," showing a `"ابدأ برنامجي"` (Start Program) button that would 409 if tapped, since `startFirstCycle` blocks it.

## Scope decision made with the founder (2026-07-14)

**Restart is clinician-initiated, not patient self-service.** This matches the existing "contact your clinic" copy and is the clinically appropriate call for a stuttering-therapy app — a long absence may mean the patient's condition changed, and a clinician should be the one to decide a fresh Level-1 path is appropriate. `START_CYCLE` (patient/caregiver's permission for the *very first* cycle ever) is untouched and stays exactly as restrictive as it is today; patients can never trigger a restart themselves.

Rejected alternative: requiring a brand-new `TreatmentPlan`/re-assessment before restart. More clinically thorough, but nothing in §98 demands it, and the existing re-assessment machinery is scoped to the normal end-of-treatment loop, not an inactivity return. Kept as a possible future tightening, not built now.

## Fix 1: clinician-initiated restart endpoint

New endpoint: `POST /api/v1/patients/:patientId/cycles/restart-after-inactivity`

New permission `RESTART_CYCLE`, granted only to `CLINICIAN` (same tier as `CREATE_TREATMENT_PLAN`/`REVIEW_SAMPLE` — `SUPERVISOR` doesn't get it; supervisors don't take direct patient-treatment actions anywhere else in this codebase, only oversight/transfer ones).

`TrainingCyclesService.restartAfterInactivity(patientProfileId, actor)`:
1. Load the patient's most recent cycle (`findFirst`, `orderBy: { createdAt: 'desc' }`). If none exists, or its status isn't `CLOSED_DUE_TO_INACTIVITY`, throw `ConflictException` ("Patient does not have a cycle closed due to inactivity").
2. Look up the patient's active `TreatmentPlan` (`status: 'ACTIVE'`) — reused as-is, no new plan or assessment created. If none exists, throw `ConflictException` (shouldn't be reachable in practice since a cycle can't exist without a plan, but guards the invariant).
3. Resolve the first `ACTIVE` level + its published version, the same lookup `startFirstCycle` already does — extracted into a small shared private helper (`resolveFirstLevel()`) on `TrainingCyclesService` so the logic isn't duplicated.
4. Create a new `TrainingCycle72h`: same `patientProfileId`, the active plan's id, the first level/version, `cycleNumber: 1` (a fresh path starts its level-1 attempt count at 1, exactly like `startFirstCycle` does).
5. No manual `AuditLog` call is needed: `AuditInterceptor` (`backend/src/app.module.ts:45`, `common/audit/audit.interceptor.ts`) is registered globally via `APP_INTERCEPTOR` and already audits every mutating (`POST`/`PUT`/`PATCH`/`DELETE`) request automatically — entity `"trainingcycles"` (derived from `TrainingCyclesController`), `entityId` from the new cycle's `id` in the response body, `before`/`after` from the request/response bodies. This is a correction from an earlier draft of this spec, which assumed a manual `auditLog.create` call (the pattern used in `specialist-review.service.ts:210,320` for actions that happen *inside* a transaction without being the endpoint's direct response) was needed here — it isn't, since this is a plain new top-level endpoint.
6. Return the new cycle.

The old cycle is left untouched — `listHistory` (`GET /api/v1/patients/:patientId/cycles`, unchanged) already returns every cycle for the patient ordered by `createdAt` ascending, so the prior path's full record remains visible with no additional work.

## Fix 2: `getCurrent` stops 404ing after closure

Change `getCurrent`'s lookup: first try the existing `{ patientProfileId, closedAt: null }` query (and run the existing inactivity-closure check against it, unchanged). If that finds nothing, fall back to the single most recent cycle overall (`orderBy: { createdAt: 'desc' }`, no `closedAt` filter) and return it instead of throwing. Only throw `NotFoundException` if the patient has never had any cycle at all (both queries empty) — the genuine "never started" case, which still correctly drives the mobile app's existing "Start Program" button.

This is a pure widening of what's returned; nothing about the inactivity-closure logic itself changes. Effect: once a cycle is closed for inactivity, every subsequent `GET /cycles/current` returns that same closed cycle (status `CLOSED_DUE_TO_INACTIVITY`) instead of 404ing — which means the mobile app's existing, already-correct `cycle.status === 'CLOSED_DUE_TO_INACTIVITY'` branch (`home.tsx:160`) starts firing correctly on every load, not just the one that performed the closure. **No mobile code changes are needed.**

Side effect worth naming: `watchHumanModel`/`recordTrainingEvent` (both call `getCurrent` first) will now surface a `ConflictException` ("Cannot record training from status CLOSED_DUE_TO_INACTIVITY") instead of a `NotFoundException` if somehow called on a closed-out patient. This is arguably more correct (the patient profile and its history exist; the cycle is just closed) and is not reachable from the current mobile UI, which stops offering those actions once it sees the closed status.

## Testing

Same established e2e pattern as every prior module: real HTTP requests against a real Postgres, no mocks. Extends `backend/test/treatment-engine-inactivity.e2e-spec.ts`:

- `GET /cycles/current` returns the closed cycle (200, `status: CLOSED_DUE_TO_INACTIVITY`) on a *second* call after closure, instead of 404 — proves fix 2.
- A patient with zero cycles ever still gets 404 from `GET /cycles/current` — proves the genuine "never started" path is untouched.
- `POST /cycles/restart-after-inactivity` as `CLINICIAN` on a patient whose latest cycle is `CLOSED_DUE_TO_INACTIVITY` creates a new cycle at the first active level, `cycleNumber: 1`, under the same active treatment plan; old cycle remains in `GET /cycles` history with its `CLOSED_DUE_TO_INACTIVITY` status intact.
- `POST /cycles/restart-after-inactivity` as `PATIENT` is rejected (403 — no `RESTART_CYCLE` permission).
- `POST /cycles/restart-after-inactivity` on a patient whose latest cycle is **not** closed for inactivity (e.g. `ACTIVE_LEVEL_TRAINING`) is rejected (409).
- An `AuditLog` row is created recording the restart.

## Non-goals restated for clarity

Not building in this fix: patient/caregiver self-service restart, a new `TreatmentPlan` or re-assessment as part of restart, any notification to the patient about the restart (a natural, separate follow-on now that Notifications v1 exists — not required by §98 itself), any admin-configurable inactivity window (still the existing hardcoded 30-day constant), and any "path" grouping concept in the data model (`listHistory`'s existing flat, ordered list already satisfies "old record preserved").
