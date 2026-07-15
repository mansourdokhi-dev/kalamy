# §99 Admin-Configurable Notification Engine — Design

## Goal

Implement governing-spec point §99: reminder timing must not be hardcoded in the code, and the platform must keep an audit record of each notification including its channel.

Governing spec text (point 99, `docs\KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md:996`):

> **99. محرك إشعارات مركزي قابل للإدارة**: يجب ألا تكون رسائل التذكير ومواعيدها مثبتة داخل الكود. يدعم النظام محرك إشعارات مركزيًا تحدد الإدارة من خلاله نوع الحدث، المستلم، القناة، توقيت الإرسال، عدد مرات التكرار، ووقت التوقف. تحفظ المنصة سجلًا لكل إشعار: السبب، الوقت، القناة، وحالة التسليم والفتح.

Translated: reminder messages and their timings must not be hardcoded. The system supports a central notification engine through which the administration defines: event type, recipient, channel, send timing, repeat count, and stop time. The platform stores a log for every notification: reason, time, channel, and delivery/read status.

## Why this is the last piece of the §99–107 notification engine

Every other point in this range (§100–107) is now built. Each one deliberately deferred admin-configurability of its own hardcoded constants to this point — §100's design spec says it explicitly ("the 15-minute sweep interval and the 7/day target stay hardcoded... no admin UI for this pass"), and so do §102, §104, §106, §107. This design is where that deferred debt gets addressed — but only the part of it that's real, addressable, and safe to expose to an administrator.

## Classifying §99's six configuration dimensions

§99 lists six things an administrator should be able to configure. Applying the same discipline this project has used for every prior over-broad spec clause (§100's "channels," §107's "channels" and "categories" — narrow to what's real and safe, not what would be dangerous or meaningless to build):

| Dimension | Configurable in this pass? | Why |
|---|---|---|
| **توقيت الإرسال (send timing)** | **Yes** | This is the one dimension with real, safe, already-hardcoded values to expose: the four "how far before a deadline/appointment does the reminder fire" lead times (§104's two, §106's two). Changing these can't break correctness — worst case, an admin sets a nudge too early or too late. |
| **القناة (channel)** | **Recorded, not selectable** | Exactly one channel (`IN_APP`) exists in this system — there is nothing to choose between. Recording which channel was used on every `Notification` row (see Data Model) satisfies the literal audit-log requirement without building unused multi-channel infrastructure, matching the exact "channels" deferral already made in §100's and §107's design specs. |
| **نوع الحدث (event type)** | **No** | Event type is intrinsic to which code path fired — "a sample was submitted" cannot be reassigned to mean something else by an admin setting. Not a configuration dimension, a fact about the trigger. |
| **المستلم (recipient)** | **No** | Every recipient in this system is chosen for a specific correctness reason: `SPECIALIST_DECISION_ISSUED` must go to the patient it's about, `SAMPLE_ESCALATED_TO_SUPERVISOR` must go to `SUPERVISOR`s, `SPECIALIST_WORKLOAD_REMINDER` must go to whichever specialist holds the reservation. Letting an admin redirect a clinical notification's recipient is a patient-safety risk with no demonstrated product need, not a configuration knob. |
| **عدد مرات التكرار (repeat count)** | **No** | Every reminder in this system fires at most once per relevant period, by design, enforced by an idempotency stamp (`lastDailyReminderSentAt`, `deadlineReminderSentAt`, `dayBeforeReminderSentAt`/`hourBeforeReminderSentAt`). Supporting an admin-configurable repeat count would mean redesigning every one of those stamps into a counter-plus-cooldown model — a large, separate piece of work with no product ask behind it yet. |
| **وقت التوقف (stop time)** | **No** | Each sweep already has its own correct, business-logic-driven stop condition baked in (target met, deadline passed, cycle no longer in the relevant status). These conditions differ per notification type and don't compose into one generic "stop time" field without either duplicating or conflicting with the real business rule. |

**Bottom line: this pass builds admin-configurable send-timing values, plus a channel field on every notification's audit record.** Event type, recipient, repeat count, and stop time stay exactly as they are today — hardcoded because they're either facts, correctness-critical, or a materially separate piece of future work.

## Scope

### In scope: four configurable lead-time values

| Setting key | Governs | Current hardcoded value | File |
|---|---|---|---|
| `SPECIALIST_WORKLOAD_REVIEW_LEAD_MS` | How long before the 48h review-decision deadline a specialist gets reminded | 24h (`REVIEW_REMINDER_LEAD_MS`) | `specialist-workload-reminder-sweep.service.ts:8` |
| `SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS` | How long before the 7-day intervention deadline a specialist gets reminded | 24h (`INTERVENTION_REMINDER_LEAD_MS`) | `specialist-workload-reminder-sweep.service.ts:9` |
| `CONSULTATION_REMINDER_DAY_BEFORE_MS` | The "day before" consultation reminder window | 24h (`DAY_BEFORE_WINDOW_MS`) | `consultation-reminders.service.ts:6` |
| `CONSULTATION_REMINDER_HOUR_BEFORE_MS` | The "hour before" consultation reminder window | 1h (`HOUR_BEFORE_WINDOW_MS`) | `consultation-reminders.service.ts:7` |

### Explicitly out of scope, and why

- **Sweep polling intervals** (`SWEEP_INTERVAL_MS` in each of the three sweep services — 15min/15min/5min). These govern "how often does the background job check," an implementation/infrastructure detail, not "توقيت الإرسال" (send timing relative to the event) in any sense a non-technical administrator would recognize as a notification policy. Making `@Interval`'s registered interval itself runtime-configurable would additionally require NestJS's `SchedulerRegistry` dynamic-interval API (`deleteInterval`/`addInterval`) instead of the simple decorator every sweep in this codebase currently uses — a materially larger, riskier change for a dimension with no real product value behind it.
- **§100's daily-training interval-gate (1h) and daily target (7/day)**. These are clinical training-dose parameters governed by the treatment protocol, not notification-reminder timing — §100's reminder only borrows their computed state (`intervalActive`, `completedToday`), it doesn't own them.
- **§102's/§103's/§109's escalation windows** (24h-unreserved, 48h-undecided, 7-day-intervention — the same three durations the two new lead times above are *measured against*). These are SLA/escalation timers with real clinical and (per the governing spec's SLA framing elsewhere) potentially contractual weight — not "reminder" timing in the sense §99 means. Left untouched; only the *reminder that precedes* them becomes configurable, not the deadline itself.
- **Mobile/staff-web UI for administering these settings.** Backend-only, matching the established pattern for every notification-engine feature this session. A future admin UI would present these as human units (e.g. "24 hours") rather than the raw millisecond value stored internally — that presentation-layer translation is part of that future UI work, not this pass.

