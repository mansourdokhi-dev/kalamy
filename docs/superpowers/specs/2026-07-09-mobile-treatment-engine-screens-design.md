# Mobile Treatment Engine Screens (Sub-project 2/5) — Design

## Context

This is sub-project 2 of the Kalamy mobile app, following the completed mobile-foundation sub-project (auth: welcome, register, OTP verify, login, forgot/reset password, a placeholder home screen). Treatment Engine v2 (levels, 72-hour training cycles, sample recording/submission, specialist review) has just merged to `master` on the backend, entirely without a mobile UI. This sub-project wires the existing mobile app (Expo/React Native, RTL, themed components, `AuthProvider`) to that backend for the patient/caregiver-facing side of the core clinical loop — level content, cycle status, training logging, history, and specialist decisions.

Two things discovered during scoping meant this could not be split cleanly into "backend already fully supports mobile" vs "just build screens":

1. **No way for a logged-in user to discover their own `patientProfileId`.** Every treatment-engine endpoint requires it in the URL path, but nothing in the current API surface exposes it from a session token alone.
2. **No way to read a submitted sample's decision after the fact.** The backend has `POST` endpoints for submit/rerecord/review that each return the `SpeechSample` in their response, but nothing else exposes it. Since "viewing specialist decisions" was part of the original ask, this gap had to be closed — see the design-review note in Section 1 for why the fix is "enrich cycle history," not "add a current-sample endpoint."
3. **No way to read a level's published content.** `LevelsService.getActiveVersion(levelId)` already exists and is used internally by the cycle/review services, but no controller route exposes it — `GET /api/v1/levels` returns only bare `Level[]` with no version content. Found while writing the implementation plan, once exact current file contents were checked rather than assumed from the earlier scoping report.

Two gaps are closed by small, additive backend endpoints; the sample-decision gap is closed by enriching an existing endpoint instead (Section 1).

## Scope

**In scope (this sub-project):**
- Patient/caregiver mobile screens for: viewing current level content, cycle status, logging training, starting their first cycle, viewing cycle/level history, viewing a specialist's decision once made.
- The backend read/lookup changes needed to support the above (two new endpoints, one enrichment of an existing one).
- Age-group theming wired to real patient data for the first time (palettes already exist, unused until now).

**Out of scope (deferred to later sub-projects, decided explicitly during brainstorming):**
- Sample recording, playback, attempt management, and submission (sub-project 3+) — no audio/video library exists in the mobile app yet (no `expo-av`/`expo-camera`), and the backend's media fields (`recordingUrl`, `humanModelVideoUrl`, `cognitiveVideo1Url`, `cognitiveVideo2Url`) are bare strings with no real upload/storage behind them.
- Actual video playback of the human model / cognitive videos — shown as text content only in this sub-project (technique description, video questions as reflection prompts).
- The specialist/clinician review UI — assumed to live on a separate surface entirely (not this mobile app), out of scope permanently for this app, not just deferred.
- Caregivers managing more than one child's patient profile — this sub-project assumes exactly one `PatientProfile` per logged-in `User`.
- Any new state-management library (e.g., TanStack Query) — the existing hand-rolled `apiRequest` pattern is reused as-is; revisit only if sub-project 3's recording flow genuinely needs it.

## Section 1: Backend additions

### Design-review note: decisions live on closed cycles, not the current one

An earlier draft of this spec added a `GET .../cycles/current/sample` endpoint and wired "Sample Result" to trigger whenever that current-cycle sample had a non-null `decision`. Self-review caught that this can never actually fire: `TRANSITION` and `LEVEL_REPEAT` close the reviewed cycle and open a new one in the *same* transaction (confirmed against the live merged code, not just the DTOs), so by the time a decision exists, "current" has already moved on to a fresh cycle with no sample at all. `TECHNICAL_RERECORD`'s decision stays null forever by design (a deferral, not a verdict — see the backend's own `SpeechSample.decision` handling). So the condition this endpoint existed to serve would never be true for any real decision. Fixed below by enriching history instead of adding a "current sample" lookup.

