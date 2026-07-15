# §107 Notification Preferences — Design

## Goal

Implement governing-spec point §107: let a patient turn off some non-critical notification types, while guaranteeing that notifications tied to a clinical decision, a confirmed appointment, or an action required to continue the program can never be silenced.

Governing spec text (point 107, `docs\KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md:1004`):

> **107. تفضيلات الإشعارات وعدم تعطيل التنبيهات الحرجة**: يستطيع المستفيد ضبط بعض تفضيلات الإشعارات غير الحرجة وقنواتها. أما الإشعارات الأساسية المرتبطة بقرار سريري أو موعد مؤكد أو إجراء مطلوب لاستمرار البرنامج، فلا تُعامل كرسائل تسويقية ولا تختفي بسبب إلغاء الاشتراك في الرسائل الترويجية. يفصل النظام بين الإشعارات العلاجية والتشغيلية والتسويقية.

Translated: the patient can adjust some non-critical notification preferences and their channels. Essential notifications tied to a clinical decision, a confirmed appointment, or an action required to continue the program are never treated as marketing messages and never disappear due to unsubscribing from promotional messages. The system separates therapeutic, operational, and marketing notifications.

## Why this was blocked until now, and why it's unblocked today

A prior gap-analysis pass (2026-07-14) investigated §107 and deliberately deferred it: at that point every one of the system's `NotificationType` values was patient-facing-and-critical or staff-facing, so there was zero notification type this feature could actually gate — building a preferences model with nothing to enforce it against would have been unused infrastructure. That pass explicitly flagged §100 and §106 as the features that would eventually create the first genuinely non-critical, disable-able type. Both are now built (2026-07-15), plus §101–§104. This design classifies every `NotificationType` that exists today against §107's own three-part critical test.

## Classifying the ten existing `NotificationType` values

§107's own text defines "critical" as: tied to a clinical decision, a confirmed appointment, or an action required to continue the program. Applying that test:

| Type | Recipient | Critical? | Why |
|---|---|---|---|
| `SPECIALIST_DECISION_ISSUED` | patient | Yes | A clinical decision. |
| `SAMPLE_ELIGIBLE_FOR_RECORDING` | patient | Yes | Action required to continue the program (unlocks the required sample step). |
| `SAMPLE_SUBMISSION_REMINDER` | patient | Yes | Action required to continue the program (2-day submission deadline). |
| `CONSULTATION_REMINDER` | patient | Yes | A confirmed appointment, verbatim. |
| `DAILY_TRAINING_REMINDER` | patient | **No** | A motivational dose nudge, not a blocking gate — missing a day doesn't stop the program; only the separate, much-later §98 one-month-inactivity closure does. This is exactly the "some non-critical notification preferences" case §107 describes. |
| `SAMPLE_ESCALATED_TO_SUPERVISOR` | staff (`SUPERVISOR`) | N/A | Not sent to a patient. §107's text ("المستفيد") scopes preferences to the patient/beneficiary only. |
| `INTERVENTION_TIMED_OUT` | staff (`SUPERVISOR`) | N/A | Same as above. |
| `SAMPLE_AVAILABLE_FOR_REVIEW` | staff (all qualified `CLINICIAN`s) | N/A | Same as above. |
| `SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR` | staff (`SUPERVISOR`) | N/A | Same as above. |
| `SPECIALIST_WORKLOAD_REMINDER` | staff (reservation holder) | N/A | Same as above. |

Result: **`DAILY_TRAINING_REMINDER` is the only type this feature gates.** Everything else stays forced-on, either because §107 marks it critical or because §107 doesn't apply to staff recipients at all.

## Scope

In scope:
- A per-user, per-type enable/disable preference, enforced at the single point every notification passes through (`NotificationsService.create`), so no individual call site needs to change.
- An explicit allow-list (`GATEABLE_NOTIFICATION_TYPES`), not a deny-list. Defaulting to "cannot be disabled unless explicitly allow-listed" means a future new `NotificationType` is critical-by-default until someone deliberately decides otherwise — the safer failure mode for a clinical product, and match §107's own framing ("some... preferences," implying most types stay untouched).
- Two endpoints on the existing patient-facing `NotificationsController`: list current preferences (with types never explicitly set defaulting to enabled), and update one type's preference.
- The `MANAGE_CONSULTATION`... no — reuse the existing `VIEW_OWN_NOTIFICATIONS` permission (already granted to every role) for both endpoints, since a user only ever reads/writes their own preference row, keyed by their own session identity — there's no cross-user access path to guard against, unlike `markRead`, which is keyed by a notification ID a caller could otherwise probe.

Out of scope, all deliberate, matching this project's repeated "narrow spec language to what's actually implemented" precedent (§100, §102, §106):
- "Channels" (قنواتها). The entire notification system is in-app-only — no SMS/push/email integration exists anywhere in this codebase. A channel preference would gate nothing real. Revisit only once a second channel exists.
- Separating "operational" vs. "marketing" categories. No marketing/promotional notification type exists in this system at all (every type is therapeutic or staff-operational). §107's category-separation clause has nothing to separate yet.
- Admin-configurability of which types are gateable (that's §99's territory — the allow-list stays a hardcoded constant, matching every other timing/config constant in this project).
- Extending gating to staff-facing types. §107's text is patient-scoped.
- Mobile UI. Backend-only, matching the established pattern for every notification-engine feature this session.

## Architecture

### Data model

One new table:

```prisma
model NotificationPreference {
  id        String           @id @default(uuid())
  userId    String
  user      User             @relation(fields: [userId], references: [id])
  type      NotificationType
  enabled   Boolean
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  @@unique([userId, type])
}
```

No row exists until a user explicitly changes a preference away from the default — lazy creation, matching this codebase's established "don't pre-seed state nobody asked for" convention (e.g. `TrainingCycle72h.lastDailyReminderSentAt`, `SpeechSample.deadlineReminderSentAt`). Absence of a row means "default: enabled."

### Enforcement point

`NotificationsService.create` gains one guard before the insert:

```typescript
async create(
  recipientUserId: string,
  type: NotificationType,
  context: Record<string, string>,
  related?: { entity: string; entityId: string },
): Promise<Notification | null> {
  if (GATEABLE_NOTIFICATION_TYPES.includes(type)) {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: recipientUserId, type } },
    });
    if (preference && !preference.enabled) {
      return null;
    }
  }
  const { title, body } = NOTIFICATION_TEMPLATES[type](context);
  return this.prisma.notification.create({
    data: { recipientUserId, type, title, body, relatedEntity: related?.entity, relatedEntityId: related?.entityId },
  });
}
```

The `GATEABLE_NOTIFICATION_TYPES.includes(type)` guard means the extra query only ever runs for the one type that can possibly be disabled — every other `create()` call (the other 9 types, the large majority of call sites) pays zero cost. `notifyRole` calls `create()` per-recipient internally, so a future gateable broadcast type would be gated automatically with no changes to `notifyRole` itself — not exercised today since no broadcast type is gateable, but the mechanism doesn't special-case it either.

**Return type changes from `Promise<Notification>` to `Promise<Notification | null>`.** Verified every existing call site (`consultation-reminders.service.ts:50`, `samples.service.ts:192` via `notifyRole`, `specialist-workload-reminder-sweep.service.ts:49`, `specialist-review.service.ts:140,185,235`, `training-cycles.service.ts:162,172`, `training-reminder-sweep.service.ts:46`, `training-sessions.service.ts:102`) is a bare `await this.notificationsService.create(...)` / `notifyRole(...)` inside a try/catch with the return value never captured — the wider return type is a compile-time-safe change with no call-site updates needed.

### Endpoints

Added to the existing `NotificationsController` (`api/v1/notifications`), reusing `Permission.VIEW_OWN_NOTIFICATIONS`:

- `GET /api/v1/notifications/preferences` → `Array<{ type: NotificationType; enabled: boolean }>`, one entry per `GATEABLE_NOTIFICATION_TYPES` value, reading the caller's own rows and defaulting to `enabled: true` for any type with no row yet. Only ever returns gateable types — there is nothing for a client to toggle among the critical/staff types, so they're not listed at all (a client asking "what can I turn off" should see only things it can turn off).
- `PATCH /api/v1/notifications/preferences/:type` with body `{ enabled: boolean }` → upserts the caller's preference row for `:type`. Rejects with `400 Bad Request` if `:type` is not in `GATEABLE_NOTIFICATION_TYPES` (including a syntactically valid but non-gateable `NotificationType` like `SPECIALIST_DECISION_ISSUED`, and any string that isn't a `NotificationType` at all) — this is the concrete enforcement of §107's "critical notifications never disappear" guarantee at the API surface, on top of the fact that even a manually-inserted DB row for a non-gateable type would still be ignored by `create()`'s guard (defense in depth, not the only line of defense).

### Migration

One new table, no changes to any existing table. Additive, zero risk to existing data — same safety class as every other notification-feature migration this session.

## Error Handling

No new error-handling surface beyond standard NestJS validation (`400` for a malformed body or a non-gateable `:type`) and the existing global exception handling. The preference check inside `create()` is a plain boolean gate, not a call that can itself fail independently of the DB — no new try/catch needed there.

## Testing

New e2e file `notification-preferences.e2e-spec.ts`, following `notifications.e2e-spec.ts`'s exact pattern. Cases:
- `GET /preferences` defaults every gateable type to `enabled: true` when no row exists yet.
- `PATCH /preferences/DAILY_TRAINING_REMINDER` with `{ enabled: false }` persists, and a subsequent `GET` reflects it.
- Toggling back to `{ enabled: true }` works (upsert, not insert-only).
- `PATCH /preferences/SPECIALIST_DECISION_ISSUED` (a real, critical `NotificationType`) is rejected `400` — proves the allow-list actually blocks a syntactically valid but non-gateable type, not just garbage input.
- `PATCH /preferences/NOT_A_REAL_TYPE` is rejected `400`.
- End-to-end enforcement: a patient who disables `DAILY_TRAINING_REMINDER` gets no notification from a real `TrainingReminderSweepService.runSweep()` call that would otherwise have sent one; a different patient who never touched their preference still gets it (per-user scoping, not a global kill switch).
- Defense-in-depth: even if a `NotificationPreference` row with `enabled: false` is seeded directly via Prisma for a non-gateable type (bypassing the API's own validation), a direct `NotificationsService.create()` call for that type still creates the notification — proves the `create()`-level guard is scoped to `GATEABLE_NOTIFICATION_TYPES`, not "any row that happens to exist."

## Non-goals restated for clarity

Not building in this pass: notification channels/multi-channel delivery (nothing to gate — in-app-only system), therapeutic/operational/marketing category separation (no marketing type exists), admin-configurable gateable-type list (§99), gating for staff-facing types, mobile UI.