### A real invariant this design must protect

`ConsultationRemindersService`'s own code comment states the constraint explicitly: the day-before window's lower bound is pinned to the hour-before window's upper bound so the two windows never overlap — a consultation booked with, say, 45 minutes' notice must only ever trigger the hour-before reminder, never both. If an administrator could set `CONSULTATION_REMINDER_HOUR_BEFORE_MS >= CONSULTATION_REMINDER_DAY_BEFORE_MS`, that invariant breaks and a patient could receive both reminders simultaneously with the factually-wrong "your consultation is tomorrow" text firing on a same-day booking. The settings-update endpoint must reject such a combination (see Validation below) — this isn't optional hardening, it's protecting a correctness property the original implementation already went out of its way to guarantee.

## Architecture

### Data model

A generic key-value settings table, not one column per setting — this project has repeatedly added new individually-named timing constants (§100, §104, §106 each added their own), so a table that can hold N settings without a schema migration per new key is the right shape for what's explicitly meant to grow:

```prisma
model NotificationSetting {
  key       String   @id
  valueMs   Int
  updatedAt DateTime @updatedAt
}
```

Lazy creation, same convention as `NotificationPreference` (§107): no row exists until an admin changes a value away from its hardcoded default. Absence of a row means "use the default."

One new field on the existing `Notification` model, satisfying the audit-log's channel requirement:

```prisma
enum NotificationChannel {
  IN_APP
}

model Notification {
  ...
  channel NotificationChannel @default(IN_APP)
  ...
}
```

`readAt` already covers "حالة... الفتح" (open/read status). "حالة التسليم" (delivery status) needs no new field: every notification in this system is created synchronously in the same request/sweep tick that decides to send it — there is no async delivery pipeline that could leave a notification undelivered-but-recorded. `createdAt` already *is* the delivery timestamp; a separate `deliveredAt` column would always equal `createdAt` with zero behavioral difference, so it's not added.

### `NotificationSettingsService` (new, lives in the existing `notifications` module)

```typescript
export const NOTIFICATION_SETTING_DEFAULTS_MS: Record<string, number> = {
  SPECIALIST_WORKLOAD_REVIEW_LEAD_MS: 24 * 60 * 60 * 1000,
  SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS: 24 * 60 * 60 * 1000,
  CONSULTATION_REMINDER_DAY_BEFORE_MS: 24 * 60 * 60 * 1000,
  CONSULTATION_REMINDER_HOUR_BEFORE_MS: 60 * 60 * 1000,
};
```

