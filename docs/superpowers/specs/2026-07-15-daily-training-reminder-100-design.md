# §100 Daily Training Reminder — Design

## Goal

Implement governing-spec point §100: while a patient's 72-hour training cycle is active, the system periodically reminds them to reach today's target dose (7 trainings/day). Two hard constraints from the spec text: never remind to start a new training before the 1-hour interval clears, and never keep reminding once today's target is already met.

This depends on the daily training-session mechanism (§55-62, merged 2026-07-15), which already exposes everything needed to decide "should I remind this patient right now": `TrainingSessionsService.resolveIntervalStatus` and the day-period math inside `getProgress`.

## Architecture

A new sweep service, `TrainingReminderSweepService`, in `backend/src/modules/treatment-engine/`, following the exact shape of the existing `ConsultationRemindersService` (§106): a plain `@Injectable()` with an `@Interval(SWEEP_INTERVAL_MS)` method, running every 15 minutes (coarser than §106's 5 minutes — a daily-dose nudge doesn't need meeting-reminder precision, and a coarser tick reduces the query's load since it scans every active cycle in the system, not one indexed row).

**Why 15 minutes, not something else:** the interval gate itself (1 hour) already bounds how often a patient could plausibly need a fresh nudge; a 15-minute tick catches "training just became available" within a window that's small relative to that hour, without polling the full active-cycle table 12x as often as necessary.

### Query

Each tick:
```
prisma.trainingCycle72h.findMany({
  where: { status: 'ACTIVE_LEVEL_TRAINING', closedAt: null, humanModelWatchedAt: { not: null } },
  include: { patientProfile: true },
})
```

`humanModelWatchedAt: { not: null }` is a deliberate filter: a cycle whose patient hasn't watched the human model yet can't start a session at all (existing guard in `startOrResume`), so reminding them to train would be pointing at a 409. This isn't in the spec text explicitly, but it's the same "don't nag about something the patient can't act on yet" principle §100 already states for the interval gate — extending it to this earlier prerequisite is the consistent reading, not scope creep.

### Per-cycle decision

For each matching cycle, in order:
1. `resolveIntervalStatus(cycle.id)` — if `intervalActive`, skip (satisfies "don't remind before available").
2. Compute `completedToday` via a small extracted helper (see Refactor below) — if `completedToday >= DAILY_TARGET_TRAININGS`, skip (satisfies "don't keep reminding once done").
3. Compute the current day-period's `periodStart` (same anchor-to-`firstTrainingEventAt` math already in `getProgress`; if `firstTrainingEventAt` is null, treat "period start" as `cycle.createdAt`, since a cycle with no completed training yet is still in its first day). If `cycle.lastDailyReminderSentAt` is non-null and `>= periodStart`, skip — a reminder was already sent this period.
4. Otherwise: send `DAILY_TRAINING_REMINDER` to `patientProfile.userId`, wrapped in try/catch + `Logger.error` (matching every other fire-and-forget notification call site in this codebase), then stamp `lastDailyReminderSentAt = now` regardless of whether the notification call succeeded — same "stamp after attempting, not after confirming delivery" behavior `ConsultationRemindersService` already uses, so a transient notification failure doesn't cause a resend storm on the next tick.

Comparing the stamp against a freshly computed `periodStart` (rather than storing a boolean that needs an explicit reset) means the reminder naturally re-arms every new 24-hour period with no separate "reset" step — unlike §106, which needed an explicit reset on reschedule because its stamps track a fixed one-time event, not a rolling period.

### Refactor: extract shared day-period math

`getProgress` currently inlines the `completedToday` computation (period-boundary math + a `trainingSession.count`). The new sweep needs the same computation, plus the period-start value itself. Extract a new method on `TrainingSessionsService`:

```typescript
async computeDailyStatus(
  cycleId: string,
  firstTrainingEventAt: Date | null,
): Promise<{ completedToday: number; periodStart: Date }>
```

`getProgress` calls this instead of inlining the math; the sweep calls it directly with the cycle's own `firstTrainingEventAt` (already in hand from the `findMany` above, no extra query). This is a pure extraction — no behavior change to `getProgress`'s existing return shape or tested behavior.

## Data Model

One new nullable field on `TrainingCycle72h`:

```prisma
lastDailyReminderSentAt DateTime?
```

No new table. No change to `TrainingSession`. Requires a migration (additive, nullable — safe on the live table, same shape as the existing `sampleEligibleAt` addition from §102).

## Notification

New `NotificationType` value: `DAILY_TRAINING_REMINDER`. Recipient is the patient directly (`patientProfile.userId`), matching the `SAMPLE_SUBMISSION_REMINDER`/`CONSULTATION_REMINDER` precedent of bare `_REMINDER` types with no `_TO_<ROLE>` suffix.

Template context: `{ completedToday: string; targetPerDay: string }`. Title: `"تذكير بالتدريب اليومي"`. Body: `` `أكملت ${completedToday} من ${targetPerDay} تدريبات اليوم. أكمل جرعتك اليومية للاستمرار في تقدمك.` `` — matching the plain, non-alarming register of the existing `SAMPLE_SUBMISSION_REMINDER` template.

## Error Handling

- Per-cycle try/catch around the notification `create` call only — a failure to notify one patient must not stop the sweep from evaluating the rest. Logged via the class's own `Logger`, same as `ConsultationRemindersService` and `TrainingSessionsService.completeAndCheckEligibility`.
- The `lastDailyReminderSentAt` stamp write happens unconditionally after the attempt (success or logged failure), preventing a hot retry loop against a persistently failing notification path.
- No transaction needed: the stamp write and the notification write are independent side effects: if the process crashes between them, at worst one reminder is either sent-but-unstamped (harmless — next tick sends it again) or stamped-but-unsent (harmless — patient just doesn't get today's nudge, same as if the sweep tick had been skipped entirely). Both are acceptable, bounded, "best-effort reminder" semantics already accepted for §106.

## Testing

New e2e file `treatment-engine-daily-training-reminder.e2e-spec.ts`, following `consultation-reminders.e2e-spec.ts`'s exact pattern: obtain the sweep service via `app.get(TrainingReminderSweepService)` and call `runSweep()` directly in tests rather than waiting on the real 15-minute interval. Cases:
- Sends a reminder when a cycle is active, interval is clear, and today's target isn't met.
- Does not send when `intervalActive` is true (a session was just completed less than an hour ago).
- Does not send when `completedToday >= 7` already.
- Does not send twice on a repeated sweep within the same day-period (idempotency).
- Sends again once a new day-period has rolled over past the last reminder (period-based re-arm, no explicit reset needed).
- Does not send for a cycle whose `humanModelWatchedAt` is still null.
- Does not send for a cycle not in `ACTIVE_LEVEL_TRAINING` (e.g. `SAMPLE_ELIGIBLE`).

## Out of Scope

- §99 (admin-configurable notification engine): the 15-minute sweep interval and the 7/day target stay hardcoded constants, matching every other timing constant in this project (§56/§59/§61's constants, §106's window constants) — no admin UI for this pass.
- Mobile UI: this is backend-only, matching the established pattern for every prior notification-engine feature this session (§101/103, §102, §106). The in-app notification will appear in the existing notifications inbox once mobile builds a UI for it (separate, already-deferred follow-on).
- §104 (specialist workload reminders): a separate, unrelated notification trigger, not addressed here.
