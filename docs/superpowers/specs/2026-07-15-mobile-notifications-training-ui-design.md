# Mobile Notifications Inbox + Training-Session Screens — Design

## Goal

Close the last open item from the gap-analysis follow-on list: the mobile app has no notifications UI at all, and its "log training" button calls a backend endpoint that was deleted when §55-62 replaced the single-shot `recordTrainingEvent` flow with the stateful `TrainingSession` model. This design covers both — a notifications inbox screen, and a real training-session screen that replaces the broken button with the actual start/resume/progress/cooldown flow §55-62 and §62 describe.

This was explicitly anticipated and accepted at the time §55-62 shipped (`docs/superpowers/specs/2026-07-14-daily-training-session-55-62-design.md`, line 3): *"breaking the existing mobile 'log training' button is accepted since this project is pre-launch... mobile UI for the new session-based flow is a separate follow-on."* This is that follow-on.

## Current state (investigated directly, not assumed)

- **Stack**: Expo Router (file-based routes under `mobile/app/`), plain React Context + local `useState`/`useEffect`/`useFocusEffect` (no Redux/React Query/polling infra anywhere), a single hand-rolled `apiRequest<T>()` fetch wrapper (`mobile/src/api/client.ts`), TypeScript strict mode, RTL-forced globally, Arabic-only copy in one flat file (`mobile/src/copy/ar.ts`), Jest + `@testing-library/react-native` with one `__tests__` file per screen/module.
- **No notifications UI exists anywhere** — zero matches for "notification" across the whole `mobile/` tree, no route, no copy, no icon/badge affordance. The backend contract is complete and already patient-permission-ready (`GET/PATCH /api/v1/notifications`, `GET/PATCH /api/v1/notifications/preferences`).
- **"Log training" is broken today**: `mobile/src/api/treatmentEngine.ts:113-119`'s `logTrainingEvent()` calls `POST .../cycles/current/training-events`, a route that no longer exists on the backend (404). It's wired to a real, visible primary-action button in `mobile/app/home.tsx` (`handleLogTraining`, lines 114-125, rendered at lines 145-150 when `cycle.status === 'ACTIVE_LEVEL_TRAINING' && cycle.humanModelWatchedAt`), not a dead/orphaned reference — a patient hits this today and gets an error.
- **No training-session screen exists** — the old flow was a single inline button with no progress display at all. The new `TrainingSession` backend contract (`POST/PATCH/GET .../training-sessions...`) is richer: start-or-resume, incremental progress recording, a 1-hour cooldown between completed sessions, and a today's-progress summary — none of which the old single-tap button could ever have shown.
- **No "passed levels for reinforcement" screen exists** — §16's backend endpoints (`GET /patients/:id/levels/passed`, `GET /patients/:id/levels/:levelId/review`) are entirely unconsumed by mobile. §62 lists access to this content as part of what the patient should see during training.

## §62's governing text, and what maps to what

> **62. What the patient sees during the training cycle**: a simplified interface showing the current level, time remaining to complete the minimum [72h] requirement, today's target (7 trainings), number completed today, interval status and when the next training becomes available, a resume-incomplete-training button, and access to the human model/cognitive content/previously-passed levels for reinforcement. The interface must not show complex indicators that could suggest training count alone means clinical success.

