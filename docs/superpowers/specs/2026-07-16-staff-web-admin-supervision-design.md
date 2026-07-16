# Staff Web Sub-project 5: Admin & Supervision — Design

## Goal

This is sub-project 5, the **last** of the planned 5-part staff-web build (`project_kalamy_staff_web_status` memory). Sub-projects 1–4 (foundation, clinical workflow, sample review & progress, reports & complaints) are done and merged. This project gives ADMIN a UI for staff-account management and clinician-supervisor assignment, gives SUPERVISOR a UI to see their assigned clinicians, and unblocks the "transfer review responsibility" feature that sub-project 3 explicitly deferred due to a then-real backend gap.

## Current state (investigated directly)

- **Stack, pinned**: identical to every prior sub-project — Vite + React 19.2 + TypeScript, Mantine 9.4.1 exactly, React Router 7 classic API, plain `apiRequest<T>()` client, Vitest 4 + RTL 16, `npm run build` (`tsc -b && vite build`) is the only type-checking step.
- **`staff-web/src/api/`** currently has: `assessments.ts`, `auth.ts`, `client.ts`, `complaints.ts`, `cycles.ts`, `exercises.ts`, `patients.ts`, `progress.ts`, `reports.ts`, `sample-media.ts`, `specialist-review.ts`, `treatment-plans.ts` (plus `.test.ts` siblings). No `admin-users.ts` or `supervision.ts` exists yet.
- **`staff-web/src/pages/`** currently has 9 pages: Login/ForgotPassword/ResetPassword/ChangePassword, Patients/PatientDetail, ReviewQueue, Complaints, AdminReports. No staff-account-management or supervision page exists yet.
- **`staff-web/src/auth/permissions.ts`** has exactly 4 helpers: `canEditClinicalData`, `canReviewSample`, `canManageComplaints`, `canViewAdminReports` — all one-boolean-per-capability, no shared enum. This project adds more in the same style.
- **Card-section pattern** for patient-scoped UI, **standalone-page-with-own-route** pattern (`ReviewQueuePage`/`ComplaintsPage`/`AdminReportsPage`) for cross-patient UI — both established and reused here without deviation.
- **`SampleReviewSection.tsx`** (sub-project 3) currently renders `null` entirely for SUPERVISOR (gated on `canReviewSample`, which SUPERVISOR never satisfies) — this sub-project extends its gating to give SUPERVISOR a narrow, read-only + transfer-only view, described below.

## Backend API surface consumed (all already shipped — no backend changes)

### Admin — staff accounts (`backend/src/modules/admin-users/`, base `/api/v1/admin`)

| Endpoint | Permission | Notes |
|---|---|---|
| `POST /api/v1/admin/staff` | `CREATE_STAFF_ACCOUNT` (ADMIN only) | body `{ fullName, mobile, email?, password, role: 'CLINICIAN'\|'SUPERVISOR'\|'ADMIN' }` |
| `GET /api/v1/admin/users?role=&status=` | `MANAGE_USER_ACCOUNTS` (ADMIN only) | both query params optional, unvalidated strings server-side |
| `GET /api/v1/admin/users/:id` | `MANAGE_USER_ACCOUNTS` (ADMIN only) | 404 if missing |
| `PATCH /api/v1/admin/users/:id/status` | `MANAGE_USER_ACCOUNTS` (ADMIN only) | body `{ status: 'ACTIVE'\|'DISABLED' }` — **only these two values**, never `LOCKED`/`PENDING_VERIFICATION` |

Response shape (`StaffAccountSummary`, `passwordHash` deliberately excluded):
```typescript
interface StaffAccountSummary {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  role: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN';
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
  mustChangePassword: boolean;
  createdAt: string;
}
```

### Supervision (`backend/src/modules/supervision/`, base `/api/v1/admin/supervision`)

| Endpoint | Permission | Notes |
|---|---|---|
| `PUT /api/v1/admin/supervision/:clinicianUserId` | `MANAGE_SUPERVISION` (ADMIN only) | body `{ supervisorUserId: string \| null }` — `null` unassigns. Backend validates target `clinicianUserId` is role `CLINICIAN` and, if non-null, `supervisorUserId` is role `SUPERVISOR`. |
| `GET /api/v1/admin/supervision/:supervisorUserId/clinicians` | `VIEW_SUPERVISION` (SUPERVISOR + ADMIN) | **Ownership-scoped for SUPERVISOR**: a SUPERVISOR calling this with any `:supervisorUserId` other than their own gets 403. ADMIN can query any supervisor's clinicians. |

