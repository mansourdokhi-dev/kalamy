# §106 Consultation Reminders — Design

Status: Approved (brainstormed with the founder 2026-07-14 — reminder timing confirmed: two reminders, one day before and one hour before)
Date: 2026-07-14

## Context

This is the first genuinely proactive, time-based notification trigger in this project. Every prior trigger (§98 inactivity closure, Specialist Review v2's 24h/48h/7-day SLA timers, §101/§103/§102) is evaluated lazily — only when some user's own request happens to touch the relevant row. A full-codebase search confirmed there is zero scheduling/cron/job-queue infrastructure anywhere in this backend.

Investigating the broader §99–107 gap (recorded in project memory) found it decomposes into several pieces of very different size. §100 (daily training reminders) and §106 (consultation reminders) both genuinely need proactive firing regardless of whether anyone opens the app — but §100 has open product questions (reminder cadence/hours) that haven't been decided, while §106 is precisely specified. **This design covers §106 only.** §100 is a natural follow-on once its cadence is decided; §104's reminder-before-escalation half is being investigated separately since it may not need this new infrastructure at all (specialists already trigger lazy evaluation just by opening their review queue).

Governing spec text (point 106, `docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md:1003`):

> **106. تذكيرات المواعيد والاستشارات**: يرسل النظام تذكيرات بالاستشارة المجانية أو المدفوعة (مرئية أو صوتية)؛ تحدد الإدارة التوقيتات والقنوات، ويُلغى التذكير تلقائيًا عند إلغاء الموعد أو إعادة جدولته.

## Scope decisions made with the founder (2026-07-14)

**Two reminders: one day before, one hour before.** Confirmed directly with the founder rather than assumed.

**Admin-configurable timing/channels are not built** — every timing constant in this project so far is a hardcoded value (30-day inactivity window, 24h escalation, 2-day sample grace, etc.), and §99 (the general admin-configurable notification engine) is already a separately deferred, unbuilt piece. The two reminder lead times (24h, 1h) are hardcoded constants, consistent with this precedent. Channel is in-app only, matching every notification this project has ever built (no real SMS/push/email exists anywhere).

**Recipient is the patient only, not the assigned specialist.** Matches this project's existing pattern: "you need to act / be somewhere" reminders go to the patient (`SAMPLE_ELIGIBLE_FOR_RECORDING`, `SAMPLE_SUBMISSION_REMINDER`); specialist-facing notifications in this project are about queue/workload events (`SAMPLE_AVAILABLE_FOR_REVIEW`, `SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR`), not calendar reminders. Left as an easy, separate follow-on if ever wanted.

## Scheduling mechanism

`@nestjs/schedule`'s `@Interval`, running in-process as part of the existing single NestJS process, every 5 minutes. This is a single-instance assumption: no hosting/scaling decision has been made anywhere in this project (`backend/docker-compose.yml` defines only Postgres — no Redis, no queue, no second service), and every other infrastructure decision in this project has deliberately started with the simplest viable option (no message queue for notifications, no distributed lock, lazy evaluation instead of background jobs everywhere else). If this app is ever deployed as multiple replicas, this in-process timer would fire once per replica and needs revisiting (a DB-based leader lock, or a real job queue) — noted here as a documented future constraint, not a present concern.

5-minute granularity is a deliberate choice: fine enough that neither reminder is meaningfully late, coarse enough to avoid needless DB load, and consistent with there being no product requirement for second-level precision on a reminder.

## Data model changes

Two new nullable timestamps on `Consultation` (`backend/prisma/schema.prisma:517-537`):

```prisma
model Consultation {
  ...
  scheduledAt              DateTime?
  dayBeforeReminderSentAt  DateTime?
  hourBeforeReminderSentAt DateTime?
  externalMeetingLink      String?
  ...
}
```

One new `NotificationType` value: `CONSULTATION_REMINDER` — a single type, not two. Its template branches on a `ctx.leadTime` context value (`'DAY_BEFORE'` or `'HOUR_BEFORE'`) for the wording, mirroring how `SPECIALIST_DECISION_ISSUED`'s existing template already branches on `ctx.decision` rather than needing three separate `NotificationType` values for its three possible decisions.

## The sweep

A new `ConsultationRemindersService` (in the existing `consultations` module) with one `@Interval(5 * 60 * 1000)`-decorated method, run every 5 minutes:

1. Query all `Consultation` rows where `status === 'SCHEDULED'`, `scheduledAt` is in the future, `scheduledAt <= now + 24h`, and `dayBeforeReminderSentAt IS NULL`. For each: send `CONSULTATION_REMINDER` (`leadTime: 'DAY_BEFORE'`) to the patient, then stamp `dayBeforeReminderSentAt: new Date()`.
2. Query all `Consultation` rows where `status === 'SCHEDULED'`, `scheduledAt` is in the future, `scheduledAt <= now + 1h`, and `hourBeforeReminderSentAt IS NULL`. For each: send `CONSULTATION_REMINDER` (`leadTime: 'HOUR_BEFORE'`) to the patient, then stamp `hourBeforeReminderSentAt: new Date()`.

This is the same "compute due-ness live from existing fields, then mark it done" idempotency pattern already used everywhere else in this project (the 30-day inactivity check, the 24h/48h/7-day SLA timers, §102's 2-day grace period) — just triggered by a timer instead of a request. No separate "scheduled jobs" table is introduced.

Each notification send is wrapped in try/catch with `Logger.error(...)` on failure, matching the established convention — one consultation's notification failure must never stop the sweep from processing the rest, and the `...SentAt` stamp should still be set even if the notify call fails (matching the existing pattern where the business-state change is never rolled back or blocked by a notification failure) — actually: since there is no other "business state" here besides the reminder itself, the stamp *is* the record that this reminder was attempted; if `notificationsService.create` throws, the stamp still gets set so the sweep doesn't retry-storm on a persistently-failing case, and the failure is logged for investigation.

## Auto-cancellation and rescheduling

**Cancellation needs no explicit code.** Since reminders are computed live from `status`+`scheduledAt` at sweep time rather than pre-scheduled jobs, a `CANCELLED` consultation simply stops matching the sweep's `status === 'SCHEDULED'` filter on the very next run — nothing to explicitly cancel.

**Rescheduling resets both reminder flags.** `ConsultationsService.update` (`backend/src/modules/consultations/consultations.service.ts:49-91`) is the single place `scheduledAt` ever changes on an existing row (there's no reschedule-history concept — the same row's `scheduledAt` is simply overwritten). When the incoming `dto.scheduledAt` differs from the consultation's current `scheduledAt`, both `dayBeforeReminderSentAt` and `hourBeforeReminderSentAt` reset to `null` in the same update. Without this, a patient who reschedules to a later time could silently lose both reminders (already stamped "sent" against the old time) instead of getting fresh ones for the new time — a materially worse outcome than the spec's "auto-cancels" language implies, since the appointment still exists and the patient still needs reminding, just at a different time.

## Testing

Same established e2e pattern: real HTTP requests via supertest against a real Postgres, no mocks. New file `backend/test/consultation-reminders.e2e-spec.ts`:

- A `SCHEDULED` consultation with `scheduledAt` 23 hours from now and no reminder flags set gets a day-before reminder after the sweep runs, and `dayBeforeReminderSentAt` is stamped.
- The same consultation, swept again immediately, does not create a second day-before notification (idempotency).
- A `SCHEDULED` consultation with `scheduledAt` 45 minutes from now gets an hour-before reminder (independent of whether the day-before one already fired).
- A `SCHEDULED` consultation with `scheduledAt` 3 days out gets neither reminder yet.
- A `CANCELLED` consultation due within the window gets no reminder.
- Rescheduling a consultation that already has both reminder timestamps stamped (via `PATCH` with a new `scheduledAt`) resets both to null; a subsequent sweep against the new time re-fires the appropriate reminder(s).
- Since `@Interval` runs on a wall-clock timer unsuitable for a deterministic e2e test, the sweep's logic is exposed as a plain method the test calls directly (e.g. `consultationRemindersService.runSweep()`), with `@Interval` simply calling that same method — the decorator wiring itself is not itself covered by an integration test (there's no reasonable way to await a 5-minute timer in a test), only the sweep logic it invokes.

## Non-goals restated for clarity

Not building in this fix: §100 (daily training reminders — separate follow-on once cadence is decided), §104 (being investigated separately — may not need this infrastructure), admin-configurable reminder timing or channels (hardcoded 24h/1h constants, in-app only), any reminder to the assigned specialist, any real SMS/push/email delivery, and any generalized "scheduled jobs" abstraction beyond this one `@Interval` sweep — if a second, unrelated scheduled concern arises later (e.g. §100), it gets its own `@Interval` method, not a shared job-runner framework, matching this project's consistent "don't build shared infrastructure for a single current consumer" discipline.
