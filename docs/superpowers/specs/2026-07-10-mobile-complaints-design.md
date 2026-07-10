# Mobile Complaints (Submit + Own History) — Design Spec

## Context

This is sub-project 5/5 of the Kalamy mobile app, the last of five planned mobile sub-projects. Sub-projects 1-4 are complete and merged to master:

1. `mobile-foundation` — auth (register/login/OTP/forgot-reset-password)
2. `mobile-treatment-engine-screens` — My Program dashboard, Level Content, History, Sample Result
3. `mobile-sample-recording` — audio recording/playback, the 3-step recording wizard, damaged-part re-record
4. `mobile-reports-viewing` — read-only Reports screen (assessment results + medical report)

This sub-project lets a patient submit a complaint or suggestion, and view their own history of past submissions and current status.

## Backend gap found during scoping

The backend Complaints module (built in an earlier backend sub-project) already supports:
- `POST /api/v1/complaints` — submit (patients/caregivers have `SUBMIT_COMPLAINT`)
- `GET /api/v1/complaints/:id` — view a single complaint by ID, patient-scoped (403 if not the submitter, unless ADMIN/SUPERVISOR)
- `GET /api/v1/complaints` — list *all* complaints, but requires `MANAGE_COMPLAINTS` (staff-only), and isn't filtered to one user
- `PATCH /api/v1/complaints/:id/status` — staff-only status update

There is no endpoint that lets a patient list their own complaint history. This sub-project adds one:

**New: `GET /api/v1/complaints/mine`** — returns the current user's own complaints (`WHERE submittedByUserId = actor.id`), ordered `createdAt desc`, gated by `VIEW_COMPLAINT` (already granted to `PATIENT`/`CAREGIVER`). No schema changes — the `Complaint` Prisma model already has everything needed.

**Route ordering constraint:** `/mine` must be registered in `ComplaintsController` before the existing `GET /:id` route, otherwise Nest's router would try to match `/mine` against the `:id` parameter route and treat `"mine"` as a complaint ID.

## Scope decisions from brainstorming

- **No clinician linking in the mobile UI.** `relatedClinicianUserId` is optional on the backend, but there's no existing concept of "my assigned clinician" anywhere in the app (clinician assignment is per-assessment/per-cycle, not a stable per-patient relationship). The mobile submit form omits this field entirely; all complaints submitted from mobile are unlinked to a specific clinician.
- **Two separate screens, not one combined screen.** Submitting involves real user input (text fields, a type picker); mixing that with a scrolling history list on one screen was judged more cluttered than useful. This also matches the existing precedent of the sample-recording wizard being its own screen rather than embedded in the dashboard.
- **Compact history list, no detail drill-down.** Each row shows type + subject + status + date. No separate complaint-detail screen — descriptions are short free text, and the actionable thing to check is status, not re-reading your own submitted description.

## Mobile architecture

### API client — `mobile/src/api/complaints.ts`

Following the established one-small-file-per-backend-module convention (`api/reports.ts`, `api/patients.ts`):

```typescript
export type ComplaintType = 'COMPLAINT' | 'SUGGESTION';
export type ComplaintStatus = 'OPEN' | 'REVIEWED' | 'RESOLVED';

export interface Complaint {
  id: string;
  type: ComplaintType;
  subject: string;
  description: string;
  status: ComplaintStatus;
  createdAt: string;
}

export interface SubmitComplaintInput {
  type: ComplaintType;
  subject: string;
  description: string;
}

export function getMyComplaints(): Promise<Complaint[]>;
export function submitComplaint(input: SubmitComplaintInput): Promise<Complaint>;
```

### List screen — `mobile/app/program/complaints.tsx`

- Fetches `getMyComplaints()` on mount and on focus (`useFocusEffect`, matching the established refetch-on-focus pattern already used elsewhere in this app), so returning from a successful submission shows the new entry without a manual refresh.
- Renders a button/link at the top: "تقديم شكوى جديدة" (submit new complaint) → navigates to the submit screen.
- Each row: type label, subject, status label, formatted-as-is date (matching this app's existing convention of showing raw ISO date strings rather than a formatting helper, per Reports' precedent).
- Empty state: plain text, "لا توجد شكاوى بعد" — not routed through `ErrorBanner`, matching the convention that "no data yet" is not an error.
- Fetch failure: `ErrorBanner`, same as every other screen.

### Submit screen — `mobile/app/program/complaint-submit.tsx`

- Type picker: two options, "شكوى" (COMPLAINT) / "اقتراح" (SUGGESTION), defaulting to COMPLAINT selected.
- Subject text input, description text input (multiline).
- Submit button disabled until both subject and description are non-empty (client-side check — the backend's Zod schema also requires non-empty strings, so this just prevents a round-trip that would always fail).
- On successful submit: navigate back to the list screen (`router.back()`), which will refetch on focus.
- On submit failure (network/5xx): `ErrorBanner`, form state preserved so the patient doesn't lose what they typed.

### Home integration

A third always-visible link, "الشكاوى", alongside the existing Level Content / History / Reports links in `linksRow` — no gating by cycle status, consistent with those three.

### Copy — `mobile/src/copy/ar.ts`

New `complaints` namespace: `title`, `submitLinkLabel`, `submitScreenTitle`, `types.COMPLAINT`/`types.SUGGESTION`, `statuses.OPEN`/`REVIEWED`/`RESOLVED`, `subjectLabel`, `descriptionLabel`, `submitButtonLabel`, `noComplaintsYet`.

## Testing

Same RTL/Jest conventions as every prior screen: mocked `complaints.ts` API module, real Arabic string assertions (not snapshot tests). Planned cases:
- List screen: renders with data, shows empty state, shows `ErrorBanner` on fetch failure.
- Submit screen: submit button disabled with empty fields, enabled once both fields are filled, successful submit navigates back, failed submit shows `ErrorBanner` and preserves entered values.

This project has hit the same RTL cold-start `waitFor` timeout flake five times across two prior sub-projects (always in the first test of a newly-added test file, under CPU-contended/cold-cache conditions). Rather than discover it again, new test files in this sub-project will build in `{ timeout: 3000 }` on their first test's `waitFor` from the start.

## Out of scope

- Editing or withdrawing a submitted complaint.
- Any staff-side complaint management UI (the backend module and its permissions already exist; no clinician/admin/supervisor mobile screens are planned for this).
- Linking a complaint to a specific clinician.
- A complaint-detail drill-down screen.