### Transfer review responsibility (`backend/src/modules/treatment-engine/specialist-review-queue.controller.ts` — extends the specialist-review API already partly consumed since sub-project 3)

| Endpoint | Permission | Notes |
|---|---|---|
| `POST /api/v1/specialist-review/cycles/:cycleId/transfer` | `TRANSFER_REVIEW_RESPONSIBILITY` (**SUPERVISOR only** — ADMIN does not hold this permission) | body `{ toUserId: string, reason: string }`. Backend validates `toUserId` holds `REVIEW_SAMPLE` (CLINICIAN or ADMIN) and the cycle's status is one of `UNDER_REVIEW \| DIRECT_INTERVENTION_REQUIRED \| WAITING_FINAL_DECISION_AFTER_INTERVENTION`. |

This was explicitly deferred in sub-project 3's design doc as blocked on "a SUPERVISOR has no permitted way to look up which clinician to transfer to." That gap is now closed: commit `76c63ef` added the ownership-scoped `listClinicians` endpoint above specifically so a SUPERVISOR can look up their own clinicians via `VIEW_SUPERVISION` — this sub-project is the frontend follow-through on that fix.

### RBAC — full table for ADM-relevant permissions (verified against `backend/src/common/rbac/permissions.ts`)

| Permission | CLINICIAN | SUPERVISOR | ADMIN |
|---|---|---|---|
| `CREATE_STAFF_ACCOUNT` | ❌ | ❌ | ✅ |
| `MANAGE_USER_ACCOUNTS` | ❌ | ❌ | ✅ |
| `MANAGE_SUPERVISION` | ❌ | ❌ | ✅ |
| `VIEW_SUPERVISION` | ❌ | ✅ (own only) | ✅ (any) |
| `TRANSFER_REVIEW_RESPONSIBILITY` | ❌ | ✅ | ❌ |
| `REVIEW_SAMPLE` (transfer target must hold this) | ✅ | ❌ | ✅ |

## Scope

### In scope

