# Mobile Sample Recording Flow — Design Spec

Sub-project 3/5 of the Kalamy mobile app (Expo/React Native, Arabic-only, RTL), following the completed mobile-foundation auth screens (sub-project 1) and mobile Treatment Engine screens (sub-project 2, My Program/Level Content/History/Sample Result — all already merged to master).

## Context

Treatment Engine v2's backend (already merged) exposes a full sample-recording API: `SampleSession`/`SampleAttempt` for recording up to 10 attempts, `SpeechSample`/`SampleSamplePart` for the assembled, submitted sample, and a damaged-part re-record path (`rerecordDamagedParts`) for when a specialist flags specific parts as technically unusable. None of this is wired to any mobile UI yet — sub-project 2 explicitly deferred it, because no audio library existed in the app and the backend's `recordingUrl` fields are bare URL strings with no real upload/storage infrastructure behind them.

This sub-project closes that gap: it adds a small backend upload endpoint, then builds the mobile screens that let a patient actually record, review, assemble, and submit a speech sample — and separately, re-record any parts a specialist later flags as damaged.

## Scope

**In scope:**
- One new backend endpoint: file upload → URL.
- Mobile: `AudioRecorder`/`AudioPlayer` reusable components.
- Mobile: `sample-recording.tsx` — the main wizard (record attempts → assign to parts → self-report + submit).
- Mobile: `sample-rerecord.tsx` — damaged-part re-record flow.
- Mobile: 7 new API client functions in `treatmentEngine.ts` (including the new upload wrapper).
- Home screen integration: replacing the existing `sampleComingSoon` placeholder for `SAMPLE_ELIGIBLE`/`SAMPLE_PREPARATION`/`TECHNICAL_PARTIAL_RERECORD` cycle statuses with real navigation.

**Out of scope (Non-Goals):**
- Specialist/clinician-facing review UI (permanently a separate surface).
- Real cloud storage (S3/GCS/etc.) — local-disk storage on the existing backend is the deliberate choice for this stage; migrating to cloud storage is a future concern, not designed for here.
- Audio transcription, AI analysis, or automated scoring of recordings.
- Video playback for the human-model content (already just a "mark as watched" button from sub-project 2 — no change here).
- Multi-child caregiver switching (still deferred from sub-project 2).

## Key Decisions Made During Brainstorming

