# Staff Web Sub-project 3: Sample Review & Progress — Design

## Goal

This is sub-project 3 of the planned 5-part staff-web build (`project_kalamy_staff_web_status` memory). Sub-projects 1 (foundation) and 2 (clinical workflow) are done and merged. This project gives clinicians a working UI for the specialist-review queue (reserve → view submitted sample → decide/intervene) and gives all staff roles a patient progress dashboard — functionality that has existed on the backend since the "Specialist Review v2" and "Progress" backend sub-projects but has had no UI at all (only reachable via Swagger/curl).

## Current state (investigated directly)

- **Stack, pinned**: Vite + React 19.2 + TypeScript, **Mantine 9.4.1 exactly** across all four `@mantine/*` packages (`staff-web/package.json`) — do not let a bare `npm install @mantine/core` re-resolve this; sub-project 2 hit real API-drift bugs (no `dir` prop on `MantineProvider` in v9, `useMantineTheme()` requiring a provider ancestor in tests) from an unpinned install. React Router 7 (classic `<Routes>`/`<Route>` API, not the data-router/loader API). No data-fetching library — plain `fetch` via a single hand-rolled `apiRequest<T>()` (`staff-web/src/api/client.ts`), same shape as the mobile app's client. Vitest 4 + `@testing-library/react` 16 + jsdom. `npm run build` = `tsc -b && vite build` (this is where real type errors surface — `npm test` alone does not type-check, confirmed by sub-project 2's own retrospective).
- **RTL is already forced** app-wide via `DirectionProvider` in `staff-web/src/main.tsx`. Copy lives in one flat file, `staff-web/src/copy/ar.ts`, Arabic-only, per-screen namespaces.
- **The Patient Detail Hub pattern** (`staff-web/src/pages/PatientDetailPage.tsx`) is the established precedent for anything patient-scoped: one page, one `<Stack>`, with independent `<Card withBorder>` sections (`ProfileSection`, `AssessmentsSection`, `TreatmentPlanSection`) each pulling `patient` from `usePatientDetail()` (a `patientId`-scoped context that fetches once) and independently managing their own list/selection/form state via local `useState`. Permission gating is a plain boolean helper per capability in `staff-web/src/auth/permissions.ts` (currently just `canEditClinicalData(role)`), checked inline (`const canEdit = user ? canEditClinicalData(user.role) : false;`).
- **Tests**: colocated `*.test.tsx` beside the source file (no `__tests__` folders), `vi.mock()` per API module, every render wrapped `<MantineProvider><AuthProvider><PatientDetailProvider patientId="...">...</PatientDetailProvider></AuthProvider></MantineProvider>`, `data-testid` on interactive rows.
- **Known gap carried into this sub-project**: no browser-based visual confirmation has ever been done for staff-web (browser tooling was reported unreachable in earlier sessions). This session's mobile sub-project just confirmed the Browser pane tooling *does* work now — this sub-project should be the first to actually get a real visual pass, closing that compounding gap before a fourth sub-project's worth of un-eyeballed UI accumulates.

## Backend API surface consumed (all already shipped, read-only recon — nothing here requires a backend change)