1. **API modules** (new): `staff-web/src/api/admin-users.ts` (`createStaffAccount`, `listStaffAccounts(filter)`, `getStaffAccount(id)`, `updateAccountStatus(id, status)`), `staff-web/src/api/supervision.ts` (`assignSupervisor(clinicianUserId, supervisorUserId)`, `listMyClinicians(supervisorUserId)`).
2. **Extend `staff-web/src/api/specialist-review.ts`** (existing file, not new) with `transferReviewResponsibility(cycleId, input)` — it belongs there because it's the same backend controller/module as everything else already in that file.
3. **Staff Accounts page** (new route `/staff-accounts`, **ADMIN only** — every write action here requires an ADMIN-only permission, so the whole page is gated the same all-or-nothing way `AdminReportsPage` gates on `canViewAdminReports`):
   - List filtered to staff roles by default (`role` filter defaulting to showing CLINICIAN/SUPERVISOR/ADMIN — see "Explicitly out of scope" for why PATIENT/CAREGIVER are excluded from this view's default), with a status filter too.
   - Create-staff form (fullName, mobile, email optional, password, role — CLINICIAN/SUPERVISOR/ADMIN only, matching the backend DTO's role enum exactly).
   - Enable/disable action per row (`PATCH .../status`, `ACTIVE`/`DISABLED` only — never renders a `LOCKED`/`PENDING_VERIFICATION` option since the backend endpoint doesn't accept them).
   - Supervisor-assignment control on CLINICIAN rows only: a `Select` of current SUPERVISOR-role accounts (drawn from the same page's already-loaded user list, filtered client-side to `role === 'SUPERVISOR'`) plus an "unassign" option, calling `assignSupervisor`.
4. **My Clinicians page** (new route `/my-clinicians`, **SUPERVISOR only**): read-only list of the logged-in supervisor's assigned clinicians, calling `listMyClinicians(user.id)` (the supervisor's own id from `useAuth()` — never a route param, since the backend only permits self-scoped access for this role anyway).
5. **Transfer control on `SampleReviewSection`**: extend the section's gating so a SUPERVISOR sees a narrow, read-only variant (cycle status + current reservation holder, sample parts list for context — no decision form, no intervention controls, since those remain CLINICIAN/ADMIN-only) plus a transfer form (target clinician `Select` populated from `listMyClinicians(user.id)`, reason `Textarea`), visible only when the cycle status is one of the three transfer-eligible statuses.
6. **Permission helpers** in `staff-web/src/auth/permissions.ts`: `canManageStaffAccounts(role)` (ADMIN only — covers all three ADMIN-only admin-users/supervision-assignment actions, since they're always used together on one page and gated identically), `canViewMyClinicians(role)` (SUPERVISOR only), `canTransferReview(role)` (SUPERVISOR only).
7. **Nav wiring**: "حسابات الطاقم" (Staff Accounts) gated on `canManageStaffAccounts`; "أخصائيوّ الإشراف" (My Clinicians) gated on `canViewMyClinicians`.

### Explicitly out of scope, and why

- **Role change after account creation.** No backend endpoint exists (`role` is set once at `POST /admin/staff` time, never mutated). Confirmed via full grep of `admin-users.controller.ts` — no PATCH touches `role`. A real gap, not something to fake with a disabled control that implies future support.
- **Unlocking a rate-limited account before its 15-minute lockout expires.** Confirmed: `PATCH .../status` only ever writes the `status` column; the login lockout (`failedLoginAttempts`, `lockedUntil`) is a **separate** pair of columns that no endpoint resets, and `UserStatus.LOCKED` itself is a dead enum value nothing in the codebase ever assigns. Building an "unlock" button here would either silently do nothing useful (toggling `status` to `ACTIVE` doesn't touch `lockedUntil`) or require inventing a fake success message — neither is acceptable. Flagged as a real, separate backend follow-on (the natural fix is for the status endpoint, or a new one, to also clear `failedLoginAttempts`/`lockedUntil`), not silently dropped.
- **Full staff-directory browsing for SUPERVISOR.** The backend's `listClinicians` is hard-scoped to the caller's own `supervisorUserId` — a SUPERVISOR literally cannot query any other supervisor's clinicians or the full staff list (that stays `MANAGE_USER_ACCOUNTS`/ADMIN-only). "My Clinicians" is named and scoped to match this exactly, not a general directory.
- **ADMIN as a transfer target, or ADMIN performing transfers.** `TRANSFER_REVIEW_RESPONSIBILITY` is SUPERVISOR-only on the backend — ADMIN cannot call the transfer endpoint at all, so no transfer UI is shown to ADMIN. Separately, even for a SUPERVISOR performing a transfer, `listMyClinicians` can only ever return CLINICIAN-role users (that's what the relation models), so an ADMIN target is never reachable through this flow regardless — this matches backend reality, not an omission on the frontend's part.
- **PATIENT/CAREGIVER account rows in the Staff Accounts page's default view.** The `GET /api/v1/admin/users` endpoint technically accepts any `role` value including `PATIENT`/`CAREGIVER`, and a patient's account can already be disabled through the existing patient-scoped `ProfileSection` UI (`تعطيل الحساب`, shipped in an earlier sub-project) — that is the clinically-appropriate place for patient-account actions, tied to the patient's clinical record. Duplicating patient-account management in a generic staff table would be a second, disconnected place to do the same thing. The role filter's options are `CLINICIAN | SUPERVISOR | ADMIN` only; the underlying endpoint isn't restricted, so this is a frontend UX scope choice, not a backend limitation.
- **Raw/full audit log UI.** Already covered by `AdminReportsPage`'s service-modifications tab (sub-project 4); no separate/richer audit endpoint exists under the admin module to build a second view for.
- **A shared frontend permission-enum mirroring the backend's `Permission` enum.** Same reasoning as every prior sub-project.
- **Bundle code-splitting.** Pre-existing, unrelated, not addressed here.

## Architecture details

### Staff Accounts page (`/staff-accounts`)

Gated the same way `AdminReportsPage` gates on its single permission: `if (!user || !canManageStaffAccounts(user.role)) return null;` at the top of the page component, before any data fetching.

Layout: a create-account form (collapsible, mirroring the `TreatmentPlanSection`'s new-plan-form precedent — a "حساب جديد" button reveals the form) above a filterable table:
- Role `Select` (CLINICIAN/SUPERVISOR/ADMIN, no "all" default needed given the small fixed set — default to showing all three by querying without a `role` param then filtering client-side to the three staff roles, since the backend has no "multiple roles" query capability and issuing 3 parallel requests for a rarely-large staff list is needless complexity).
- Status `Select` (ALL/PENDING_VERIFICATION/ACTIVE/LOCKED/DISABLED — display-only filter values; the write action only ever sends ACTIVE/DISABLED, matching the backend's actual capability).
- Each row: name, mobile, email (`—` if null), role badge, status badge, `mustChangePassword` indicator, created date, an enable/disable button (label flips based on current status), and — CLINICIAN rows only — a supervisor-assignment `Select`.

### Supervisor-assignment control

Rendered only where `row.role === 'CLINICIAN'`. Options are every currently-loaded `SUPERVISOR`-role row (`accounts.filter(a => a.role === 'SUPERVISOR')`) plus an explicit "بدون مشرف" (no supervisor) option mapping to `null`. On change, calls `assignSupervisor(row.id, value)` then refetches the account list (refetch-after-mutation, per the established lesson from sub-project 3's final review — never patch state in place).

The control needs each CLINICIAN row's *current* supervisor to show a correct initial value, but `StaffAccountSummary` (the list-endpoint response) has no `supervisorUserId` field — confirmed via `admin-users.controller.ts`'s select projection, which excludes it. Rather than adding an extra per-row detail fetch (`GET /admin/users/:id` does return the full `User` record — but the investigation didn't confirm `supervisorUserId` is included there either, since it wasn't asked for): the safe, already-available alternative is deriving current assignment from the SUPERVISOR side instead — call `listMyClinicians` is SUPERVISOR-scoped and self-only, not usable from the ADMIN's page for arbitrary supervisors. **Given neither existing endpoint gives ADMIN a per-clinician "who is their current supervisor" read**, the assignment control on this page is **write-only**: it always renders unselected (a placeholder "اختر مشرفًا" prompt) rather than showing a possibly-wrong or fabricated current value, and successfully assigning immediately reflects in a small inline confirmation ("تم التعيين") rather than a persistent selected state. This is a real, narrow limitation of the current backend response shape — documented here rather than worked around with a guessed value or an extra unreviewed endpoint.

### My Clinicians page (`/my-clinicians`)

Gated on `canViewMyClinicians`. Calls `listMyClinicians(user.id)` on mount (the logged-in SUPERVISOR's own id — never a route param). Read-only table: name, mobile, status. No write actions — assignment is ADMIN-only, done from the Staff Accounts page.

### `SampleReviewSection` extension for SUPERVISOR

Current gating (`if (!canReviewSample(user.role)) return null`) is widened to: render for `canReviewSample(user.role) || canTransferReview(user.role)`. Within the section, a SUPERVISOR sees:
- The same unconditional parts-playback list every viewer sees today (no change).
- **Not** the decision form or intervention controls (those stay behind the existing `canReviewSample`-derived `isReservationHolder` gate — a SUPERVISOR is never `isReservationHolder` since they can't hold a `REVIEW_SAMPLE`-gated reservation).
- A **new** transfer block, visible only when `canTransferReview(user.role)` is true and the cycle status is one of `UNDER_REVIEW | DIRECT_INTERVENTION_REQUIRED | WAITING_FINAL_DECISION_AFTER_INTERVENTION`: a target-clinician `Select` (populated from `listMyClinicians(user.id)`, fetched once when the block first becomes visible) and a reason `Textarea`, submitting `transferReviewResponsibility(cycle.id, { toUserId, reason })`, then refetching `getCurrentCycle` on success (matching the section's existing refetch-after-mutation pattern from its other two handlers).

## Testing

Vitest + RTL, colocated `*.test.tsx`, `vi.mock()` per API module, provider-wrapped renders, `data-testid` on rows/forms — identical conventions to every prior sub-project. `npm run build` (`tsc -b`) gated at every task boundary alongside `npm test`.

## Non-goals restated for clarity

Not building in this pass: role change after creation (no backend endpoint), lockout-unlock before expiry (no backend endpoint connects it to the status field), full staff-directory access for SUPERVISOR (backend hard-scopes to own clinicians), ADMIN performing/receiving transfers (backend permission excludes ADMIN entirely), patient/caregiver account rows in this page's default view (already handled elsewhere, clinically-scoped), a second audit-log UI (already covered), a shared frontend permission enum, bundle code-splitting.
