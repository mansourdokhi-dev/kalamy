# §16 Review Previous Levels — Design

Status: Approved (brainstormed with the founder 2026-07-14 — one scope question resolved below)
Date: 2026-07-14

## Context

The gap analysis (`docs/superpowers/specs/2026-07-13-gap-analysis-corrected-spec.md`, section 6) flagged §16 as missing — no endpoint lets a patient revisit a level they've already passed. Direct code inspection this session confirmed and sharpened the finding, against the governing spec text (point 16 of `docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md:141-146`):

> يحق للمريض مراجعة المستويات السابقة التي اجتازها في أي وقت خارج وقت التدريب الأساسي. تظهر واجهتان واضحتان: «تدريبي الحالي» و«مراجعة المستويات السابقة». المراجعة لا تخصم من الجرعة الأساسية ولا تحتسب ضمن فترات 72 ساعة ولا تفتح عينة ولا تغير قرار الانتقال. المستويات اللاحقة غير المجتازة مغلقة بالكامل.

Two real gaps, of different sizes:

1. **No dedicated "review previous levels" surface exists at all.** `GET /api/v1/levels/:levelId/versions/active` (`backend/src/modules/treatment-engine/levels.controller.ts:34-38`) returns a level's content, but it's a flat, unscoped lookup by `levelId` with no patient context — there is no way to ask "what has *this* patient already passed?" Mobile's only existing history surface (`mobile/app/program/history.tsx`) shows past cycles/decisions, but never re-opens a passed level's actual training content (technique, videos, exercise list).
2. **The existing generic level-content endpoint has no per-patient ownership check.** `LevelsController`/`LevelsService` never take a patient identity at all, and the endpoint is gated only by `Permission.VIEW_LEVELS`, which every role — including `PATIENT` and `CAREGIVER` — already holds. A patient can technically call it directly for any `levelId`, including levels far beyond their progress, which violates the spec's explicit "levels not yet passed remain fully closed" rule. Mobile's current-level screen (`mobile/app/program/level-content.tsx`) only stays safe today because it happens to only ever pass the current cycle's own `levelId`.

## Scope decision made with the founder (2026-07-14)

**Narrow scope: add the review-previous-levels feature only. Leave gap 2 as documented technical debt, not fixed in this pass.** Properly closing gap 2 would mean reworking a shared endpoint mobile's *current*-level screen already depends on (migrating it to a new patient-scoped route, or splitting `VIEW_LEVELS` into a staff-only "any level" permission vs. a patient-scoped one) — real, separate scope, not something to fold into adding a new read-only feature. The practical exposure today is low (no other client calls the generic endpoint for anything but the current level), so it's acceptable to leave open and revisit later if this analysis is ever repeated.

## The feature

New `PatientLevelsController` at `api/v1/patients/:patientId/levels` (new file, `backend/src/modules/treatment-engine/patient-levels.controller.ts` + `patient-levels.service.ts`), following the same per-patient-scoped convention as `TrainingCyclesController`/`TreatmentPlansController`:

- `GET /api/v1/patients/:patientId/levels/passed` — lists every level this patient has passed.
- `GET /api/v1/patients/:patientId/levels/:levelId/review` — returns that passed level's actual training content.

### Defining "passed"

A level counts as passed when the patient has a `TrainingCycle72h` row with `status: 'NEXT_LEVEL_APPROVED'` for that `levelId` — i.e. a specialist's `TRANSITION` decision closed it (`specialist-review.service.ts`'s `review()` method, `TRANSITION` branch). This is deliberately **not** "level order < current level's order": a `LEVEL_REPEAT_DECIDED` cycle (the `LEVEL_REPEAT` decision) does not count as passed, so an order-based cutoff would wrongly credit a level the patient is still repeating.

**Edge case, found during design:** after a §98 inactivity-restart (`docs/superpowers/specs/2026-07-14-inactivity-restart-fix-design.md`), a patient starts an independent new path at Level 1 — if they pass Level 1 again in the new path, they now have *two* `NEXT_LEVEL_APPROVED` cycles for the same `levelId`. `passed` lists dedupe by `levelId`, keeping the most recently passed cycle for that level (`closedAt` descending) — a patient reviewing "Level 1" doesn't need to see it listed twice.

`PatientLevelsService.listPassed(patientProfileId, actor)`:
1. `findPatientProfileOrThrow` + `patientAccessService.assertCanAccess` (same pattern as every other patient-scoped service in this module).
2. Query all `TrainingCycle72h` rows for this patient with `status: 'NEXT_LEVEL_APPROVED'`, including the related `level` (for `name`/`order`).
3. Group by `levelId`, keeping only the row with the latest `closedAt` per group.
4. Return an array of `{ levelId, levelName, order, levelVersionId, passedAt: closedAt }`, sorted by `order` ascending.

`PatientLevelsService.reviewLevel(patientProfileId, levelId, actor)`:
1. Same access checks.
2. Find the patient's most recent `NEXT_LEVEL_APPROVED` cycle for that `levelId` (same query as above, filtered to one level). If none exists, throw `NotFoundException` ("Patient has not passed this level") — this is what enforces "levels not yet passed remain fully closed" for the new surface (the pre-existing generic endpoint is unaffected, per the scope decision above).
3. Return the full `LevelVersion` row for that cycle's `levelVersionId` — the exact version the patient actually trained on, not the level's current active version. This is deliberate: it's guaranteed to exist and matches what the patient actually experienced, and avoids an edge case where the level's content has since been re-versioned or unpublished.

Both endpoints are guarded by the existing `Permission.VIEW_LEVELS` (already held by every role) — no new permission is needed, since this is a strictly read-only view with no mutation path: no sample opens, no 72h-window activity is recorded, no transition decision changes. That "review can't affect anything" requirement from the spec is satisfied by construction, not by an extra guard.

## Non-goals restated for clarity

Not building in this pass: any mobile UI (no existing screen or nav entry references this yet, unlike §98 which had a dead link to unblock — this ships backend-first, a mobile "Review Previous Levels" screen is a natural, separate follow-on matching every other module's rollout in this project), any fix to the generic `GET /levels/:levelId/versions/active` endpoint's missing per-patient ownership check (documented above as accepted debt), and any change to how "current" level content is served (`level-content.tsx`'s existing flow is untouched).

## Testing

Same established e2e pattern as every prior module: real HTTP requests via supertest against a real Postgres, no mocks. New file `backend/test/treatment-engine-passed-levels.e2e-spec.ts`:

- A patient who has passed Level 1 (via a `TRANSITION` decision) sees it in `GET .../levels/passed`, correctly excludes a level they're still active in or have only repeated (`LEVEL_REPEAT_DECIDED`), and correctly excludes levels not yet reached.
- `GET .../levels/:levelId/review` for a passed level returns that cycle's exact `levelVersionId`'s content.
- `GET .../levels/:levelId/review` for a level not yet passed returns 404.
- A patient who passed the same level twice across two independent paths (simulated via two `NEXT_LEVEL_APPROVED` cycles for the same `levelId`, different `closedAt`) appears only once in the passed list, with the more recent `levelVersionId`.
- A different patient (or a `PATIENT` role user who isn't the profile owner) is rejected by the existing ownership check (403/404, matching `PatientAccessService`'s established behavior) — mirrors the ownership test pattern already used for `TrainingCyclesController`/`TreatmentPlansController`.
- `CLINICIAN`/`SUPERVISOR`/`ADMIN` can call both endpoints for any patient (already true of `VIEW_LEVELS` + `assertCanAccess`'s staff bypass) — one test confirming a clinician can review a patient's passed level.
