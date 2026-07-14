# §55-62 Daily Training Session Mechanic — Design

Status: Approved (brainstormed with the founder 2026-07-14 — scope confirmed to this mechanic only; §100's reminder and mobile UI are separate, deferred follow-ons; breaking the existing mobile "log training" button is accepted since this project is pre-launch)
Date: 2026-07-14

## Context

Investigating §100 (daily training reminders) surfaced a much larger gap: the governing spec's points 55-62 (`docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md:933-940`) describe a full daily-training-session mechanic — a minimum 1-hour interval between countable trainings, a per-day counter, a 100-unit completion threshold, resumable incomplete trainings, and a parallel-training block — and **none of it is implemented**. The currently-shipped `TrainingCyclesService.recordTrainingEvent` (`backend/src/modules/treatment-engine/training-cycles.service.ts:134-187`) is a single, atomic, fire-and-forget action: one call creates one `TrainingEvent` row with an optional, unvalidated `unitsCompleted`, with none of §55-62's rules enforced. The mobile app's "log training" button calls this same endpoint with an empty body (`mobile/src/api/treatmentEngine.ts:113-119`), so it inherits none of these rules either.

§100's reminder itself depends on this mechanic (you can't sensibly remind someone "toward reaching 7/day, respecting the interval" if the system doesn't track daily counts or enforce the interval at all) but is **not part of this design** — it's a cheap follow-on once this mechanism exists, since it can reuse the exact `@nestjs/schedule` `@Interval` sweep pattern already built and merged for §106's consultation reminders (`ConsultationRemindersService`). Mobile UI for the new session-based flow is also **not part of this design** — backend-first, mobile as its own dedicated follow-on, matching every other feature shipped this session.

The spec text this design implements (points 55-62):

> **55**: The targeted dose is 7 training sessions/day, ≥100 speech units each. The system shows the patient their daily progress (completed vs. remaining). Not completing 7 in a day never fails or auto-repeats the level — it's recorded as commitment data only; transition remains governed by the sample and specialist decision.
> **56**: After completing a real training, a default interval of at least 1 hour (admin-configurable) begins before the next training counts toward the daily dose. The patient can review content during the wait, but a new training doesn't start counting before the interval ends.
> **57**: The system keeps an independent record per day. A new day starts a fresh daily counter without deleting history from previous days. Incomplete dose from a previous day never automatically carries over.
> **59**: A training counts as complete once the patient has gone through ≥100 training units. The system doesn't require audio/video recording of units and makes no automated claim about pronunciation quality per unit — it's a commitment indicator only.
> **60**: If the patient exits before completing a training, the system saves their position and it stays "incomplete"; on return they resume from where they stopped. The hour interval doesn't start and the attempt doesn't count toward the daily dose until that specific training's own minimum is completed.
> **61**: The system prevents starting more than one active real training at the same time; if the patient has an incomplete training, they're offered to resume it before starting a new one, absent a documented administrative exception.
> **62**: What the patient sees during the training cycle: current level, time remaining to complete the minimum time requirement, today's target (7 trainings), number completed today, interval status and when the next training becomes available, a resume-incomplete-training button, and access to the human model/cognitive content/previously-passed levels for reinforcement. *(§62 describes the mobile UI — out of scope for this backend-only design; the API surface built here is what a future mobile screen would consume.)*

§58 (the 72h minimum before the sample gate opens) is already correctly implemented and untouched by this work.

## Scope decisions made with the founder (2026-07-14)

**Backend only.** §100's reminder and the mobile UI are separate, deferred follow-ons, matching this project's established backend-first pattern.

**The existing mobile "log training" button will stop working correctly once this ships**, since it calls an endpoint this design removes. Confirmed acceptable — this project is pre-launch with no real users yet, and every other feature this session took the same approach.

## Data model

A new `TrainingSession` model, sitting alongside the existing `TrainingEvent` model (not replacing it) — the same relationship `SampleSession` already has to `SpeechSample` in this module: a stateful, resumable "in-progress attempt" concept layered on top of an existing "completed event" record.

```prisma
enum TrainingSessionStatus {
  IN_PROGRESS
  COMPLETED
}

model TrainingSession {
  id              String                @id @default(uuid())
  trainingCycleId String
  trainingCycle   TrainingCycle72h       @relation(fields: [trainingCycleId], references: [id])
  status          TrainingSessionStatus  @default(IN_PROGRESS)
  unitsCompleted  Int                    @default(0)
  startedAt       DateTime               @default(now())
  completedAt     DateTime?

  @@index([trainingCycleId, status])
  @@index([trainingCycleId, completedAt])
}
```

Plus a partial unique index enforcing §61's parallel-block at the database level, not just application logic — the exact same pattern already used for "at most one open cycle per patient" (`backend/prisma/migrations/20260709151944_partial_unique_open_cycle_per_patient/migration.sql`):

```sql
CREATE UNIQUE INDEX "TrainingSession_trainingCycleId_in_progress_key"
ON "TrainingSession" ("trainingCycleId")
WHERE "status" = 'IN_PROGRESS';
```

## Constants

Hardcoded, matching every other timing/threshold constant in this project (30-day inactivity window, 24h/1h consultation reminders, 2-day sample-submission grace) — no admin-configurability in this pass, consistent with §99 (the general admin-configurable notification engine) being separately deferred:

```typescript
const TRAINING_INTERVAL_MS = 60 * 60 * 1000; // §56: 1 hour between countable trainings
const COMPLETION_THRESHOLD_UNITS = 100; // §59
const DAILY_TARGET_TRAININGS = 7; // §55 — informational only, never a gate
```

## New service: `TrainingSessionsService` / `TrainingSessionsController`

A new file pair, mirroring how `SamplesService`/`SamplesController` already sit alongside `TrainingCyclesService`/`TrainingCyclesController` as a distinct concern within the same module. Routes nested under `api/v1/patients/:patientId/cycles/current/training-sessions`, matching the exact URL-nesting convention `SamplesController` already uses for `.../cycles/current/sample-session`.

No new permissions are needed. `POST .../training-sessions` and `PATCH .../training-sessions/current/progress` reuse the existing `Permission.RECORD_TRAINING_EVENT` (already scoped to `PATIENT`/`CAREGIVER` only, the same actor set the old endpoint used). `GET .../training-sessions/progress` reuses the existing `Permission.VIEW_CYCLE` (already held by every role, matching the read-only convention `GET .../cycles/current` already follows).

### `POST .../training-sessions` — start or resume

1. Resolve the current cycle via the existing `TrainingCyclesService.getCurrent` (same as every other cycle-scoped action).
2. Guard: `cycle.status !== 'ACTIVE_LEVEL_TRAINING'` → reject (unchanged from the old `recordTrainingEvent`'s guard).
3. Guard: `!cycle.humanModelWatchedAt` → reject (unchanged).
4. If an `IN_PROGRESS` `TrainingSession` already exists for this cycle, return it as-is — an idempotent resume, exactly matching `SamplesService.openSession`'s existing "if existing, return it" behavior (§60/§61: resuming an incomplete training is always allowed, regardless of the interval, which only gates *starting a new* one).
5. Otherwise, check the interval gate (§56): find the most recently `COMPLETED` session for this cycle. If `now - completedAt < TRAINING_INTERVAL_MS`, reject with a `ConflictException` whose message includes the computed `nextAvailableAt` — a genuine hard block on starting, matching the spec's literal "does not start a new training before it becomes available."
6. Otherwise, create a new `IN_PROGRESS` `TrainingSession` (`unitsCompleted: 0`).

### `PATCH .../training-sessions/current/progress` — record progress

Body: `{ unitsCompleted: number }` — the patient's **cumulative total for this session**, not an increment. This is a deliberate idempotency choice: a retried request (e.g. a flaky mobile connection) can never double-count, since the server takes `Math.max(existing, incoming)` rather than adding.

1. Resolve the current cycle, then find its `IN_PROGRESS` `TrainingSession` (404 if none — nothing to record progress against).
2. Update `unitsCompleted` to the greater of the current value and the incoming value.
3. If the new `unitsCompleted >= COMPLETION_THRESHOLD_UNITS`: transition to `COMPLETED`, stamp `completedAt`, and — this is the key seam preserving everything downstream — perform exactly what `recordTrainingEvent` used to do inline: create a `TrainingEvent` row (`occurredAt: completedAt`), recompute `firstTrainingEventAt` and cycle eligibility via the existing, **completely unchanged** `isCycleEligibleForSample` util, update the cycle's status, and fire the existing `SAMPLE_ELIGIBLE_FOR_RECORDING` notification exactly as today. Nothing about the 72h-eligibility computation or the pass/fail path changes — §55's "missing the daily target never fails or auto-repeats" is satisfied by construction, since this logic isn't touched at all.
4. If still below the threshold, just persist the updated `unitsCompleted` and return the session as-is (still `IN_PROGRESS`).

### `GET .../training-sessions/progress` — today's summary

Read-only. Computes:
- `completedToday`: count of `COMPLETED` sessions for this cycle whose `completedAt` falls within the current 24-hour period — reusing the **exact same period framing** the existing 72h eligibility check already uses (`floor((completedAt - cycle.firstTrainingEventAt) / 24h) === floor((now - cycle.firstTrainingEventAt) / 24h)`), not a separate calendar-day concept. This keeps "day" meaning one consistent thing across the whole module.
- `targetPerDay`: the constant `7`, informational only.
- `intervalActive` / `nextAvailableAt`: derived the same way `POST .../training-sessions`'s interval gate computes it, exposed here so a future UI/reminder can show "next training available at HH:MM" without guessing.
- `currentSessionId`: the `IN_PROGRESS` session's id if one exists, else `null`.

## Removing the old endpoint

`TrainingCyclesService.recordTrainingEvent`, its `RecordTrainingEventDto`, and the `POST .../cycles/current/training-events` route on `TrainingCyclesController` are **deleted outright**, not deprecated — nothing continues to call it once this ships (the mobile app's existing caller is explicitly accepted as broken until its own follow-on, per the scope decision above).

This requires migrating the 5 existing e2e call sites that currently drive cycle eligibility through this endpoint, across two files:
- `backend/test/treatment-engine-cycle.e2e-spec.ts` (3 call sites, including the §101 notification test that seeds a 73-hour-old `firstTrainingEventAt` plus period-spanning `TrainingEvent` rows and drives the final transition through this endpoint)
- `backend/test/treatment-engine-acceptance-criteria.e2e-spec.ts` (2 call sites)

Each becomes: `POST .../training-sessions` (start) followed by `PATCH .../training-sessions/current/progress` with `{ unitsCompleted: 100 }` (complete in one step) — a legitimate, simpler substitute for what was previously a single POST, since these tests only ever needed the "a training completed" outcome, never partial/incremental progress.

## Testing

Same established e2e pattern: real HTTP requests via supertest against a real Postgres, no mocks. New file `backend/test/treatment-engine-training-sessions.e2e-spec.ts`:

- Starting a training session when none exists creates one, `IN_PROGRESS`, `unitsCompleted: 0`.
- Starting again while one is already `IN_PROGRESS` returns the same session (idempotent resume), not a new one — proves §61's parallel-block.
- Recording progress below the threshold keeps the session `IN_PROGRESS` and persists the cumulative value.
- Recording progress that reaches the threshold completes the session, creates a `TrainingEvent`, and (with enough periods already satisfied) transitions the cycle to `SAMPLE_ELIGIBLE` exactly as the old endpoint did.
- Recording a smaller `unitsCompleted` than already persisted does not decrease the stored value (idempotency floor).
- Attempting to start a new session immediately after completing one (within the 1-hour interval) is rejected with a `nextAvailableAt` in the response; starting after the interval has elapsed succeeds.
- The progress-summary endpoint correctly counts only today's completed sessions, not ones from a prior 24h period.
- Regression: `treatment-engine-cycle.e2e-spec.ts` and `treatment-engine-acceptance-criteria.e2e-spec.ts`'s migrated tests (using the new two-step flow) still assert the same outcomes they did before (409 conflicts on wrong-status recording, the §101 notification firing, etc.).

## Non-goals restated for clarity

Not building in this pass: §100's actual reminder notification (separate, cheap follow-on once this exists), any admin-configurability of the interval/threshold/target constants (hardcoded, matching every other constant in this project), any mobile UI, any "abandon/reset a training session" action (not described anywhere in §55-62), and any per-training-list-item position tracking beyond the single cumulative `unitsCompleted` counter (§60's "saves position" is satisfied by that counter alone — the spec doesn't describe tracking which item in the level's training list the patient was on).
