# Specialist Review v2 (Queue, SLA, Direct Intervention, Free Consultation) — Design

Status: Approved (brainstormed with the founder 2026-07-13 — three scope-boundary questions resolved below; the rest is dictated verbatim by the governing spec, same as Treatment Engine v2's precedent)
Date: 2026-07-13

## Context

`docs/superpowers/specs/2026-07-13-gap-analysis-corrected-spec.md` identified this as the single largest unbuilt piece of the platform relative to `docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md`. Treatment Engine v2 (2026-07-08) deliberately deferred all of this — it built the *basic* specialist decision (`SpecialistReviewService.review()`: transition / repeat / technical-partial-rerecord) but explicitly left out "the review-queue mechanics — visible-to-all-until-locked, the independent 24h/48h SLA timers, auto-release on timeout, escalation, direct intervention, and the single free consultation" for this follow-on sub-project.

Two of the 13 states Treatment Engine v2 already added to `LevelCycleStatus` exist for exactly this purpose but are currently dead — never entered or exited by any code: `DIRECT_INTERVENTION_REQUIRED` and `WAITING_FINAL_DECISION_AFTER_INTERVENTION`. This project activates them.

## Scope decisions made with the founder (2026-07-13)

1. **No real-time video/voice calling infrastructure.** Direct intervention and the free consultation are booked, tracked, and documented by this system; the actual meeting happens over an externally-provided link (Zoom/Google Meet/etc.) that the specialist or admin enters manually — the same way human-model videos are managed as admin content today, not live-streamed.
2. **In-app messaging (§72–§80) is explicitly out of scope**, deferred to its own future sub-project, matching this project's established pattern of splitting distinct concerns (Reports vs. Complaints, Admin vs. Supervision).
3. **Paid consultations are entirely out of scope.** Only the one free consultation is built. No price/booking UI for paid consultations is built ahead of the (separate, not-yet-started) Payments module.
4. **SLA timers are evaluated lazily, on read** — the same pattern already used for `CLOSED_DUE_TO_INACTIVITY` in `training-cycles.service.ts`'s `getCurrent()`. No new background job scheduler is introduced. This is a deliberate, revisitable choice: since the Notifications engine (the thing that would actually alert someone in real time) is itself a separate, not-yet-started sub-project, a background job would enforce a deadline nobody is watching in real time anyway. Upgrading to a real scheduled job later is a self-contained change to one internal method, not a data-model change.

## Data model changes

### Extending `SpeechSample` (reservation, SLA, escalation, intervention)

These fields describe the *review lifecycle* of a specific submitted sample, so they live alongside the existing `decision`/`reviewedByUserId`/`reviewNotes`/`reviewedAt` fields already on `SpeechSample` rather than in a new model — same rationale Treatment Engine v2 used for keeping decision fields there instead of a separate table.

```prisma
model SpeechSample {
  // ...existing fields (decision, reviewedByUserId, reviewNotes, reviewedAt, clinicianOpinionScore, parts, etc.)

  // --- Queue / reservation (§9, corrected point on §103/113/114) ---
  reservedByUserId    String?
  reservedAt          DateTime?
  reviewDeadlineAt    DateTime?   // reservedAt + 48h; recomputed if intervention completes (see below)
  escalatedAt         DateTime?   // set once 24h passes with no reservation; cleared if later reserved

  // --- Direct intervention (§11, §12) ---
  interventionType           InterventionType?
  interventionRequestedAt    DateTime?
  interventionDeadlineAt     DateTime?   // interventionRequestedAt + 7 days, for the escalation-if-not-executed rule
  interventionExecutedByUserId String?   // may differ from reservedByUserId/reviewedByUserId per §12
  interventionCompletedAt    DateTime?
  interventionOutcomeNotes   String?
}

enum InterventionType {
  VIDEO_MEETING
  VOICE_CONSULTATION
  TARGETED_MESSAGE
  CLINICAL_ACTION
}
```

`submittedAt` is not a new field — `SpeechSample.createdAt` (set at submission time, per the existing `submitSample` flow) is the 24h-before-reservation clock's start, documented explicitly here since it's easy to miss.

### New model: `Consultation` (the one free consultation, §63–§71 minus payments)

A patient-level entity, not tied to one sample/cycle — it's available once across the whole program, not once per level.

```prisma
model Consultation {
  id                  String   @id @default(uuid())
  patientProfileId    String
  patientProfile      PatientProfile @relation(fields: [patientProfileId], references: [id])
  requestedByUserId   String   // the patient's own user, or a guardian's — never inferred, always the acting user
  type                ConsultationType
  status              ConsultationStatus @default(REQUESTED)
  reasonNote          String?
  scheduledAt         DateTime?
  externalMeetingLink String?
  specialistUserId    String?
  outcomeNotes        String?
  completedAt         DateTime?
  cancelledAt         DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

enum ConsultationType {
  VIDEO
  VOICE
}

enum ConsultationStatus {
  REQUESTED
  SCHEDULING
  SCHEDULED
  COMPLETED
  CANCELLED
}
```

**Free-credit rule** (§63, §70, §71): a patient may create a new `Consultation` only if every existing `Consultation` for them has `status = CANCELLED`. A cancelled consultation does not consume the credit (§70's default policy — "not automatically considered used on cancellation"); only ever reaching `COMPLETED` does. This is enforced in the service layer with the same transactional row-lock pattern already used elsewhere in this module to avoid a double-booking race (§119).

### Responsibility transfer (§12) — reuses `AuditLog`, no new model

A supervisor-only action updates `SpeechSample.reservedByUserId` to the new specialist (clearing `reviewDeadlineAt`'s "in progress" state is not needed — the deadline itself doesn't reset on transfer, only the reviewer identity does, since the spec doesn't grant the new reviewer extra time) and writes one `AuditLog` entry recording the old reviewer, new reviewer, reason, and timestamp — exactly the shape `AuditLog` already exists for. No dedicated transfer-log table.

## State machine changes

Only the transitions into/out of the two already-existing-but-dead states are new; nothing about the 11 other states changes.

| From | Event | To | Governing rule |
|---|---|---|---|
| `WAITING_FOR_SPECIALIST` | A qualified specialist opens the review (first to do so) | `UNDER_REVIEW`; sets `reservedByUserId`/`reservedAt`/`reviewDeadlineAt` (+48h); clears `escalatedAt` if set (once reserved, there's nothing left for a supervisor to act on) | §9, correction on §103/113/114 |
| `WAITING_FOR_SPECIALIST` | 24h since `createdAt` with `reservedByUserId` still null | stays `WAITING_FOR_SPECIALIST`, but `escalatedAt` is set (visible to supervisors) | §9, AC-08 |
| `UNDER_REVIEW` | 48h since `reservedAt` with no decision and no intervention requested | back to `WAITING_FOR_SPECIALIST`; `reservedByUserId`/`reservedAt`/`reviewDeadlineAt` cleared; `AuditLog` entry records who lost the reservation, when, and why | §9, correction on §103/113/114, AC-08 |
| `UNDER_REVIEW` | Specialist requests direct intervention with a documented clinical reason | `DIRECT_INTERVENTION_REQUIRED`; the 48h `reviewDeadlineAt` timer is cleared (paused, not just extended — restarts fresh from completion, per §11's exact wording) | §11, AC-09 |
| `DIRECT_INTERVENTION_REQUIRED` | 7 days since `interventionRequestedAt` with no completion recorded | stays `DIRECT_INTERVENTION_REQUIRED`, escalates to supervisor (reuses the same `escalatedAt`-style flag) | §11 rule 104 |
| `DIRECT_INTERVENTION_REQUIRED` | Intervention outcome documented | `WAITING_FINAL_DECISION_AFTER_INTERVENTION`; a **new** 48h `reviewDeadlineAt` starts from `interventionCompletedAt` | §11, AC-09 |
| `WAITING_FINAL_DECISION_AFTER_INTERVENTION` | Same 48h timeout logic as `UNDER_REVIEW` applies | back to `WAITING_FOR_SPECIALIST` (auto-release) | §11, §9 |
| `WAITING_FINAL_DECISION_AFTER_INTERVENTION` | Specialist issues final decision | same as existing `UNDER_REVIEW` → `NEXT_LEVEL_APPROVED`/`LEVEL_REPEAT_DECIDED`/`TECHNICAL_PARTIAL_RERECORD` transitions, unchanged | §10 |

`review()` itself (the existing transition/repeat/technical-rerecord decision logic) is otherwise untouched — it already checks `status === 'WAITING_FOR_SPECIALIST' || status === 'UNDER_REVIEW'`; this project adds `WAITING_FINAL_DECISION_AFTER_INTERVENTION` to that same guard.

## Lazy SLA evaluation — where it lives

A single new method, e.g. `SpecialistReviewService.evaluateReviewDeadlines(sample)`, called at the start of every read/write path that touches a `SpeechSample` in a reviewable state (the "list available samples" endpoint, "open for review" endpoint, and `review()` itself) — mirroring exactly how `training-cycles.service.ts`'s `getCurrent()` already does this for `CLOSED_DUE_TO_INACTIVITY`. This keeps the deadline-enforcement logic in one place rather than scattered across every caller.

## New/changed endpoints

- `GET .../samples/available` — lists samples in `WAITING_FOR_SPECIALIST` across all patients this specialist is permitted to see, each evaluated for escalation first.
- `POST .../samples/:sampleId/reserve` — the "open for review" action; fails with 409 if already reserved by someone else.
- `POST .../samples/:sampleId/intervention` — request direct intervention (records type + reason).
- `POST .../samples/:sampleId/intervention/complete` — document intervention outcome.
- `POST .../samples/:sampleId/transfer` — supervisor-only responsibility transfer.
- `POST .../patients/:patientId/consultations` — patient (or guardian) requests the free consultation; 409 if one is already active or completed.
- `PATCH .../consultations/:id` — admin/specialist updates status (scheduling → scheduled → completed/cancelled), scheduled time, external link, outcome notes.
- Existing `POST .../review` — unchanged signature, guard condition widened to include `WAITING_FINAL_DECISION_AFTER_INTERVENTION`.

Permissions: reservation/intervention/review endpoints reuse `Permission.REVIEW_SAMPLE` (already granted to `CLINICIAN` and `SUPERVISOR`, confirmed in `permissions.ts`). Transfer requires a new `Permission.TRANSFER_REVIEW_RESPONSIBILITY`, granted to `SUPERVISOR` only.

## Error handling / edge cases

- Reserving an already-reserved sample: 409, not a silent no-op — the specialist needs to know someone beat them to it.
- Requesting a second `Consultation` while one is active: 409 with a message naming the existing one's status.
- Transfer to a specialist who hasn't independently opened the sample yet is still allowed (the transfer *grants* them the reservation) — but the transferred-to specialist must still go through the normal `review()` decision path himself; no draft or prior opinion carries over automatically (§113 — the new specialist reviews the original sample independently). Note: this project does not build a review-draft-save feature (§42/§122) — that's a related but separate gap noted in the gap analysis, out of scope here.
- Concurrent reserve attempts: same `SELECT ... FOR UPDATE` row-lock transaction pattern already used in `review()`, applied to the reservation write too.

## Testing

Same established pattern as every prior module: one full-flow e2e smoke test (submit → escalate-if-unreserved (time-travel 24h) → reserve → request intervention → complete intervention → final decision) plus one dedicated e2e test per AC-08/AC-09/AC-10, each asserting the exact rule it names — e.g. AC-08's test asserts a reservation is actually cleared and the sample reappears in the available list after simulated 48h with no decision.

## Non-goals restated for clarity

Not building in this sub-project: in-app messaging, paid consultations and any payment processing, real-time video/voice call infrastructure, the notifications engine (events are not emitted anywhere new for now — same "log to `AuditLog` only" holding pattern Treatment Engine v2 used), review-draft-save (§42/§122), age-based consultation UI variation beyond what the existing guardian/patient user model already supports structurally.
