# §102 Sample Submission Delay — Design

Status: Approved (brainstormed with the founder 2026-07-14 — notification recipients confirmed: both patient and supervisor)
Date: 2026-07-14

## Context

The gap analysis's original §99-107 investigation (recorded in project memory, `docs/superpowers/specs/2026-07-14-notifications-101-103-design.md`'s context section) found that §99-107 decomposes into at least four independent pieces. §101 and §103 (patient/specialist notifications needing no new infrastructure) were already built. This spec covers the second piece: §102's "delayed sample submission" state.

Governing spec text (point 102, `docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md:999`):

> **102. مهلة اليومين بعد استحقاق العينة**: إذا لم يرسل المستفيد العينة بعد فتح مرحلة التسجيل، يمنحه النظام مهلة إضافية مقدارها **يومان**. بعد انتهائها دون إرسال، ينتقل النظام إلى حالة «تأخر في إرسال العينة» ويطبق مسار التذكير والمتابعة، دون إصدار قرار علاجي آلي.

Two days after the sample becomes due (i.e. the cycle becomes `SAMPLE_ELIGIBLE`, per §101), if the patient still hasn't submitted, the system enters a "delayed sample submission" state and applies a reminder/follow-up path — **without** issuing any automatic clinical decision (the patient can still submit normally afterward; nothing is closed).

**Investigation finding, worth recording:** unlike §100/§104/§106 (which genuinely need proactive, time-based background firing — confirmed via a full-backend search that no scheduling infrastructure of any kind exists in this project), §102 fits the exact same lazy-evaluation-on-read pattern already established and founder-approved for §98's 30-day inactivity closure and Specialist Review v2's 24h/48h/7-day SLA timers. The only reader of an individual patient's current cycle is the patient themselves (or staff looking up that specific patient) via `GET /cycles/current` — there is no admin/staff view that sweeps every in-progress cycle the way `listAvailableSamples` does for the review queue (confirmed: `reports.service.ts`'s `getOperationalStatusReport` only does a `groupBy` count, no per-row evaluation). This is accepted as consistent with existing precedent, not a gap to fix here — §98 has the identical limitation.

## Scope decision made with the founder (2026-07-14)

**Both a patient reminder and a supervisor follow-up notification fire on this transition** — `SUPERVISOR`, not `CLINICIAN`/`ADMIN`, matching the existing precedent for `SAMPLE_ESCALATED_TO_SUPERVISOR`/`INTERVENTION_TIMED_OUT` (supervisors handle oversight of stalled/at-risk cases, not the front-line clinicians).

## Data model changes

New `LevelCycleStatus` enum value, added to `backend/prisma/schema.prisma:87-101`:

```prisma
enum LevelCycleStatus {
  ACTIVE_LEVEL_TRAINING
  SAMPLE_ELIGIBLE
  SAMPLE_PREPARATION
  SAMPLE_SUBMITTED
  SAMPLE_SUBMISSION_DELAYED
  WAITING_FOR_SPECIALIST
  ...
}
```

New `sampleEligibleAt` timestamp on `TrainingCycle72h` (`backend/prisma/schema.prisma:392-416`), set once, at the same moment §101's notification already fires (`recordTrainingEvent`, when `eligible` becomes true). This is a dedicated field, not a reuse of `updatedAt` — `updatedAt` gets bumped by `openSession`'s own `status: 'SAMPLE_PREPARATION'` update, which would silently reset the 2-day clock every time a patient merely opens a recording session without submitting. A dedicated field is the only way to measure "time since becoming eligible" independent of later, unrelated updates to the same row — the same reasoning that already justifies `firstTrainingEventAt` existing as its own field rather than reusing `createdAt`.

Two new `NotificationType` values, added to `backend/prisma/schema.prisma:565-571`: `SAMPLE_SUBMISSION_REMINDER` (patient) and `SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR` (supervisor).