- `GET /api/v1/specialist-review/available-samples` (`REVIEW_SAMPLE`) — cross-patient queue: cycles in `WAITING_FOR_SPECIALIST`, each with `speechSample` and `patientProfile: {id, fullName}`.
- `POST /api/v1/specialist-review/cycles/:cycleId/reserve` (`REVIEW_SAMPLE`).
- `POST /api/v1/patients/:patientId/cycles/current/review` (`REVIEW_SAMPLE`) — the decision endpoint, a discriminated union on `decision`.
- `POST /api/v1/specialist-review/cycles/:cycleId/intervention` / `.../intervention/complete` (`REVIEW_SAMPLE`).
- `GET /api/v1/patients/:patientId/cycles/current` (already consumed elsewhere in this codebase's sibling mobile app under a different client; staff-web has no equivalent yet) — needed here to know the current cycle's `id`/`status`/`speechSample` for the patient-scoped review section.
- `GET /api/v1/patients/:patientId/progress` (`VIEW_PROGRESS`, all three staff roles) — the dashboard.
- `GET /api/v1/patients/:patientId/levels/passed` (`VIEW_LEVELS`, all three staff roles) — passed-levels list, a natural, cheap complement to the progress dashboard.
- `GET /api/v1/patients/:patientId/sample-parts/:partId/media` (`VIEW_CYCLE`) — streams a submitted recording. No `Authorization` header can be attached to a plain `<audio src>`/`<video src>`, so this must be fetched as an authenticated blob and played via an object URL — the mobile app's `VideoPlayer` component already solved this exact problem; treat that as the proven precedent for the same pattern here, not a new invention.

### Backend permission table for this feature (verified against `backend/src/common/rbac/permissions.ts`)

| Permission | CLINICIAN | SUPERVISOR | ADMIN |
|---|---|---|---|
| `REVIEW_SAMPLE` (queue, reserve, decide, intervention) | ✅ | ❌ | ✅ |
| `TRANSFER_REVIEW_RESPONSIBILITY` | ❌ | ✅ | ❌ |
| `VIEW_PROGRESS` | ✅ | ✅ | ✅ |
| `VIEW_LEVELS` | ✅ | ✅ | ✅ |

A SUPERVISOR literally cannot call the queue-list endpoint (403) — so the whole review-queue feature (nav link, page, section) must be hidden from SUPERVISOR entirely, not just its write actions. The progress dashboard and passed-levels list are visible to all three roles.

## Scope

### In scope

1. **API modules** (new): `staff-web/src/api/specialist-review.ts` (list-available, reserve, review decision, intervention request/complete), `staff-web/src/api/cycles.ts` (get current cycle — the one lookup staff-web doesn't have yet), `staff-web/src/api/progress.ts` (dashboard + passed-levels), `staff-web/src/api/sample-media.ts` (authenticated blob fetch for playback).
2. **Review Queue page** (new route `/review-queue`, CLINICIAN/ADMIN only): lists available samples across patients, reserve action, navigates into that patient's Detail Hub on success.
3. **`SampleReviewSection`** on the Patient Detail Hub: shows the current cycle's submitted sample (self-report fields, sample parts with authenticated playback) whenever the cycle is in a review-relevant status, plus the three-variant decision form (transition / level-repeat / technical-rerecord), restricted to whoever holds the reservation.
4. **Intervention controls** inside `SampleReviewSection`: request (with type + reason) and complete (with outcome notes), gated the same way as the decision form.
5. **`ProgressSection`** on the Patient Detail Hub: the dashboard stats plus the passed-levels list, visible to all three staff roles (no gating needed).
6. **Permission helpers**: `canReviewSample(role)` (CLINICIAN/ADMIN) in `staff-web/src/auth/permissions.ts`, following the existing one-function-per-capability convention.
7. **Nav wiring**: a "قائمة المراجعة" (review queue) link in `AppShell`'s navbar, shown only when `canReviewSample(user.role)`.
8. **Real browser visual verification** before merge — the first for this whole project, closing a compounding gap flagged in the prior sub-project's retrospective.

### Explicitly out of scope, and why

- **Transfer responsibility (SUPERVISOR reassigning a reservation).** Blocked on a genuine, pre-existing backend gap discovered during this investigation: transferring requires picking a target clinician's `toUserId`, but the only endpoint that lists staff by role (`GET /api/v1/admin/users?role=CLINICIAN`) requires `MANAGE_USER_ACCOUNTS`, which only `ADMIN` holds — a `SUPERVISOR` (the only role that can actually call `transfer`) has no permitted way to look up which clinician to transfer to. Building this UI now would mean either a fake/broken picker or a scope-creeping backend permission change neither asked for nor reviewed. Flagged as a real, separate follow-on (needs a design decision: new supervisor-reachable staff-lookup endpoint, or reuse the existing mobile-style phone-lookup pattern), not silently dropped.
- **Historical level-content review** (`GET /patients/:id/levels/:levelId/review`, the second half of §16). The passed-levels *list* is in scope (cheap, complements the dashboard); drilling into a specific past level's full training content is a separate, additional screen with its own scope questions, deferred.
- **A shared frontend permission-enum mirroring the backend's `Permission` enum.** Staff-web has no such shared abstraction today (confirmed — permissions are hand-written booleans, no shared package between `backend/` and `staff-web/`) and introducing one is a cross-cutting refactor unrelated to this feature; `canReviewSample` follows the exact existing one-function-per-capability style instead.
- **Code-splitting the growing JS bundle** (the build already warns about a >500kB chunk). Pre-existing, unrelated to this feature, not addressed here.

## Architecture details

### `SampleReviewSection` visibility and gating

Renders `null` (matching every existing section's `if (!patient) return null` convention) when:
- The caller lacks `canReviewSample(user.role)` — a SUPERVISOR never sees this section at all, not even a read-only view, matching the backend's own inability to serve them the underlying data.
- The current cycle's status is not one of `WAITING_FOR_SPECIALIST | UNDER_REVIEW | DIRECT_INTERVENTION_REQUIRED | WAITING_FINAL_DECISION_AFTER_INTERVENTION | TECHNICAL_PARTIAL_RERECORD` — i.e. there's nothing to review right now.

Within those statuses, further gates who sees the write controls: the decision form and intervention controls only render for the specialist who holds `speechSample.reservedByUserId` (matching the backend's own `actor.id !== reservedByUserId` → 403 checks) — anyone else (a different clinician looking at the same patient, or the reservation holder viewing a status where they've already acted) sees the read-only sample detail without action controls.

### Sample media playback (the one piece of real UI novelty here)

```typescript
export async function fetchSampleMediaBlob(patientId: string, partId: string): Promise<string> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}/api/v1/patients/${patientId}/sample-parts/${partId}/media`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'MEDIA_FETCH_FAILED', 'تعذر تحميل التسجيل');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
```

Called on-demand (when a reviewer clicks a specific part, not eagerly for every part on section mount) to avoid downloading every clip up front; the resulting object URL is set as a plain `<video>`/`<audio>` element's `src` (choosing element by the part's `mimeType` prefix). `URL.revokeObjectURL` is called on unmount/part-change to avoid leaking blob URLs across a long session.

### Decision form

A discriminated `Select` on `decision` (`TRANSITION | LEVEL_REPEAT | TECHNICAL_RERECORD`) driving which fields render — mirrors the exact `useState`-per-field style `AssessmentsSection.tsx` already uses (no `@mantine/form`, matching this codebase's demonstrated preference even though the package is installed):
- `TRANSITION` / `LEVEL_REPEAT`: a `clinicianOpinionScore` `NumberInput` (1-9) + optional `reviewNotes` `Textarea`.
- `TECHNICAL_RERECORD`: a multi-select of the sample's parts (`damagedPartIds`, min 1) + optional `reviewNotes`.

### Progress dashboard layout

A `<Card withBorder>` showing `currentLevelName`/`currentLevelOrder`, `levelsCompleted`, `totalTrainingEvents`, `daysInProgram`, and `repeatedLevelOrders` (rendered as a comma-joined list or "none" — this is a small integer array, not worth a table), followed by the passed-levels list as a simple `<Table>` (level name, order, passed-at date), reusing the exact `formatDate` helper pattern `AssessmentsSection.tsx` already has.

## Testing

Vitest + RTL, colocated `*.test.tsx`, following the exact `vi.mock()`/provider-wrapping/`data-testid` conventions already established, gated on `npm run build` (`tsc -b`) at every task boundary in addition to `npm test` — per the explicit lesson from sub-project 2's retrospective that real bugs there were only caught by the type-checking build step, never by Vitest alone.

## Non-goals restated for clarity

Not building in this pass: transfer responsibility (real backend permission gap, needs its own follow-on design), historical level-content review detail, a shared frontend permission enum, bundle code-splitting.
