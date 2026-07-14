# §101 + §103 Notification Triggers — Design

Status: Approved (brainstormed with the founder 2026-07-14 — CLINICIAN-only recipient for §103 confirmed)
Date: 2026-07-14

## Context

The gap analysis's original notifications write-up (`docs/superpowers/specs/2026-07-13-notifications-v1-design.md`) wired only the three events Specialist Review v2 already produced: a 24h-unreserved-sample escalation, a specialist decision issued, and a 7-day intervention timeout. Every other trigger in the governing spec's points 99–107 (`docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md:994-1004`) was deliberately deferred as a "mechanically similar follow-on."

Investigating those remaining points this session found they decompose into at least four independent pieces of very different size (documented in project memory): (1) wiring §101 and §103, which need no new infrastructure and follow the exact pattern already established; (2) §100/§104/§106, which need real scheduled/time-based background firing — infrastructure this project has never built (confirmed: no `@Cron`, no job queue, nothing, anywhere in the backend); (3) §102's "delayed sample submission" state, which doesn't exist as a workflow state at all yet and depends on (2); (4) §107's notification-preferences model. This design covers only piece (1) — §101 and §103 — the two that are genuinely small.

**§101** (`...spec.md:998`): "إشعار فتح مرحلة العينة" — when the 72h/training requirements complete, notify the patient clearly that they're ready to record their sample.

**§103** (`...spec.md:1000`): "إشعار الأخصائيين ووصول العينة" — when a sample is officially submitted, it enters the review queue and appears to every qualified, authorized specialist (no pre-assignment — first to start reviewing reserves it, per Specialist Review v2's existing queue mechanics).

## Scope decision made with the founder (2026-07-14)

**§103 notifies `CLINICIAN` only, not `ADMIN`.** Confirmed as consistent with the precedent already set for the 24h-escalation notification in Notifications v1 (design rationale recorded in `docs/superpowers/specs/2026-07-13-notifications-v1-design.md:62`): `ADMIN` already sees everything through admin reporting, and this is specifically a "the review queue has new work" signal for the role that actually works that queue day to day.

## Fix 1: §101 — notify the patient when the sample stage opens

`TrainingCyclesService.recordTrainingEvent` (`backend/src/modules/treatment-engine/training-cycles.service.ts:86-114`) is the only place a cycle's status transitions from `ACTIVE_LEVEL_TRAINING` to `SAMPLE_ELIGIBLE` (`isCycleEligibleForSample(...)` returning `true`). The method's own opening guard (`if (cycle.status !== 'ACTIVE_LEVEL_TRAINING') throw ConflictException`) means this transition can only ever happen once per cycle — once it fires, every later call to this method for the same cycle is rejected before reaching the transition code. So the notification call site needs no additional idempotency guard of its own.

After the `trainingCycle72h.update(...)` call, if the new status is `SAMPLE_ELIGIBLE`, call `notificationsService.create(patientUserId, 'SAMPLE_ELIGIBLE_FOR_RECORDING', { levelName })`. `patientUserId` is resolved via the cycle's `patientProfileId` → `PatientProfile.userId` (one additional lookup, same cost class as the existing lookups this service already does).

## Fix 2: §103 — notify specialists when a sample is submitted

`SamplesService.submitSample` (`backend/src/modules/treatment-engine/samples.service.ts:110-175`) is where a `SpeechSample` is created and the cycle moves to `WAITING_FOR_SPECIALIST`, inside a `$transaction`. After the transaction commits and only in the `alreadyTransitioned: false` branch (i.e. this call actually performed the submission, not a duplicate/racing call that found the cycle already moved on), call `notificationsService.notifyRole('CLINICIAN', 'SAMPLE_AVAILABLE_FOR_REVIEW', { patientName, levelName })`.

## Shared refactor: extracting `getNotificationContext`

`specialist-review.service.ts:412-418` already has a private helper resolving `{ patientName, levelName }` from `{ patientProfileId, levelId }`. Both fixes above need the identical lookup. Rather than copy it a second and third time, extract it into `backend/src/modules/notifications/notification-context.util.ts`:

```typescript
export async function getNotificationContext(
  prisma: PrismaService,
  cycle: { patientProfileId: string; levelId: string },
): Promise<{ patientName: string; levelName: string }> {
  const [patientProfile, level] = await Promise.all([
    prisma.patientProfile.findUniqueOrThrow({ where: { id: cycle.patientProfileId } }),
    prisma.level.findUniqueOrThrow({ where: { id: cycle.levelId } }),
  ]);
  return { patientName: patientProfile.fullName, levelName: level.name };
}
```

`specialist-review.service.ts`'s existing three call sites are updated to call this shared function instead of its own private method (the private method is deleted); `training-cycles.service.ts` and `samples.service.ts` import and use the same function. This is the only change to already-shipped, already-tested code in this fix — a pure extraction with no behavior change, so `specialist-review.service.ts`'s existing test suites are the regression check for it.

`training-cycles.service.ts`'s §101 call site only needs `levelName` (not `patientName`, since the recipient is the patient themselves and the message doesn't need to name them) — it can still call the shared function and only destructure `levelName`, matching how `specialist-review.service.ts:137` already does exactly that for its own single-recipient notification.