- **Audio storage**: a new self-hosted backend upload endpoint (not a third-party cloud provider, not a local-only prototype). Chosen because it needs no external accounts/credentials and keeps the whole system self-contained, while still producing a URL a specialist can eventually be shown in later sub-projects.
- **Recording duration cap**: **3 minutes** per attempt, matching the real clinical protocol for therapy-session recordings (the 5-minute figure mentioned for the diagnostic/assessment phase does not apply here — the Assessment module doesn't support patient-recorded audio at all, so that figure is out of scope for this sub-project).
- **Assemble-parts UX**: patients record a pool of up to 10 attempts (not tied to a specific part upfront), then explicitly assign which attempt fills which required part at submission time — matching the backend's own data model (`sourceAttemptId` on each submitted part) rather than inventing a simpler-but-mismatched 1-attempt-per-part UI.
- **Scope bundling**: the initial-recording flow and the damaged-part re-record flow are both built together in this sub-project, since they share the same underlying recording/upload mechanism.
- **Screen structure**: one wizard-style screen for the main flow (Approach A), not separate screens per step — avoids threading selected-attempt-IDs across route params, and matches how the backend already treats "preparing a sample" as one cohesive session.
- **Audio library**: `expo-audio` (the current, non-deprecated Expo recording/playback API), not `expo-av` (deprecated in current Expo SDK versions this project is pinned to).

## 1. Backend: Upload Endpoint

- **Route**: `POST /api/v1/patients/:patientId/cycles/current/sample-session/upload`
- **Auth**: gated by the existing `PREPARE_SAMPLE` permission (already granted to PATIENT/CAREGIVER) — no RBAC changes.
- **Request**: `multipart/form-data` with a single audio file field.
- **Storage**: saves to `backend/uploads/audio/` (git-ignored, following the same convention as `.env`), filename is a generated UUID + the original file extension, to avoid collisions.
- **Validation**: accepts only `audio/*` MIME types, max file size **10MB** (comfortably covers a 3-minute AAC/m4a recording at typical bitrates, with margin) — rejects anything else with 400.
- **Response**: `{ "url": string }` — an absolute URL pointing back at this same server (served statically via NestJS's built-in static-file middleware), e.g. `http://localhost:3000/uploads/audio/<uuid>.m4a`.
- **No Prisma schema changes** — this is a pure file-handling endpoint; the URL it returns is used exactly like any other `recordingUrl` string by the existing `recordAttempt`/`rerecordDamagedParts` endpoints.
- **Retention**: uploaded files are never deleted server-side, even when an attempt is later soft-deleted (`deletedAt` set) or a part is superseded by a re-record — matching the project's established "never destroy clinical history" convention. Storage growth over time is a known, explicitly out-of-scope concern for this sub-project.

## 2. Mobile: Reusable Recording Components

- **`mobile/src/components/AudioRecorder.tsx`**: record/stop button with a running timer, built on `expo-audio`'s recording hooks. Enforces the 3-minute cap by auto-stopping and showing a clear message when the limit is hit, rather than silently truncating. Hands the resulting local file back to the calling screen — it does not upload anything itself.
- **`mobile/src/components/AudioPlayer.tsx`**: play/pause button with a progress indicator, for reviewing either a not-yet-uploaded local file or an already-uploaded `recordingUrl`.
- Both follow the existing `Button`/`ErrorBanner` component convention: `useTheme()` for tokens, no new state-management library.

## 3. Mobile: API Client Additions

Seven new functions added to `mobile/src/api/treatmentEngine.ts`:

- `openSampleSession(patientProfileId): Promise<SampleSession>`
- `uploadRecording(patientProfileId, fileUri): Promise<{ url: string }>`
- `recordAttempt(patientProfileId, recordingUrl): Promise<SampleAttempt>`
- `deleteAttempt(patientProfileId, attemptId): Promise<SampleAttempt>`
- `listAttempts(patientProfileId): Promise<SampleAttempt[]>`
- `submitSample(patientProfileId, dto): Promise<SpeechSample & { parts: SampleSamplePart[] }>`
- `rerecordDamagedParts(patientProfileId, dto): Promise<SpeechSample & { parts: SampleSamplePart[] }>`

New exported types: `SampleSession`, `SampleAttempt` (both currently missing from `treatmentEngine.ts`; `SpeechSample`/`SampleSamplePart`/`SpecialistDecision` already exist from sub-project 2).

Additionally, the existing `TrainingCycle` interface gains an optional `speechSample?: SpeechSample | null` field, since the backend's `GET /cycles/current` response already includes it — this field is simply unused by the screens that don't need it (Home, Level Content) and consumed only by `sample-rerecord.tsx`.

## 4. Screen: `sample-recording.tsx` (main wizard)

Three steps tracked by local `step` state, all backed by the backend session as source of truth (re-fetchable, so a patient can leave and resume):

**Step 1 — Record attempts (the pool):**
- Shows the level's required parts as an informational checklist (from `getActiveLevelVersion`'s `samplePartTemplateJson`).
- Lists recorded attempts so far (`listAttempts`), each with play (`AudioPlayer`) and delete (`deleteAttempt`) actions.
- Record button (`AudioRecorder`) → on stop: `uploadRecording` → `recordAttempt` with the returned URL → refresh the attempts list.
- Disables the record button and shows a message once `attempts.length >= 10` (client-side mirror of the backend's own 409 — the backend remains the actual enforcement).
- "Next" enabled once at least one attempt exists (full completeness is checked in Step 2).

**Step 2 — Assign attempts to parts:**
- For each required part (from the template), a picker listing all current attempts, each with an inline play button to preview before choosing.
- "Next" disabled until every required part has an attempt assigned.

**Step 3 — Self-report + submit:**
- Four inputs (sliders or steppers), each 1–9: current severity (`selfSeverityCurrent`), expected next severity (`selfSeverityExpectedNext`), Camperdown performance rating (`camperdownPerformanceRating`), client opinion score (`clientOpinionScore`).
- "Submit" calls `submitSample` with the assembled `parts` array (each `{ partType, label, order, sourceAttemptId }`) plus the four scores, then navigates back to Home.

## 5. Screen: `sample-rerecord.tsx` (damaged-part re-record)

- Reached only when the current cycle's status is `TECHNICAL_PARTIAL_RERECORD`.
- Fetches via the *existing* `getCurrentCycle(patientProfileId)` call — the backend's `GET /cycles/current` already includes `speechSample.parts` in its response (confirmed in `training-cycles.service.ts`), it's just not yet exposed in the mobile-side `TrainingCycle` type. This sub-project extends that type (mirroring the `TrainingCycleWithSample` pattern already introduced for cycle history in sub-project 2) rather than adding any new endpoint. Filters the returned parts to those with `technicallyDamaged: true`.
- Shows each damaged part with its label and a record button (`AudioRecorder`) — no part-assignment step (each damaged part maps to exactly one new recording), no self-report scores (already captured at initial submission).
- Each recording goes through the same `uploadRecording` → collect URL pattern as the main flow.
- "Submit" enabled once every damaged part has a fresh recording; calls `rerecordDamagedParts` with `{ parts: [{ id, recordingUrl }, ...] }` for exactly the damaged parts, then navigates back to Home.
- Much simpler than the main wizard: no attempt pool, no 10-attempt cap (this endpoint doesn't share that limit).

## 6. Home Screen Integration

Replaces the current `ar.program.sampleComingSoon` placeholder (shown for all three of `SAMPLE_ELIGIBLE`/`SAMPLE_PREPARATION`/`TECHNICAL_PARTIAL_RERECORD`, per the existing `STATES_NEEDING_SAMPLE_RECORDING` set in `home.tsx`) with real navigation:

- `SAMPLE_ELIGIBLE` or `SAMPLE_PREPARATION` → button "سجّل عينتك" → `sample-recording.tsx`.
- `TECHNICAL_PARTIAL_RERECORD` → button "أعد تسجيل الأجزاء المطلوبة" → `sample-rerecord.tsx`.

## 7. Error Handling

- **Microphone permission denied**: clear Arabic message explaining recording requires mic access, with a way to retry the permission prompt — not a silent failure.
- **Upload failure** (e.g. network drop mid-upload): the locally-recorded file is kept, and the patient can retry the upload without re-recording from scratch.
- **10-attempt cap hit server-side** despite client-side prevention (e.g. stale cached count): surfaced as a plain message, not a crash.
- **Incomplete part assignment**: prevented client-side (Step 2's "Next" stays disabled) as well as being backend-validated.

## 8. Testing Plan

- Following this codebase's established convention: screen/component tests mock the API layer (`treatmentEngine.ts` functions) and `expo-audio`'s recording hooks — no real microphone or filesystem access in tests. The thin API wrapper functions themselves get no dedicated unit test file (matches `api/auth.ts`'s existing precedent — verified only through the screens/components that consume them).
- `AudioRecorder`/`AudioPlayer` get their own component tests with `expo-audio` mocked, asserting record/stop/play/pause state transitions and the 3-minute auto-stop behavior specifically (not real audio).
- `sample-recording.tsx` screen tests cover: recording an attempt end-to-end (mocked upload + recordAttempt), the 10-attempt cap disabling the record button, part-assignment validation gating "Next", and submission calling `submitSample` with the correct shape.
- `sample-rerecord.tsx` screen tests cover: correctly filtering to only damaged parts, submission gating until all damaged parts have fresh recordings, and calling `rerecordDamagedParts` with the correct shape.
- Backend: new e2e test(s) for the upload endpoint (valid file → 201 with a URL string; invalid/oversized input → 400).

## Non-Goals

(Restated from Scope, for a single reference point.)
- Specialist/clinician-facing UI.
- Real cloud storage migration.
- Audio transcription/AI analysis/automated scoring.
- Video playback UI for human-model content.
- Multi-child caregiver switching.
