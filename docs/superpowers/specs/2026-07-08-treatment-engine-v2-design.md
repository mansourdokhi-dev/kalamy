# Treatment Engine v2 (Levels, 72-Hour Cycle, Integrated Sample) — Design

Status: Approved (self-brainstormed — every rule below is already decided by the governing spec; no open product questions remain)
Date: 2026-07-08

## Context

The gap-analysis against `docs/KALAMY-EXECUTIVE-REFERENCE_Corrected-Unified-Spec.md` (the highest-priority governing document, per its own §1) found that the currently-merged Sessions+Progress backend module implements a **genuinely different, conflicting model** from what the spec requires — not an incomplete version of it:

| | Current (`backend/prisma/schema.prisma`) | Spec requires |
|---|---|---|
| Progression unit | `SessionTemplate.sessionNumber` — a hardcoded 1→30 counter (`patient-sessions.service.ts:155`: `if (currentTemplate.sessionNumber < 30)`) | A **level** system; number of levels is content-defined, not hardcoded, and progression is never numerically capped in code |
| Cycle length | `SessionTemplate.trainingDurationDays` (a variable number of calendar days per session, per the original contract's day-count table) | A **fixed 72-hour cycle**, gated by at least one real training event in each of three consecutive 24-hour periods — calendar days alone never satisfy it (§3, corrected point 58) |
| Sample | One `sampleVideoUrl` string per `PatientSession`; a "repeat" review decision creates an **entirely new session row** (`patient-sessions.service.ts` `review()`, lines 111-146) | **One integrated sample per cycle**, composed of multiple parts, submitted as a single package; a technical defect in one part triggers **only that part's** re-recording — never a full retake (§5, §8, §32-38) |
| Attempts | Not modeled at all | Max **10** recording attempts per sample-preparation session; deleting an attempt never restores the count (§6, AC-05) |
| States | `SessionStatus`: `IN_TRAINING / SUBMITTED / APPROVED / REPEAT_REQUIRED` (4 states) | 13 named states (§19), including states this current enum has no equivalent for at all (`WAITING_FOR_SPECIALIST`, `DIRECT_INTERVENTION_REQUIRED`, `TECHNICAL_PARTIAL_RERECORD`, `CLOSED_DUE_TO_INACTIVITY`, ...) |

This sub-project replaces the current model with the spec's model. It is the first of two closely related sub-projects:
1. **This spec — Treatment Engine v2**: the level/cycle/sample data model, the state machine, and the *basic* specialist decision action (a clinician can review a submitted sample and decide transition / repeat / technical-re-record).
2. **Next sub-project — Specialist Review v2** (not this spec): the review-queue mechanics — visible-to-all-until-locked, the independent 24h/48h SLA timers, auto-release on timeout, escalation, direct intervention, and the single free consultation. This is deliberately split out because it is a distinct concern (queue/SLA management) layered on top of the review action this spec provides, matching this project's established pattern of splitting closely-coupled-but-separable concerns (e.g., Reports vs. Complaints, Admin Users vs. Supervision).

**No product questions are open for this spec.** Every rule below is copied directly from the governing document, which the user has designated as authoritative and has explicitly instructed should not be re-confirmed. Where the document is silent on a purely technical detail (e.g., exact column types), that is this spec's call to make, documented inline.

## Data-model replacement: this is a breaking schema change, not an additive one

The `SessionTemplate`, `PatientSession`, and `SessionStatus` models/enum are removed and replaced — not extended in place — because their core progression unit (a hardcoded session number) cannot be reconciled with a level+cycle model without a fundamentally different shape. This is safe to do as a hard replacement, not a parallel-run migration, because:
- This repository is pre-launch: no real patient has ever gone through this flow (confirmed — all data created so far is dev/test fixtures created during this session's own live-verification steps).
- The project's own "never delete clinical history" rule (§18, §112) governs *real patient records*, not a placeholder schema for a flow that has never had a real patient use it.
- `TreatmentPlan.patientSessions` will be renamed to `TreatmentPlan.levelCycles` (or similar) — `TreatmentPlan`, `Assessment`, `PatientProfile`, and everything upstream of this module are untouched.

A single new Prisma migration drops the four old objects and creates the new ones described below. `TreatmentPlan.phase`/`TreatmentPhase` (the existing 5-phase enum from the Assessment+Treatment Plan module) is untouched — a `TreatmentPlan` still has a `phase`, and within it now progresses through **levels** instead of **numbered sessions**. `PhaseTransition` is untouched.

## Scope

**In scope:**
- `Level` / `LevelVersion` — content-managed levels (no hardcoded count or numeric cap), each version carrying its cognitive content, behavioral technique, human-model reference, training list, and sample-part template, per §25.14/§25.25's "بطاقة تنفيذ موحدة لكل مستوى علاجي."
- `TrainingCycle72h` — one per level attempt (first attempt or a repeat), tracking the three 24-hour activity periods and their gating, per §3 and corrected points 11-12, 58.
- `TrainingEvent` — one row per completed training event, feeding the 72-hour gate and the adherence/dose metrics (§8, §21) without those metrics ever gating progression.
- `SampleSession` (the "جلسة إعداد العينة" — preparation session, holding up to 10 recording attempts) and `SampleAttempt` (§6).
- `SpeechSample` — the single integrated official sample per cycle, composed of `SampleSamplePart` rows per the level's part template (§5, §25, §32-38), plus its self-evaluation and next-sample-prediction fields (§25.9, §25.26 — the existing `selfSeverityCurrent`/`selfSeverityExpectedNext`/`camperdownPerformanceRating`/`clientOpinionScore` fields on the old `PatientSession` move onto `SpeechSample`, unchanged in meaning).
- The 13-state machine (§19) as a `LevelCycleStatus` enum on `TrainingCycle72h`, with a state-transition table enforced in the service layer (no raw status writes from controllers).
- Basic specialist decision recording: `SpecialistReview` records who reviewed, when, and the decision (transition / repeat / technical-re-record-of-part-X), reusing the existing `clinicianUserId`/`reviewNotes`/`reviewedAt`/opinion-score fields conceptually, but scoped to `SpeechSample` instead of `PatientSession`.
- Full state-transition tests for every rule in the table below, plus the AC-01 through AC-12 acceptance criteria as automated e2e tests (mirroring how the original Sessions+Progress module's smoke tests were structured).

**Out of scope for this sub-project** (Specialist Review v2, a following sub-project, unless noted otherwise):
- Review-queue visibility/locking mechanics (any qualified specialist can review right away in v2 — no pooling, no lock).
- The 24h/48h SLA timers, auto-release-to-pool, and escalation to supervisor.
- Direct intervention and the single free consultation.
- The notification engine (a separate sub-project — this module will emit domain events but Notifications v1 doesn't exist yet to consume them; events are logged via the existing `AuditLog`, not sent anywhere, for now).
- Real media upload/storage (a separate sub-project — sample-part URLs remain plain string fields for now, exactly as before; the "technical fitness check before submission" rule from §5 — audio present, file playable — cannot be implemented until real upload infrastructure exists, so it is explicitly deferred and the plan will not fake it).
- Reviewing/reinforcing previously-completed levels (§16) — read-only access to past levels' content; scoped as a small follow-up once this module's core write-path is stable, since it only needs a GET endpoint with no new state.
- Mobile UI for any of this (a later mobile sub-project).

## The 13-state machine

`LevelCycleStatus` on `TrainingCycle72h`, per §19, with the Arabic state name preserved as a comment for spec traceability:

```
ACTIVE_LEVEL_TRAINING            -- تدريب المستوى النشط
SAMPLE_ELIGIBLE                  -- مستحق للعينة مع استمرار التدريب
SAMPLE_PREPARATION               -- إعداد العينة
SAMPLE_SUBMITTED                 -- أرسلت العينة
WAITING_FOR_SPECIALIST           -- انتظار الحجز
UNDER_REVIEW                     -- قيد مراجعة الأخصائي
DIRECT_INTERVENTION_REQUIRED     -- تدخل مباشر مطلوب (recorded in this module; not actioned until Specialist Review v2)
WAITING_FINAL_DECISION_AFTER_INTERVENTION
TECHNICAL_PARTIAL_RERECORD       -- إعادة تسجيل تقني جزئي
LEVEL_REPEAT_DECIDED             -- قرار إعادة المستوى بانتظار اطلاع المريض
NEXT_LEVEL_APPROVED              -- الانتقال معتمد بانتظار عرض القرار
CLOSED_DUE_TO_INACTIVITY         -- مغلق بسبب الانقطاع
SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN  -- (recorded; subscription enforcement itself is a later sub-project)
```

Enforced transitions (service-layer only, never a raw status write — this is the single most important rule this module exists to enforce, since AC-01/AC-02/AC-04 all depend on it):

| From | Event | To | Governing rule |
|---|---|---|---|
| `ACTIVE_LEVEL_TRAINING` | 72h cycle complete (≥1 training event in each of the 3 consecutive 24h periods) | `SAMPLE_ELIGIBLE` | §3, corrected point 58 — calendar time alone never triggers this |
| `SAMPLE_ELIGIBLE` | Patient opens sample-prep (creates a `SampleSession`) | `SAMPLE_PREPARATION` | §33 |
| `SAMPLE_PREPARATION` | All required parts recorded and submitted | `SAMPLE_SUBMITTED` → `WAITING_FOR_SPECIALIST` | §5, §31 |
| `WAITING_FOR_SPECIALIST` | A clinician opens the review | `UNDER_REVIEW` | §9 (full lock/queue mechanics deferred to Specialist Review v2; in this module, opening it simply records who) |
| `UNDER_REVIEW` | Decision: transition | `NEXT_LEVEL_APPROVED` | §10, §44 |
| `UNDER_REVIEW` | Decision: repeat level | `LEVEL_REPEAT_DECIDED` | §10, §45 |
| `UNDER_REVIEW` | Decision: technical issue in part(s) X | `TECHNICAL_PARTIAL_RERECORD` | §8, §37 |
| `TECHNICAL_PARTIAL_RERECORD` | Affected part(s) re-recorded and resubmitted | back to `WAITING_FOR_SPECIALIST` (no new `TrainingCycle72h`, no 72h reset) | §8 — this is the rule that most directly forbids "repeat the whole sample" |
| `NEXT_LEVEL_APPROVED` | Patient views the result | Cycle closes; a new `TrainingCycle72h` opens for the next `Level` in `ACTIVE_LEVEL_TRAINING`, but its 72h counter does **not** start until the patient has watched the new level's human model and completed one real training event (§44) | §13, §44 |
| `LEVEL_REPEAT_DECIDED` | Patient views the feedback | A **new** `TrainingCycle72h` row for the **same** `Level`, same human model and training list, old cycle preserved (§15, §45) | §15 |
| Any active state | No qualifying activity for the configured inactivity window | `CLOSED_DUE_TO_INACTIVITY` (default 1 month, admin-configurable; specialist-wait time never counts toward this — §17, §30) | §17 |

## Sample structure

- `SpeechSample` belongs to exactly one `TrainingCycle72h`. A **unique partial index** enforces "at most one active `SpeechSample` per cycle" (AC-04) — enforced at the database level, not just in application code, since this is a hard clinical-integrity rule.
- `SampleSamplePart` rows (child of `SpeechSample`) hold each part's content per the level's part template (mixed types allowed: مقاطع/كلمات/عبارات/جمل/قراءة/وصف, §25 §32) — the template itself lives on `LevelVersion`, admin-managed.
- `SampleSession`/`SampleAttempt`: up to 10 `SampleAttempt` rows per `SampleSession`; deleting an attempt sets a `deletedAt` timestamp rather than truly deleting the row, so "delete does not restore the count" (AC-05) is enforced by counting all attempts including soft-deleted ones, not just live ones.
- The purely-technical pre-submission fitness check (§5 — file exists, plays, all required parts present) is stubbed as a TODO-free no-op for now (explicitly deferred to the media-upload sub-project) — the plan will not build a fake check.

## Testing

Mirrors the established e2e smoke-test pattern from every prior backend module: one full-flow smoke test (register level content → patient completes 72h cycle across 3 real 24h-gated periods using time-travel in tests → sample prep → submit → specialist decision → verify state) plus a dedicated test per AC-01 through AC-12, each asserting the exact rule it names (e.g., AC-02's test explicitly asserts that letting 72 calendar hours pass with zero training events does *not* open the sample gate).

## Non-goals restated for clarity

Not building in this sub-project: specialist queue/locking/SLA, notifications, real media upload, payments, the free consultation, direct-intervention execution (only its state is recorded), age-based content variation beyond what `LevelVersion` already supports structurally, mobile screens. These are separate, already-identified follow-on sub-projects.