One small additive endpoint, plus one small enrichment of an existing one. No schema changes, no new modules — both follow the existing controller/service/permission pattern already used throughout this backend (guard + permission decorator + service method with an ownership check, matching how `PatientsController.findOne` and `TrainingCyclesService.getCurrent` already work).

### `GET /api/v1/patients/me`

- Permission: `VIEW_PATIENT_PROFILE` (already granted to `PATIENT`/`CAREGIVER`).
- Resolves the `PatientProfile` by the calling user's own ID (via `@CurrentUser()`), not a path param — this is the one endpoint in this module that doesn't take an `:id`, by design, since its whole purpose is "look up my own ID."
- Returns the same `PatientProfile` shape as `GET /api/v1/patients/:id`.
- Returns `404 NOT_FOUND` if no profile exists yet for this user (e.g., staff hasn't created one after registration). The mobile app treats this as "your clinical profile isn't ready yet" — a distinct, expected UI state, not an error.

### `GET /api/v1/patients/:patientId/cycles` (existing endpoint, enriched)

- No new route. `TrainingCyclesService.listHistory` gains a Prisma `include: { speechSample: { include: { parts: true } } }` on its existing query, so each cycle in the response now carries its associated sample (if any) — including `decision`, `reviewNotes`, `clinicianOpinionScore`, and the patient's own self-report scores.
- No permission change (already `VIEW_CYCLE`, already granted to `PATIENT`/`CAREGIVER`). No new state, no mutation — this is strictly an additive field on an already-read-only response.
- This is the only place the mobile app looks for a specialist's decision. There is deliberately no "current cycle's sample" endpoint at all, per the design-review note above.

### `GET /api/v1/levels/:levelId/versions/active`

- Found while gathering exact file contents for the implementation plan: `LevelsService.getActiveVersion(levelId)` already exists and does exactly what Level Content needs (finds the most recently published `LevelVersion` for a level), but it is only ever called internally (by `TrainingCyclesService.startFirstCycle` and `SpecialistReviewService`'s `openNextLevelCycle`) — no controller route exposes it. `GET /api/v1/levels` only returns bare `Level[]` (`name`/`order`/`status`), with no version content at all. Without this, Level Content has no way to fetch `behavioralTechnique`, the cognitive-video questions, or `trainingListJson`.
- Permission: `VIEW_LEVELS` (already granted to `PATIENT`/`CAREGIVER`, same as the existing `GET /api/v1/levels`).
- A one-line addition to the existing `LevelsController`: `@Get(':levelId/versions/active')` calling the already-existing `levelsService.getActiveVersion(levelId)`. That service method already throws `ConflictException` (→ HTTP `409`) when the level has no published version yet — the mobile app treats that specific `409` the same as "not ready," not as a real error, same as its other expected non-200 states.

## Section 2: Screens & navigation

Four screens under Expo Router's file-based routing, all read-only or single-action — no multi-step forms.

### `app/home.tsx` (replaces the current placeholder) — **My Program**

The dashboard. On load (and on every re-focus via `useFocusEffect`), fetches:
- `GET .../progress` — friendly summary: current level name, current level order, levels completed, days in program.
- `GET .../cycles/current` — the actionable state (13-value status, `humanModelWatchedAt`, `firstTrainingEventAt`).
- `GET .../cycles` (history, enriched per Section 1) — used only to check the most recently *closed* cycle: if it has a sample with a non-null `decision`, show a "message from your therapist" banner linking to Sample Result for that cycle. No read/unread tracking — the patient can tap through or ignore it; it simply always shows while that's the most recent closed cycle.

Renders exactly one primary action/message based on the cycle's state:

| Condition | UI |
|---|---|
| No cycle at all, active treatment plan exists | "Start my program" button → `POST .../cycles/start` with the plan's ID |
| No cycle at all, no active treatment plan either | "Your clinical team hasn't finished your treatment plan yet — contact your clinic" (dead end; only a clinician creates plans) |
| `ACTIVE_LEVEL_TRAINING`, `humanModelWatchedAt` is null | "Watch the level content" → navigates to Level Content |
| `ACTIVE_LEVEL_TRAINING`, model watched | Inline "Log training" button — single tap, `POST .../training-events` with an empty body, no form |
| `SAMPLE_ELIGIBLE`, `SAMPLE_PREPARATION`, `TECHNICAL_PARTIAL_RERECORD` | Informational card: this stage needs sample recording, coming in a later update |
| `WAITING_FOR_SPECIALIST`, `UNDER_REVIEW` | "Waiting for your therapist to review your sample" |
| `CLOSED_DUE_TO_INACTIVITY` (this exact fetch is the one that tripped it) | "Your program paused due to inactivity — contact your clinic to resume" |
| `DIRECT_INTERVENTION_REQUIRED`, `WAITING_FINAL_DECISION_AFTER_INTERVENTION`, `SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN` (not reachable by any current backend code path) | One generic fallback: "Your therapist is reviewing your case" — forward-compatible if a later sub-project starts using these states |

Always visible regardless of state: links to **History** and **Level Content**, plus **Sample Result** when applicable, plus the existing logout button.

### `app/program/level-content.tsx` — **Level Content**

Fetches `GET /api/v1/levels/:levelId/versions/active` (using the current cycle's `levelId`) and shows the current level's therapeutic content, parsed from that `LevelVersion`:
- `behavioralTechnique` (plain text).
- `cognitiveVideo1Question` / `cognitiveVideo2Question`, if present, framed as reflection prompts ("As you watch, think about: …") — no actual video playback.
- `trainingListJson`, parsed as a JSON array of strings, rendered as a plain reference list (display-only; no per-item completion tracking, since the backend's training-event endpoint has no concept of individual list items).
- "Mark as watched" button, shown only if `humanModelWatchedAt` is null for the current cycle; calls `POST .../watch-human-model`, then refetches and navigates back to My Program.

Reachable anytime from My Program, not just when unwatched — it doubles as ongoing reference material.

### `app/program/history.tsx` — **History**

Read-only list from `GET .../cycles` (enriched per Section 1): for each cycle, its level name (looked up from `GET /api/v1/levels`), status, cycle number, open/closed dates, and — if that cycle has an associated sample with a non-null `decision` — a small "therapist decided: …" line, tapping into Sample Result for that specific cycle. No actions — purely informational, matching AC-11.

### `app/program/sample-result.tsx` — **Sample Result**

Reached only from History, for a specific past (closed) cycle whose sample has a non-null `decision` — never from "current," since a decision is by definition only visible once its cycle has closed (see Section 1's design-review note). Shows the decision in patient-friendly wording (`TRANSITION` → "you moved to the next level," `LEVEL_REPEAT` → "you repeated this level" — `TECHNICAL_RERECORD` never appears here since its `decision` stays null by design), the clinician's `reviewNotes` and `clinicianOpinionScore`, and the patient's own self-report scores (`selfSeverityCurrent`, `selfSeverityExpectedNext`, `camperdownPerformanceRating`, `clientOpinionScore`) from when they submitted.

## Section 3: Data flow & state management

**Patient profile ID, centralized once.** A new `PatientProfileProvider` (mounted in `app/_layout.tsx` alongside the existing `AuthProvider` — kept separate, not merged, so session/token concerns stay distinct from clinical-profile concerns) calls `GET /api/v1/patients/me` once after login and exposes `usePatientProfile()` → `{ patientProfileId, loading, error }`. Every other hook reads from this instead of re-fetching it.

**Per-screen fetch hooks**, each focused on one concern, all built on the existing `apiRequest` client — no new state-management library:
- `useProgress()` — `GET .../progress`
- `useCurrentCycle()` — `GET .../cycles/current`, treating 404 as "no active cycle," not an error
- `useCycleHistory()` — `GET .../cycles` (enriched with each cycle's sample per Section 1) — used by both the History screen and My Program's "message from your therapist" banner check
- `useActiveTreatmentPlan()` — `GET .../treatment-plans/active`, used only by My Program's "no cycle yet" branch
- `useActiveLevelVersion(levelId)` — `GET /api/v1/levels/:levelId/versions/active`, used only by Level Content, treating `409` as "not ready" rather than an error

**Refetching after actions.** No cross-screen cache-invalidation system. The acting screen refetches its own data locally before navigating back (e.g., Level Content refetches the cycle after "mark as watched" succeeds); My Program refetches on every re-focus via `useFocusEffect`, so returning to it after any action always shows fresh state.

**Errors.** The existing `ErrorBanner` component handles genuine failures (network, 5xx, unexpected 4xx) with a retry action. A 404 from `cycles/current` is never surfaced through `ErrorBanner` — it is an expected, explicitly-handled UI state (see Section 2's state table and Section 4).

## Section 4: Age-group theming

`PatientProfile.dateOfBirth` (already returned by `GET /api/v1/patients/me`) is used to compute the patient's current age and call the existing (currently-unused) `setAgeGroup()` once on load, via `PatientProfileProvider`. Cutoffs: under 13 → `'child'`, 13–17 → `'teen'`, 18+ → `'adult'` — no existing convention defines these boundaries elsewhere in the codebase, so these are a reasonable default chosen now, not derived from prior art.

## Section 5: Copy strings

Extends `src/copy/ar.ts` with four new namespaces, following its existing flat-nested-object pattern:
- `ar.program.*` — one label per cycle status shown on My Program (including the single generic fallback for the three not-yet-reachable states), plus the "start my program" / "no treatment plan yet" / "paused due to inactivity" messages.
- `ar.levelContent.*` — screen title, reflection-prompt framing text, "mark as watched" button label.
- `ar.history.*` — screen title, empty-state text (a brand-new patient with exactly one open cycle and no history yet).
- `ar.sampleResult.*` — one label per `SpecialistDecision` value shown, section headers for clinician notes vs. self-report scores.

Roughly 40–60 new keys total.

## Section 6: Error handling & edge cases (full list)

1. **No patient profile yet** (`GET /patients/me` → 404) — dedicated state, blocks all other screens: "Your clinical profile isn't ready yet, please contact your clinic."
2. **No active cycle, active treatment plan exists** — "Start my program" self-service flow (Section 2).
3. **No active cycle, no active treatment plan either** — dead end, "contact your clinic" (only a clinician creates plans; nothing the patient can do).
4. **Cycle just closed due to inactivity** (the fetch that trips the 30-day closure returns `CLOSED_DUE_TO_INACTIVITY` directly, not a 404) — distinct message from "never started," shown once, then falls into case 2/3 on every subsequent fetch.
5. **No closed cycle has a decision yet** — not an error; simply means no "message from your therapist" banner and no decision line in History.
6. **Real errors** (network failure, timeouts, 5xx, unexpected 4xx) — `ErrorBanner` with retry.

## Section 7: Testing plan

- **Backend changes**: real e2e tests against Postgres, following this codebase's established inline-registration pattern exactly (see any `treatment-engine-*.e2e-spec.ts` file for the convention) — one test proving `GET /patients/me`'s success and 404 shapes, one proving `GET .../cycles` now includes each cycle's sample/decision where one exists, and one proving `GET /api/v1/levels/:levelId/versions/active`'s success and "no published version" shapes.
- **Mobile hooks**: unit tests mocking `apiRequest`, covering both the success response and the expected-404 response for each hook.
- **Screens**: component tests covering the state-table branches in Section 2 (right message/action renders for each cycle status) and that each action (start program, mark as watched, log training) calls the right endpoint and triggers a refetch.
- **No new mobile-to-backend e2e test infrastructure** — none exists yet in this app; introducing one is a larger decision outside this sub-project's scope.

## Non-Goals (explicit, to prevent scope creep during implementation)

- No real audio/video recording, upload, or playback of any kind.
- No sample preparation/submission screens or endpoints.
- No specialist/clinician-facing UI in this app.
- No multi-child caregiver account switching.
- No new global state-management library.
- No changes to the 13-state machine, gating algorithm, or any other Treatment Engine v2 backend logic beyond the additive read changes in Section 1 (two new endpoints, one enriched query).