| §62 requirement | Source | This design |
|---|---|---|
| Current level | `getCurrentCycle` + `getLevels` (existing, same lookup pattern `history.tsx` already uses) | Shown on the training-session screen |
| Time remaining to the 72h minimum | `cycle.firstTrainingEventAt` (already on the existing `TrainingCycle` type) | Computed client-side: `72h − (now − firstTrainingEventAt)`, rounded to whole hours — no new backend endpoint needed |
| Today's target (7) | `GET .../training-sessions/progress` → `targetPerDay` | Shown |
| Completed today | same endpoint → `completedToday` | Shown |
| Interval status / next available | same endpoint → `intervalActive` / `nextAvailableAt` | Shown; gates whether the start/resume control is active |
| Resume-incomplete-training button | same endpoint → `currentSessionId` | Handled by the fact that `POST .../training-sessions` is already idempotent-resume server-side — the UI needs only one "start/resume" action, not two separate buttons |
| Access to human model/cognitive content | existing `level-content.tsx` screen | Linked from the training-session screen |
| Access to previously-passed levels for reinforcement | §16 endpoints, **not yet consumed anywhere in mobile** | **Explicitly deferred** — see Out of Scope |
| No complex indicators implying training-count alone means clinical success | — | The screen stays plain text + one simple filled-bar progress indicator; no rings, animations, streaks, or gamified badges |

## Out of scope, and why