## Schema change

Two new `NotificationType` enum values, added to the existing enum in `backend/prisma/schema.prisma:565-569`:

```prisma
enum NotificationType {
  SAMPLE_ESCALATED_TO_SUPERVISOR
  SPECIALIST_DECISION_ISSUED
  INTERVENTION_TIMED_OUT
  SAMPLE_ELIGIBLE_FOR_RECORDING
  SAMPLE_AVAILABLE_FOR_REVIEW
}
```

This requires a Prisma migration (`prisma migrate dev`) — the first one this notifications work has needed, since the original three fit inside the enum's initial definition.

Two new templates added to `NOTIFICATION_TEMPLATES` in `backend/src/modules/notifications/notifications.service.ts:12-29`, matching the existing entries' shape (hardcoded Arabic, per the same scope decision as every other notification in this project — no admin-configurable content in this pass, that's §99, separately deferred):

```typescript
SAMPLE_ELIGIBLE_FOR_RECORDING: (ctx) => ({
  title: 'حان وقت تسجيل العينة',
  body: `أصبحت جاهزًا لتسجيل عينتك الصوتية في المستوى ${ctx.levelName}.`,
}),
SAMPLE_AVAILABLE_FOR_REVIEW: (ctx) => ({
  title: 'عينة جديدة بانتظار المراجعة',
  body: `عينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} أصبحت متاحة للمراجعة.`,
}),
```

## Non-goals restated for clarity

Not building in this fix: any scheduled/time-based notification (§100, §104's reminder half, §106 — all depend on background-job infrastructure this project doesn't have, a separate, larger sub-project), §102's "delayed sample submission" workflow state, §107's notification preferences model, and §99's admin-configurable engine (message text stays hardcoded, same as every notification in this project so far).

## Testing

Same established e2e pattern: real HTTP requests against a real Postgres, no mocks.

- Extending `backend/test/treatment-engine-cycle.e2e-spec.ts` or a new focused file: recording enough training events to flip a cycle to `SAMPLE_ELIGIBLE` creates a `SAMPLE_ELIGIBLE_FOR_RECORDING` notification for the patient (assert via `GET /api/v1/notifications` as that patient).
- Submitting a sample creates a `SAMPLE_AVAILABLE_FOR_REVIEW` notification for a `CLINICIAN` test user, and does NOT create one for an `ADMIN` test user.
- A regression check that `specialist-review.service.ts`'s existing notification-dependent e2e suites (`treatment-engine-specialist-review-queue.e2e-spec.ts`, `treatment-engine-specialist-review.e2e-spec.ts`) still pass unchanged after the `getNotificationContext` extraction — proves the refactor didn't change behavior.
