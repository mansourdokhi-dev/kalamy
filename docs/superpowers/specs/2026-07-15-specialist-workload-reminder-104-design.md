# §104 Specialist Workload Reminder — Design

## Goal

Implement governing-spec point §104: while a sample review, an intervention, or (per the spec's general phrasing) any clinical task sits unreviewed with the specialist who holds it, the system reminds that specialist before the delay reaches the point where the platform escalates the case away from them.

Governing spec text (point 104, `docs\KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md:1001`):

> **104. التذكير بالأعمال المتأخرة لدى الأخصائي**: إذا بقيت عينة أو تقرير أو مهمة سريرية دون مراجعة خلال المدة التشغيلية، يرسل النظام تذكيرًا للأخصائي؛ إذا تجاوز التأخير حدًا آخر تحدده الإدارة، يمكن تصعيد الحالة للمشرف أو مدير النظام دون نقل المسؤولية السريرية تلقائيًا (أي إعادة إسناد تتم بإجراء رسمي موثق).

Translated: if a sample, report, or clinical task stays unreviewed during the operational period, the system reminds the specialist; if the delay exceeds a further administrator-set limit, the case can escalate to the supervisor or system admin, without automatically transferring clinical responsibility (reassignment only happens through a formal, documented procedure).

## What already exists vs. what's missing

`SpecialistReviewService` (Specialist Review v2, built 2026-07-13) already implements the **escalation half** of §104 exactly as worded — three lazily-evaluated SLA transitions in `evaluateReviewDeadlines`:

- 24h unreserved after submission → escalates to `SUPERVISOR` (`SAMPLE_ESCALATED_TO_SUPERVISOR`), no reassignment.
- 48h reserved-but-undecided (`reviewDeadlineAt`) → auto-releases the reservation back to the open queue, silently. No notification to anyone.
- 7-day intervention outstanding (`interventionDeadlineAt`) → escalates to `SUPERVISOR` (`INTERVENTION_TIMED_OUT`), no reassignment.

None of these three paths ever notifies **the specialist who is holding the reservation**. That's the entire gap: §104's first clause — remind the specialist before the "further limit" (i.e. these exact three deadlines) is reached — has no code at all. This design adds only that missing reminder step; the escalation half is untouched.

This also matches the phrasing itself: "التذكير... لدى الأخصائي" (the reminder... *held by* the specialist) only makes sense for a reservation a specific specialist already holds. The 24h-unreserved path has no specific specialist to remind — it's inherently a queue-visibility problem (§103, already handled), not a §104 case.

## Scope

In scope, matching each of the two deadline fields that already gate a reservation:

- `reviewDeadlineAt` (set by `reserve()` and `completeIntervention()`, cleared by `requestIntervention()`) — active while `cycle.status` is `UNDER_REVIEW` or `WAITING_FINAL_DECISION_AFTER_INTERVENTION`.
- `interventionDeadlineAt` (set by `requestIntervention()`) — active while `cycle.status` is `DIRECT_INTERVENTION_REQUIRED`.

At any given time a sample has **at most one** of these two deadlines active — the state machine already enforces this (`requestIntervention` nulls `reviewDeadlineAt` when it sets `interventionDeadlineAt`; `completeIntervention` sets `reviewDeadlineAt` fresh). This single-active-deadline invariant is what makes one shared reminder-tracking field sufficient (see Data Model).

Out of scope, all deliberate:

- The 24h-unreserved-escalation path (no specific specialist to remind, see above) — untouched.
- "تقرير" (report) / generic "مهمة سريرية" (clinical task) — no report-review or generic-task model exists in this codebase; the only implemented reviewable clinical work item is the sample-review reservation. Same "narrow spec language to what's actually implemented" precedent as §106 (consultations only, not the spec's broader "video or voice" phrasing) and §100 (7/day training dose, not a generic task engine).
- §99 (admin-configurable engine): reminder lead times stay hardcoded constants, matching every other timing constant in this project.
- Making the currently-lazy escalation (`evaluateReviewDeadlines`) proactive/scheduled: not asked for by §104, and changing it is a bigger, separate architectural decision (it's called from every mutating method already, so it always evaluates before the next action anyway). This design only adds a reminder; the escalation stays exactly as lazy as it already was.
- Mobile UI: backend-only, matching the established pattern for every notification-engine feature this session.

## Architecture

A new sweep service, `SpecialistWorkloadReminderSweepService`, in `backend/src/modules/treatment-engine/`, following the exact shape of `TrainingReminderSweepService` (§100) and `ConsultationRemindersService` (§106): a plain `@Injectable()` with an `@Interval(SWEEP_INTERVAL_MS)` method. Sweep interval: 15 minutes, same reasoning as §100 — these are multi-hour/multi-day windows, a 15-minute tick is more than fine-grained enough and keeps this project's sweep cadences consistent (§106 alone runs at 5 minutes because it targets fixed-clock-time meetings, not a rolling deadline).

### Query

Each tick, find every sample with an active deadline that hasn't been reminded yet:

```
prisma.speechSample.findMany({
  where: {
    reservedByUserId: { not: null },
    deadlineReminderSentAt: null,
    OR: [
      { trainingCycle: { status: { in: ['UNDER_REVIEW', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'] } }, reviewDeadlineAt: { not: null } },
      { trainingCycle: { status: 'DIRECT_INTERVENTION_REQUIRED' }, interventionDeadlineAt: { not: null } },
    ],
  },
  include: { trainingCycle: true },
})
```

### Per-sample decision

For each matching sample:

1. `deadline = sample.reviewDeadlineAt ?? sample.interventionDeadlineAt` (exactly one is non-null, per the state-machine invariant above — `trainingCycle.status` picked the right branch already).
2. `leadTimeMs = cycle.status === 'DIRECT_INTERVENTION_REQUIRED' ? INTERVENTION_REMINDER_LEAD_MS : REVIEW_REMINDER_LEAD_MS`.
3. `remindAt = deadline.getTime() - leadTimeMs`.
4. Skip if `Date.now() < remindAt` (too early) or `Date.now() >= deadline.getTime()` (already past deadline — the next lazy `evaluateReviewDeadlines` call will auto-release/escalate it instead; don't remind about something that's about to be taken away).
5. Otherwise: send `SPECIALIST_WORKLOAD_REMINDER` to `sample.reservedByUserId`, wrapped in try/catch + `Logger.error` (matching every other fire-and-forget notification call site), then stamp `deadlineReminderSentAt = now` regardless of send success — same "stamp after attempting" rule as §100/§106, preventing a resend storm on the next tick.

### Lead times (chosen defaults, not spec-mandated — §99 is what would make these admin-configurable)

- `REVIEW_REMINDER_LEAD_MS = 24h` — halfway through the 48h decision window (`REVIEW_DECISION_WINDOW_MS` in `specialist-review.service.ts`). A specialist gets a nudge with half their window still available to act.
- `INTERVENTION_REMINDER_LEAD_MS = 24h` — a flat one-day-before-deadline nudge on the 7-day intervention window, not a proportional half (3.5 days would be needlessly early for a week-long clinical task; a last-day nudge is the useful moment).

### Resetting `deadlineReminderSentAt`

Must be cleared to `null` at every point a *new* deadline becomes active, so the reminder re-arms for it:

- `reserve()` — sets `reviewDeadlineAt` fresh → also set `deadlineReminderSentAt: null`.
- `completeIntervention()` — sets `reviewDeadlineAt` fresh → also set `deadlineReminderSentAt: null`.
- `requestIntervention()` — sets `interventionDeadlineAt` fresh (and nulls `reviewDeadlineAt`) → also set `deadlineReminderSentAt: null`.
- `transferResponsibility()` — does **not** change either deadline field, but changes *who* holds the reservation. Must also reset `deadlineReminderSentAt: null`, so the new specialist gets their own reminder rather than silently inheriting a "no reminder needed" state from whoever the sample was transferred away from. (The deadline itself is untouched by a transfer today — that's existing, unchanged behavior; only the reminder-sent flag is new.)

`evaluateReviewDeadlines`'s 48h auto-release path already clears `reviewDeadlineAt` to `null` when it releases a reservation — no extra change needed there, since the sample leaves the "has an active deadline" set entirely (and `reservedByUserId` also goes to `null`, which the sweep's `where` clause already requires to be non-null).

## Data Model

One new nullable field on `SpeechSample`:

```prisma
deadlineReminderSentAt DateTime?
```

No new table. Requires a migration (additive, nullable — same safe shape as `TrainingCycle72h.lastDailyReminderSentAt` from §100).

## Notification

New `NotificationType` value: `SPECIALIST_WORKLOAD_REMINDER`. Recipient is `sample.reservedByUserId` directly — the specialist holding the reservation, never `SUPERVISOR`/`ADMIN` (that's the existing, untouched escalation path).

Template context: `{ kind: 'REVIEW_DECISION' | 'INTERVENTION_OUTCOME'; patientName: string; levelName: string }` (reusing `getNotificationContext`, the same shared utility every other notification call site in this module already uses). Two title/body variants inside one template function, mirroring `CONSULTATION_REMINDER`'s `leadTime`-branching pattern:

- `REVIEW_DECISION`: "تذكير: مراجعة عينة متأخرة" / "لديك عينة قيد المراجعة تنتظر قرارك. يرجى استكمال المراجعة قبل انتهاء المهلة المحددة."
- `INTERVENTION_OUTCOME`: "تذكير: تدخل مباشر متأخر" / "لديك تدخل مباشر قيد التنفيذ ينتظر توثيق النتيجة. يرجى استكماله قبل انتهاء المهلة المحددة."

## Error Handling

- Per-sample try/catch around the notification `create` call only, matching `TrainingReminderSweepService` and `ConsultationRemindersService`.
- `deadlineReminderSentAt` stamp write happens unconditionally after the attempt, preventing a hot retry loop against a persistently failing notification path.
- No transaction needed: same "best-effort reminder" acceptance already established for §100/§106 — a crash between the notify call and the stamp write means at worst one reminder is resent next tick (harmless) or one reminder is silently skipped (harmless, the escalation path is still the real backstop).

## Testing

New e2e file `treatment-engine-specialist-workload-reminder.e2e-spec.ts`, following `treatment-engine-daily-training-reminder.e2e-spec.ts`'s exact pattern: obtain the sweep service via `app.get(SpecialistWorkloadReminderSweepService)` and call `runSweep()` directly rather than waiting on the real interval. Cases:

- Sends a reminder when a reservation is past the halfway point of its 48h review-decision window.
- Does not send before the halfway point.
- Does not send once the 48h deadline has already passed (about to be auto-released instead).
- Does not send twice on a repeated sweep for the same active deadline (idempotency via `deadlineReminderSentAt`).
- Sends a (differently-worded) reminder when an intervention is within 24h of its 7-day deadline.
- Re-arms after `transferResponsibility` moves the reservation to a new specialist (new specialist gets their own reminder even if the old one already got theirs for this deadline).
- Does not send for the 24h-unreserved-escalation path (no `reservedByUserId` at all — confirms this design's scope boundary against §103's existing, unrelated escalation).

## Non-goals restated for clarity

Not building in this pass: any change to the existing escalation timers or their recipients, a generic "report" or "clinical task" review model (doesn't exist in this codebase), admin-configurable lead times (§99), or mobile UI.