- **A dedicated "review previously-passed levels" screen.** §16's backend exists but nothing in mobile has ever consumed it — building it properly (a list screen + a detail/review screen, its own copy, its own tests) is a separate, sizable unit of work with its own design questions (how much of a passed level's content should be re-shown? read-only or interactive?), not a natural sub-task of "fix the training screen." Deferred as its own explicit follow-on, matching this project's repeated pattern of not silently folding an under-specified adjacent feature into an unrelated piece of work. The training-session screen still links to the one piece of "previously reachable" content that *does* already exist (`level-content.tsx`, i.e. the current level's own human model/cognitive material).
- **Push notifications / device badges.** The backend is in-app-only (confirmed by §99's own design decision); no `expo-notifications` plugin or app-badge config exists in `mobile/app.json`, and adding one is a platform-configuration change with its own permissions/entitlements story, unrelated to building the in-app inbox screen itself.
- **An unread-count badge on the home screen's entry-point button.** Would require home.tsx to fetch the notifications list on every load just to compute a count, and there's no existing badge/pill UI component in this codebase to render it with. The notifications screen itself shows unread state per-row; a home-screen summary badge is a natural but separate enhancement, not required by any spec text.
- **Marketing/promotional notification styling, multi-channel indicators, or preference-toggle UI for `DAILY_TRAINING_REMINDER`.** The backend preferences endpoint (§107) exists but nothing in the governing spec's §62/mobile-facing text asks for a settings screen in this pass; the inbox screen only needs to *read* notifications, not manage preferences.

## Notifications inbox

### API module — `mobile/src/api/notifications.ts` (new)

```typescript
export type NotificationType =
  | 'SAMPLE_ESCALATED_TO_SUPERVISOR'
  | 'SPECIALIST_DECISION_ISSUED'
  | 'INTERVENTION_TIMED_OUT'
  | 'SAMPLE_ELIGIBLE_FOR_RECORDING'
  | 'SAMPLE_AVAILABLE_FOR_REVIEW'
  | 'SAMPLE_SUBMISSION_REMINDER'
  | 'SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR'
  | 'CONSULTATION_REMINDER'
  | 'DAILY_TRAINING_REMINDER'
  | 'SPECIALIST_WORKLOAD_REMINDER';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntity: string | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export function getMyNotifications(): Promise<AppNotification[]> {
  return apiRequest<AppNotification[]>('/api/v1/notifications', { auth: true });
}

export function markNotificationRead(notificationId: string): Promise<AppNotification> {
  return apiRequest<AppNotification>(`/api/v1/notifications/${notificationId}/read`, { method: 'PATCH', auth: true });
}
```

The backend already renders `title`/`body` in Arabic server-side (`NOTIFICATION_TEMPLATES` in `notifications.service.ts`) — the mobile client needs **zero per-type copy or i18n logic**, just renders the two strings directly. This is a genuine simplification, not a shortcut: there is nothing to translate or format client-side.

### Screen — `mobile/app/program/notifications.tsx` (new)

Mirrors `complaints.tsx`/`reports.tsx`'s established list pattern exactly: `useFocusEffect`-driven fetch, loading/error states via the shared `ar.program.loading`/`ErrorBanner` convention, empty-state text, bordered `card` rows. Tapping an unread row calls `markNotificationRead` and updates local state (no need to refetch the whole list — the single row's `readAt` is set locally from the response, matching the instant-feedback pattern `level-content.tsx`'s `handleMarkWatched` uses).

Unread rows are visually distinguished the simplest possible way — bold title text and a small dot, both driven by `readAt === null` — no new shared component needed, consistent with every other screen building cards ad hoc with `tokens.colors.*`.

### Entry point

A new button in `home.tsx`'s existing `linksRow` (`ar.program.viewNotifications`), alongside `viewLevelContent`/`viewHistory`/`viewReports`/`viewComplaints` — the same flat list, no new navigation chrome.

## Training-session screen

### API additions — `mobile/src/api/treatmentEngine.ts` (extend, don't replace the file)

```typescript
export type TrainingSessionStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface TrainingSession {
  id: string;
  trainingCycleId: string;
  status: TrainingSessionStatus;
  unitsCompleted: number;
  startedAt: string;
  completedAt: string | null;
}

export function startOrResumeTrainingSession(patientProfileId: string): Promise<TrainingSession> {
  return apiRequest<TrainingSession>(`/api/v1/patients/${patientProfileId}/cycles/current/training-sessions`, {
    method: 'POST',
    auth: true,
  });
}

export function recordTrainingProgress(patientProfileId: string, unitsCompleted: number): Promise<TrainingSession> {
  return apiRequest<TrainingSession>(`/api/v1/patients/${patientProfileId}/cycles/current/training-sessions/current/progress`, {
    method: 'PATCH',
    auth: true,
    body: { unitsCompleted },
  });
}

export interface TrainingProgressSummary {
  completedToday: number;
  targetPerDay: number;
  intervalActive: boolean;
  nextAvailableAt: string | null;
  currentSessionId: string | null;
}

export function getTrainingProgress(patientProfileId: string): Promise<TrainingProgressSummary> {
  return apiRequest<TrainingProgressSummary>(`/api/v1/patients/${patientProfileId}/cycles/current/training-sessions/progress`, {
    auth: true,
  });
}
```

`logTrainingEvent` is deleted outright (not deprecated) — nothing will call it once this ships, matching the exact "delete outright" precedent §55-62's own backend design already set for the endpoint it called.

### The self-reported progress control — the one real design decision this spec makes

§59 is explicit that "units" are **not** an automated or verifiable measurement: *"the system doesn't require recording units audio/video, and makes no automated claim about verifying pronunciation quality per unit; it records completion as a commitment indicator only."* There is no existing content model in this codebase that decomposes a training into 100 discrete, countable things — `trainingListJson` is a plain array of instruction strings (already rendered as-is in `level-content.tsx`), not a checklist with per-item completion tracking.

Given that, the progress control is a simple, honest **self-report stepper**, not an automated exercise tracker:
- The screen shows the same training instructions (`trainingListJson`, parsed and rendered exactly like `level-content.tsx` already does) so the patient knows what they're practicing.
- A "+10 وحدة" button increments a local running count and immediately `PATCH`es the cumulative value to the server (safe to fire on every tap with no debouncing, since the server takes `Math.max(existing, incoming)` — a repeated or out-of-order tap can never double-count or regress the stored value).
- A plain filled-bar + "`X` / `100`" text shows progress — no ring, no animation, no streak indicator, satisfying §62's "no complex indicators" constraint directly.
- At `unitsCompleted >= 100` the server transitions the session to `COMPLETED` and the screen shows a plain confirmation state, refreshes `completedToday`, and offers a "back to home" action.

This is the one piece of this design that isn't a mechanical translation of an existing contract — it's a genuine UX decision, made and documented here (not left implicit in a task brief) precisely because §59's own text frames the requirement as intentionally loose ("commitment indicator only"), which is the product's own signal that a simple, low-fidelity self-report control is the correct reading, not an oversight to fill in with something more elaborate.

### Screen layout — `mobile/app/program/training-session.tsx` (new)

1. Current level name (via `getCurrentCycle` + `getLevels`, same lookup `history.tsx` already does).
2. "X ساعة متبقية حتى فتح مرحلة العينة" (X hours remaining until the sample stage opens) — computed from `cycle.firstTrainingEventAt`; if null, shows the full 72h; if the 72h has already elapsed, this line is omitted (the cycle would already be past `ACTIVE_LEVEL_TRAINING` in that case, so this branch is mostly defensive).
3. "هدف اليوم: `completedToday` / `targetPerDay`" (today's target).
4. If `intervalActive`: a disabled state showing "التدريب التالي متاح الساعة `HH:MM`" (next training available at) computed from `nextAvailableAt`, and the stepper control is not shown.
5. Otherwise: the training instructions + the stepper progress control described above. If `currentSessionId` was already set (a resumed, not-yet-complete session), the stepper initializes at that session's already-known `unitsCompleted` (returned by the `POST` call itself, since `POST` is idempotent-resume and returns the existing session's current state).
6. A link to `level-content.tsx` ("مشاهدة محتوى المستوى") for the human model/cognitive content, per §62.

## `home.tsx` changes

- `renderPrimaryAction()`'s `ACTIVE_LEVEL_TRAINING && humanModelWatchedAt` branch changes from calling `handleLogTraining` (which called the deleted endpoint) to a plain `router.push('/program/training-session')` — navigation only, no API call and no `loading` state needed on this particular button anymore (the `submitting` state stays, since `handleStartProgram` still uses it).
- `logTrainingEvent` import removed; `handleLogTraining` deleted.
- `mobile/app/__tests__/home.test.tsx`'s existing "log training" test currently asserts `logTrainingEvent` was called — it's rewritten to assert navigation happened instead. This requires a small, necessary fix to this test file's `expo-router` mock: today `useRouter: () => ({ push: jest.fn(), replace: jest.fn() })` creates a **fresh** `jest.fn()` on every call (i.e. every render), so no test in this file can currently assert on what `push` was called with — none of the existing tests do. The mock needs to hoist a single stable `push` mock reference (cleared by the file's existing `beforeEach(() => jest.clearAllMocks())`) so the rewritten test can assert `expect(mockPush).toHaveBeenCalledWith('/program/training-session')`. This is a pre-existing gap in the test file's mock setup, not a new pattern being invented — every other test in the file continues to work identically, since none of them relied on `push` being a fresh mock per render.