This is the second Prisma migration the notifications work has needed (the first was §101/§103's two enum additions).

## Fix 1: lazy evaluation in `getCurrent`

`TrainingCyclesService.getCurrent` (`backend/src/modules/treatment-engine/training-cycles.service.ts:189-224`) already houses one lazy check (30-day inactivity closure, lines 199-205). A second lazy check is added for the 2-day grace period, evaluated on the same fetched `cycle`, before the inactivity check (order doesn't functionally matter since 2 days is always reached before 30, but placing it first keeps the more specific/faster-firing condition visually first):

```typescript
const SAMPLE_SUBMISSION_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const STATES_AWAITING_SAMPLE_SUBMISSION: readonly string[] = ['SAMPLE_ELIGIBLE', 'SAMPLE_PREPARATION'];

// inside getCurrent, after the existing `let cycle = await ...findFirst(...)`:
if (
  cycle &&
  STATES_AWAITING_SAMPLE_SUBMISSION.includes(cycle.status) &&
  cycle.sampleEligibleAt &&
  Date.now() - cycle.sampleEligibleAt.getTime() > SAMPLE_SUBMISSION_GRACE_MS
) {
  cycle = await this.prisma.trainingCycle72h.update({
    where: { id: cycle.id },
    data: { status: 'SAMPLE_SUBMISSION_DELAYED' },
    include: { speechSample: { include: { parts: true } } },
  });
  // notify patient (reminder) + notifyRole('SUPERVISOR', ...) (follow-up),
  // each independently wrapped in try/catch + Logger, matching the
  // established convention — a notify failure must never mask this
  // already-committed status change or break the patient's read.
}
```

This only fires once per cycle: after the transition, `cycle.status` is `SAMPLE_SUBMISSION_DELAYED`, which is no longer in `STATES_AWAITING_SAMPLE_SUBMISSION`, so the condition can't match again on a later read — the same idempotency shape the existing inactivity check already relies on.

`SAMPLE_SUBMISSION_DELAYED` is **not** added to `STATES_EXEMPT_FROM_INACTIVITY` (`training-cycles.service.ts:12-21`) — consistent with its predecessor states (`SAMPLE_ELIGIBLE`/`SAMPLE_PREPARATION`) already not being exempt, so the 30-day inactivity backstop still applies on top if the patient never returns at all.

## Fix 2: widen `openSession`/`submitSample` to accept the delayed state

Neither guard needs any other change — the patient can still submit exactly as before once they act; only the set of statuses each method accepts as a valid predecessor widens.

`SamplesService.openSession` (`backend/src/modules/treatment-engine/samples.service.ts:26-30`): the guard `if (cycle.status !== 'SAMPLE_ELIGIBLE')` becomes `if (cycle.status !== 'SAMPLE_ELIGIBLE' && cycle.status !== 'SAMPLE_SUBMISSION_DELAYED')`. This covers a patient who never opened a session at all before being flagged delayed. Once they open one, status advances to `SAMPLE_PREPARATION` exactly as it does today from `SAMPLE_ELIGIBLE` — no special "still delayed" marker persists; this is a transient signal to trigger one round of notifications, not a permanent state.

`SamplesService.submitSample` (`backend/src/modules/treatment-engine/samples.service.ts:118`): the guard `if (cycle.status !== 'SAMPLE_PREPARATION')` becomes `if (cycle.status !== 'SAMPLE_PREPARATION' && cycle.status !== 'SAMPLE_SUBMISSION_DELAYED')`. This covers a patient who had already opened a session (and was therefore in `SAMPLE_PREPARATION`, not `SAMPLE_ELIGIBLE`, when the 2-day mark passed) but hadn't submitted yet. If a patient was flagged delayed while still in `SAMPLE_ELIGIBLE` (never opened a session) and calls `submitSample` directly without ever opening one, `findSessionOrThrow` still correctly 404s — no `SampleSession` row exists, regardless of this guard's widening.

The same widening does **not** apply to `recordAttempt`/`deleteAttempt`/`listAttempts` (which only ever operate through `findSessionOrThrow`, gated by session existence, not cycle status) or `rerecordDamagedParts` (an unrelated, later-stage flow) — none of these read `cycle.status` directly, so nothing in them needs to change.

## Reporting

`ReportsService.getOperationalStatusReport`'s `trainingCyclesByStatus` zero-fill list (`backend/src/modules/reports/reports.service.ts:182-197`) gets the new status added, matching its existing convention of listing every `LevelCycleStatus` value so the count report never silently omits a real status.

## Non-goals restated for clarity

Not building in this fix: any change to §100/§104/§106 (still blocked on missing scheduling infrastructure, unrelated to this fix), any admin-configurable grace period (stays a hardcoded 2-day constant, matching the existing hardcoded 30-day inactivity window and every other timing constant in this project so far), any new admin/staff view listing "patients currently delayed" (the existing `getOperationalStatusReport` count is the only visibility this pass adds — a dedicated list view is a separate, future UI concern), and any mobile UI changes (the mobile app already displays `cycle.status` generically via its `genericWaiting` catch-all for statuses it doesn't specifically handle, per the §16/§98 investigation — `SAMPLE_SUBMISSION_DELAYED` falls into that catch-all with no code change needed, though a dedicated message is a natural mobile follow-on).

## Testing

Same established e2e pattern: real HTTP requests against a real Postgres, no mocks. Extends `backend/test/treatment-engine-cycle.e2e-spec.ts` (and/or a new focused file):

- A cycle whose `sampleEligibleAt` is seeded more than 2 days in the past, still in `SAMPLE_ELIGIBLE`, transitions to `SAMPLE_SUBMISSION_DELAYED` on the next `GET /cycles/current` — and creates both a `SAMPLE_SUBMISSION_REMINDER` notification for the patient and a `SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR` notification for a `SUPERVISOR` test user.
- The same, but the cycle is in `SAMPLE_PREPARATION` (session already opened, no attempts submitted) instead of `SAMPLE_ELIGIBLE` — same transition and notifications fire.
- A cycle whose `sampleEligibleAt` is less than 2 days old does NOT transition, regardless of status.
- Once flagged `SAMPLE_SUBMISSION_DELAYED`, a second `GET /cycles/current` call does not create duplicate notifications (idempotency).
- A patient flagged `SAMPLE_SUBMISSION_DELAYED` (never having opened a session) can still successfully call `POST /cycles/current/sample-session` (open), then submit normally.
- A patient flagged `SAMPLE_SUBMISSION_DELAYED` (already had a session open) can still successfully submit via the existing submit endpoint.