- `getValueMs(key: string): Promise<number>` — returns the stored row's `valueMs`, or the hardcoded default if no row exists. Called by both sweep services on every tick, same lazy-read pattern already used throughout this codebase (e.g. `getProgress`, `evaluateReviewDeadlines`).
- `listAll(): Promise<Array<{ key: string; valueMs: number }>>` — one entry per key in `NOTIFICATION_SETTING_DEFAULTS_MS`, defaulting to the hardcoded value when no row exists. Same shape as §107's `listPreferencesForUser`.
- `updateValue(key: string, valueMs: number): Promise<{ key: string; valueMs: number }>` — validates:
  1. `key` is one of the four keys in `NOTIFICATION_SETTING_DEFAULTS_MS` (allow-list, `400` otherwise) — same allow-list-not-deny-list posture as §107's `GATEABLE_NOTIFICATION_TYPES`, for the same reason: a future new setting is unconfigurable-by-default until deliberately added here.
  2. `valueMs` is a positive integer (`400` otherwise).
  3. If `key` is `SPECIALIST_WORKLOAD_REVIEW_LEAD_MS`, it must be less than `REVIEW_DECISION_WINDOW_MS` (48h) — a lead time equal to or larger than the window it's measured against would fire the reminder the instant the reservation is made, which is a valid-if-odd admin choice but a nonsensical one; `400` if violated. Same bound for `SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS` against the 7-day intervention window.
  4. If `key` is `CONSULTATION_REMINDER_DAY_BEFORE_MS` or `CONSULTATION_REMINDER_HOUR_BEFORE_MS`, re-derive the *other* value (via `getValueMs`, so it correctly sees either a stored override or the default) and reject with `400` unless `hourBefore < dayBefore` holds after the update — this is the invariant identified above, enforced at write time rather than left as a footgun.
  5. Upserts the row.

### Consumers

`SpecialistWorkloadReminderSweepService.runSweep` currently reads `REVIEW_REMINDER_LEAD_MS`/`INTERVENTION_REMINDER_LEAD_MS` as module-level constants (`specialist-workload-reminder-sweep.service.ts:41`). Replace with `await this.notificationSettingsService.getValueMs('SPECIALIST_WORKLOAD_REVIEW_LEAD_MS')` / `'SPECIALIST_WORKLOAD_INTERVENTION_LEAD_MS'`, read once per sample inside the existing loop (matches the existing per-sample `getNotificationContext` call already inside that same loop — no new query-batching concern introduced).

`ConsultationRemindersService.runSweep` currently reads `DAY_BEFORE_WINDOW_MS`/`HOUR_BEFORE_WINDOW_MS` as module-level constants, passed into `sendDueReminders` twice. Replace by reading both settings once at the top of `runSweep` (not once per consultation — there's no per-row reason to re-read the same tick's settings twice) and passing the resolved values into the two `sendDueReminders` calls exactly where the constants were passed before.

Both sweep services gain a constructor dependency on `NotificationSettingsService`, injected via `NotificationsModule` (both already import it).

### Admin endpoints

New `NotificationSettingsController` on `api/v1/admin` (the existing admin route prefix, matching `AdminUsersController`), living in the `notifications` module alongside the service:

- `GET /api/v1/admin/notification-settings` → `Array<{ key: string; valueMs: number }>`, all four keys, defaulting to hardcoded values.
- `PATCH /api/v1/admin/notification-settings/:key` with body `{ valueMs: number }` → upserts, applying all the validation above.

New permission `MANAGE_NOTIFICATION_SETTINGS`, granted only to `ADMIN` — matching the precedent of `MANAGE_USER_ACCOUNTS`/`CREATE_STAFF_ACCOUNT` (admin-only, not even `SUPERVISOR`), since these settings affect clinical-workflow-adjacent timing across the whole platform.

## Migration

Two additive changes: one new table (`NotificationSetting`), one new nullable-by-default column with a default value (`Notification.channel`, backfilled to `IN_APP` for every existing row via the column default). Zero risk to existing data.

## Testing

Two new e2e files, following this session's established patterns:
- `notification-settings.e2e-spec.ts`: `GET`/`PATCH` against real values, including the day-before/hour-before ordering rejection and the lead-time-vs-window bound rejection, and a non-`ADMIN` role getting `403`.
- Extensions to `treatment-engine-specialist-workload-reminder.e2e-spec.ts` and `consultation-reminders.e2e-spec.ts`: a real admin `PATCH` changes the effective lead time, then a real `runSweep()` call proves the sweep actually used the new value (not the hardcoded default) — the same "drive it through the real endpoint, not a Prisma shortcut" discipline §107's enforcement test used.

## Non-goals restated for clarity

Not building in this pass: event-type/recipient/repeat-count/stop-time configurability (see classification table — each has a concrete reason, not a deferral for its own sake), sweep-polling-interval configurability, multi-channel delivery, mobile/staff-web admin UI.