## Testing

Standard Jest + RTL, one `__tests__` file per new/changed module, matching the codebase's existing convention exactly (no test framework changes):
- `mobile/src/api/__tests__/notifications.test.ts` — both API functions call the right path/method.
- `mobile/app/program/__tests__/notifications.test.tsx` — loading/error/empty states, list rendering, tap-to-mark-read updates the row locally without a full refetch.
- `mobile/src/api/__tests__/treatmentEngine.test.ts` (new, if one doesn't already exist — the investigation found no existing test file for this API module) — the three new functions call the right path/method/body; confirms `logTrainingEvent` is gone.
- `mobile/app/program/__tests__/training-session.test.tsx` — renders the 72h/target/completed-today summary from mocked data, shows the interval-active disabled state, shows the stepper and calls `recordTrainingProgress` with the cumulative value on tap, shows the completion state once the mocked response reports `status: 'COMPLETED'`.
- `mobile/app/__tests__/home.test.tsx` — the rewritten "log training" test plus the router-mock fix described above; every other existing test in the file must still pass unchanged.

## Verification

Frontend/UI work — per this project's own working conventions, this must be visually verified in a running browser before being reported complete, not just unit-tested. The mobile app already has a `web` launch target (`expo start --web`, wired in `.claude/launch.json`) that will be used to click through both new screens against a real backend before finishing this branch.
