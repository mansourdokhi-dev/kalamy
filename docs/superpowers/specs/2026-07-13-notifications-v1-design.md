# Notifications v1 (In-App Engine + Specialist Review v2 Triggers) — Design

Status: Approved (brainstormed with the founder 2026-07-13 — three scope-boundary questions resolved below; one technical detail decided by the same low-risk-default reasoning used in every prior sub-project's design)
Date: 2026-07-13

## Context

`docs/superpowers/specs/2026-07-13-gap-analysis-corrected-spec.md` identified the central notification engine (§99–§107 of `docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md`) as entirely unbuilt — confirmed by direct code search finding zero notification-related code anywhere in the backend. Both Treatment Engine v2 and Specialist Review v2's design specs explicitly deferred this ("events are logged via AuditLog only, for now, not sent anywhere"). This is the first sub-project to actually build it, scoped to the events Specialist Review v2 (the most recently completed, most event-rich module) already produces.

**A foundational finding from this session's exploration, worth recording since it shapes every scope decision below:** there is no real SMS/push/email delivery infrastructure anywhere in this platform. Even the existing OTP registration flow doesn't send a real SMS — `AuthService.register`/`forgotPassword` only echo the code back in the API response when `DEV_MODE=true` (`backend/src/modules/auth/auth.service.ts:56,190`). Building this notification engine against a real external provider would be a first-of-its-kind integration, not an extension of an existing one.

## Scope decisions made with the founder (2026-07-13)

1. **In-app only for this version.** Notifications are recorded and served via a "my notifications" API a mobile client can poll and display — no real SMS/push/email is sent. This matches the OTP precedent (dev-mode/simulated first, real external delivery is a deliberate later step) and every other external-integration decision in this project (real payments, real video calls — all deferred with a stub/manual path first).
2. **Only the three events Specialist Review v2 already produces are wired in this pass**: a sample escalated for lacking a reservation past 24h, a specialist decision being issued, and a requested intervention timing out after 7 days unexecuted. Every other trigger in §99–§107 (training reminders, 72h-gate-open, consultation reminders, post-completion follow-up, etc.) is a clean, mechanically similar follow-on once this engine exists and is proven — not built now, matching this project's established one-module-at-a-time pattern.
3. **Message text is hardcoded Arabic in code, not admin-editable.** The spec's admin-content-management requirement is aimed at clinical content (training videos, cognitive questions, technique instructions) that a supervisor needs to edit — not short, fixed system messages like "your sample was reviewed." An admin-editable template system is real scope (draft/publish/versioning, an admin UI) disproportionate to three fixed messages; a future need for frequent wording changes is a small, isolated follow-on, not an architecture-affecting decision now.
4. **Notifications are created synchronously, inline, at the exact point the triggering event happens** — the same way `AuditLog` entries are already written in this codebase (no event bus, no message queue, no background job; this project introduces none of those, matching the "don't add new infrastructure without proven need" reasoning already used for Specialist Review v2's lazy SLA evaluation).
5. **Backend only.** A mobile "notifications inbox" screen is a natural, separate follow-on sub-project — every other backend module in this platform (Treatment Engine v2, Specialist Review v2, Reports, Complaints) shipped backend-first with mobile screens as a later, dedicated sub-project; this is no different.

## Data model

```prisma
model Notification {
  id              String            @id @default(uuid())
  recipientUserId String
  recipient       User              @relation(fields: [recipientUserId], references: [id])
  type            NotificationType
  title           String
  body            String
  relatedEntity   String?           // e.g. "SpeechSample" — for future deep-linking; not consumed by any endpoint in this pass
  relatedEntityId String?
  readAt          DateTime?
  createdAt       DateTime          @default(now())

  @@index([recipientUserId, createdAt])
}

enum NotificationType {
  SAMPLE_ESCALATED_TO_SUPERVISOR
  SPECIALIST_DECISION_ISSUED
  INTERVENTION_TIMED_OUT
}
```

`relatedEntity`/`relatedEntityId` are populated now (the sample/cycle the notification is about) even though no endpoint in this pass exposes deep-linking — cheap to capture at creation time, expensive to backfill later if a mobile follow-on wants it.

## `NotificationsService`

A single new service, in a new standalone `NotificationsModule` (mirroring how `ConsultationsModule` was added in Specialist Review v2 — a small, self-contained concern, not folded into `treatment-engine/`):

- `create(recipientUserId: string, type: NotificationType, context: Record<string, string>): Promise<Notification>` — looks up a hardcoded Arabic template function for `type`, interpolates `context` (e.g., `{ patientName, levelName }`) into `title`/`body`, creates the row. One recipient per call.
- `notifyRole(role: Role, type: NotificationType, context: Record<string, string>): Promise<Notification[]>` — queries every `User` with the given `role` (`SUPERVISOR`/`ADMIN` for this pass's two broadcast cases) and calls `create` for each. No deduplication logic needed at this scale (a handful of supervisor/admin accounts); revisit only if that assumption stops holding.
- `listForUser(userId: string): Promise<Notification[]>` — the caller's own notifications, newest first.
- `markRead(notificationId: string, actor: AuthenticatedUser): Promise<Notification>` — sets `readAt`; throws `ForbiddenException` if `notification.recipientUserId !== actor.id` (a user can only mark their own notifications read — no staff override needed for this pass, since there's no "manage other users' notifications" requirement in scope).

Templates live as a single internal function/lookup table in the service file (e.g., a `NOTIFICATION_TEMPLATES: Record<NotificationType, (ctx) => { title: string; body: string }>` object) — not a separate file or content-managed table, per scope decision 3.

## Wiring into `specialist-review.service.ts`

Three call sites, each a single `notificationsService.create(...)`/`notifyRole(...)` call added at the exact point the event already fires — no new business logic, no new state:

1. **`evaluateReviewDeadlines`'s 24h-unreserved escalation branch** (currently sets `escalatedAt`): after setting it, call `this.notificationsService.notifyRole('SUPERVISOR', 'SAMPLE_ESCALATED_TO_SUPERVISOR', { patientName, levelName })`. `SUPERVISOR` only, not `ADMIN` too, despite the scope summary above saying "SUPERVISOR/ADMIN" loosely — on reflection, `ADMIN` already sees everything via admin reporting and this specific escalation is a clinical-oversight concern the design spec ties to the supervisor role (§9's "يصعّد النظام للمشرف"); **decided now, not asked, since re-reading the governing text is unambiguous on this point and asking would be re-litigating a already-answered spec detail, not a real open question.**
2. **`review()`'s decision branches** (`TRANSITION`, `LEVEL_REPEAT`, `TECHNICAL_RERECORD` — all three, since the patient should learn a decision was made regardless of which one): after the `$transaction` commits, call `this.notificationsService.create(patientUserId, 'SPECIALIST_DECISION_ISSUED', { decision, levelName })`. `patientUserId` is resolved via the existing `patientProfile.userId` relation, looked up once per call (this data isn't already loaded in `review()`'s current scope, so one small additional query is needed — acceptable, matches the cost of similar existing lookups elsewhere in this service).
3. **`evaluateReviewDeadlines`'s 7-day intervention-timeout branch** (currently sets `escalatedAt`): after setting it, call `notifyRole('SUPERVISOR', 'INTERVENTION_TIMED_OUT', { patientName, levelName })`.

## New endpoints

New `NotificationsController` in the new `NotificationsModule`:

- `GET /api/v1/notifications` — `listForUser(currentUser.id)`. Guarded by `@RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)`, a new permission granted to every role (`PATIENT`, `CAREGIVER`, `CLINICIAN`, `SUPERVISOR`, `ADMIN`) — everyone can see their own inbox.
- `PATCH /api/v1/notifications/:notificationId/read` — `markRead(notificationId, currentUser)`. Same permission.

No patient-scoping (`:patientId` in the URL) needed — a notification's recipient is inherent to the row, not a patient-profile-scoped resource the way samples/consultations are.

## Testing

Same established e2e pattern as every prior module: real HTTP requests against a real Postgres, no mocks.

- Unit-level coverage of `NotificationsService.create`/`notifyRole`/`markRead` via `backend/test/notifications.e2e-spec.ts` (list-mine, mark-read, mark-read-rejects-someone-elses-notification).
- Three integration tests appended to the existing Specialist Review v2 suites (`treatment-engine-specialist-review-queue.e2e-spec.ts`, `treatment-engine-specialist-review.e2e-spec.ts`) confirming each of the three trigger points actually creates the right notification for the right recipient(s) — e.g., after the 24h-escalation branch fires, assert a `SUPERVISOR`-role test user's `GET /api/v1/notifications` includes the new entry.

## Non-goals restated for clarity

Not building in this sub-project: real SMS/push/email delivery, any trigger besides the three named above (training reminders, 72h-gate-open notification, consultation reminders, post-completion follow-up — all future, mechanically similar follow-ons), admin-editable notification templates, per-user notification preferences (§107 — all three notification types are treated as non-optional for now), mobile UI, and any notification-related reporting/analytics dashboard.
