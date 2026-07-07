# Kalamy Administration (Staff Accounts + Supervision) — Design

Status: Approved
Date: 2026-07-07

## Context

This is the fifth backend sub-project for Kalamy, building on the Foundation (Auth + Patient Profile), Clinical Core (Assessment + Treatment Plan + Exercise Library), Sessions + Progress, and Reports + Complaints modules, all merged to `master`. It covers the last remaining module code from `CLAUDE.md`'s module list: **ADM (Administration)**.

## Source document notes — same divergence pattern as Sessions and Reports

The official docs (`SRS-003` §2-3) describe the System Admin persona generically: "manages users, permissions, settings" with a permissions-matrix row of "manage users" / "manage settings", no further detail.

The tech-partner contract's admin-pages section (`docs/KALAMY-CONTRACT-REFERENCE_Presentation_Content_Inspiration.md` lines 49-64) is more specific: a new clinician account is added by the admin (not self-registered) and required to activate by changing their password on first login; an admin can delegate a supervisor to oversee a specific group of clinicians; an admin reviews any clinician's performance (already covered by the Reports module's staff-performance report); a portal-wide content-management dashboard; and a backup capability for the whole portal.

**The clinical stakeholder confirmed (2026-07-07) the contract's admin-account and supervision details are the real target**, the same divergence pattern already established three times now (Foundation's severity scoring, Sessions' 30-session protocol, Reports' 9-report list).

**A confirmed, concrete gap drove this scoping**: `AuthService.register()` only accepts `role: 'PATIENT' | 'CAREGIVER'` (`backend/src/modules/auth/dto/register.dto.ts:9`) — there is currently **no real way to create a CLINICIAN, SUPERVISOR, or ADMIN account** anywhere in the system. Every e2e test across all four merged modules creates staff accounts via a test-only shortcut (register as PATIENT, then flip the role directly in the database). This module replaces that shortcut with a real feature.

Two further items from the contract's admin section were explicitly scoped out after discussion:
- **System settings management**: no concrete settings list exists in any document (official or contract) — building a "settings screen" now would be pure speculation with nothing to configure, and would need to be redesigned once real settings are identified.
- **Portal backups**: an infrastructure/DevOps concern (database and code backups, hosting-level), not application/API logic — categorically out of scope for this backend, not merely deferred.

The contract's "visual color-coded patient classification" (new/red, in-progress/blue, completed/green) is a UI presentation layer over data this backend already exposes via the Progress module (`GET /api/v1/patients/:patientId/progress`) and the Reports module's registered-users report — it introduces no new backend concept and needs no new endpoint.

## Scope

**In scope:**
1. **Staff account creation** — ADMIN-only endpoint to create a CLINICIAN, SUPERVISOR, or ADMIN account directly (fullName, mobile, email, initial password, role), matching the contract's "admin adds the new clinician" flow. The admin sets the initial password directly (matches the existing pattern of typed-input creation used by the Patient Profile module, no random-password generation/delivery infrastructure needed).
2. **Forced password change on first login** — a `mustChangePassword` flag set to `true` on admin-created staff accounts, returned in the login response, cleared via a new authenticated `POST /api/v1/auth/change-password` endpoint (current password + new password). This is a different flow from the existing `forgot-password`/`reset-password` (OTP-based, for a user who doesn't have their current password) — here the user knows their current (admin-set) password and simply needs to replace it.
3. **User account management** — ADMIN-only list/search/filter (by role, by status) and single-record view across all 5 roles, plus enable/disable for any user account (distinct from the existing `PatientProfile` disable in the Patients module, which deactivates the clinical profile, not the login credential).
4. **Supervisor–clinician assignment** — ADMIN-only assignment of exactly one supervisor per clinician at a time (confirmed: a clinician has at most one active supervisor; a supervisor may oversee many clinicians). A supervisor can view their own assigned clinician list; an admin can view any supervisor's list.

**Out of scope (deferred/excluded, see Source document notes above for reasoning):**
- System settings management (no concrete settings identified anywhere yet).
- Portal backups (infrastructure, not application logic).
- Visual color-coded patient classification (a frontend presentation concern over already-exposed Progress/Reports data).
- Random/generated initial passwords and any delivery mechanism (email/SMS) for them.
- History/audit trail of past supervisor assignments beyond what the existing global `AuditLog` already captures automatically on the reassignment mutation.
- Any frontend.

## Architecture

Two new feature modules, following the Sessions+Progress precedent of splitting a sub-project into more than one focused NestJS module:

- `src/modules/admin-users/` — `admin-users.module.ts`, `.controller.ts`, `.service.ts`, `dto/`. Owns staff-account creation and generic user-account management (list/search/view/enable-disable) across all roles.
- `src/modules/supervision/` — `supervision.module.ts`, `.controller.ts`, `.service.ts`. Owns supervisor–clinician assignment and the assigned-clinicians list view.
- One small addition to the existing `AuthModule`/`AuthController`/`AuthService`: the `mustChangePassword` field on login responses, and the new `change-password` endpoint — this belongs in Auth because it's a general account-security action available to every authenticated user (any role), not an admin action, and mirrors the existing `logout`/`sessions` self-service endpoints already in that controller.

No other cross-cutting infrastructure is needed — RBAC guards, session guard, audit interceptor, exception filter, and Zod validation are already global.

## Data model

No new Prisma models. Two new fields on the existing `User` model:

- **`mustChangePassword`** (`Boolean @default(false)`) — set to `true` when an admin creates a staff account; cleared by the new change-password endpoint.
- **`supervisorUserId`** (`String?`, self-referencing FK to `User`) — the clinician's currently-assigned supervisor, `null` if unassigned. A simple nullable field is sufficient because the relationship is 1:1 from the clinician's side (at most one supervisor at a time) — reassignment is just an update to this field, and the change is automatically captured by the existing global `AuditLog` since it happens through a `PATCH`/`PUT` mutation. No separate assignment-history model is needed unless a future requirement asks for point-in-time history.

Two new self-relations on `User`:
```
supervisorUser      User?   @relation("ClinicianSupervisor", fields: [supervisorUserId], references: [id])
supervisedClinicians User[] @relation("ClinicianSupervisor")
```

## API surface

**Staff account creation & user management** (`/api/v1/admin/...`):
- `POST /api/v1/admin/staff` — ADMIN creates a CLINICIAN/SUPERVISOR/ADMIN account (fullName, mobile, email optional, password, role); sets `status: ACTIVE`, `mustChangePassword: true`. 409 if the mobile number is already registered (same rule as self-registration).
- `GET /api/v1/admin/users?role=&status=` — list/search/filter across all 5 roles.
- `GET /api/v1/admin/users/:id` — view one user's account record.
- `PATCH /api/v1/admin/users/:id/status` — enable (`ACTIVE`) or disable (`DISABLED`) any user's login credential.

**Auth additions** (`/api/v1/auth/...`):
- `POST /api/v1/auth/login` — response gains a `mustChangePassword: boolean` field (no other change to the existing behavior).
- `POST /api/v1/auth/change-password` — authenticated (any role, self-service, no RBAC permission — matches the existing `logout`/`sessions` self-service pattern), body: `currentPassword`, `newPassword`. Verifies `currentPassword` against the stored hash, updates to `newPassword`'s hash, and clears `mustChangePassword` to `false`.

**Supervision** (`/api/v1/admin/supervision/...`):
- `PUT /api/v1/admin/supervision/:clinicianUserId` — ADMIN-only; body `{ supervisorUserId: string | null }`; assigns, reassigns, or (with `null`) unassigns the clinician's supervisor. 404 if either user id doesn't exist or isn't the expected role (clinician must be role `CLINICIAN`; supervisor, if provided, must be role `SUPERVISOR`).
- `GET /api/v1/admin/supervision/:supervisorUserId/clinicians` — the list of clinicians currently assigned to a supervisor. ADMIN can view any supervisor's list; a SUPERVISOR can only view their own (`supervisorUserId === actor.id`), enforced in the service layer the same way `ComplaintsService.findById`'s ownership check works (not purely RBAC-permission-based, since the same route serves both an unrestricted ADMIN view and a self-scoped SUPERVISOR view).

## Cross-cutting concerns

- **RBAC**: new permissions — `CREATE_STAFF_ACCOUNT` (ADMIN only), `MANAGE_USER_ACCOUNTS` (ADMIN only — covers list/view/enable-disable), `MANAGE_SUPERVISION` (ADMIN only — covers assign/reassign/unassign), `VIEW_SUPERVISION` (ADMIN and SUPERVISOR — ownership-enforced in the service for SUPERVISOR, unrestricted for ADMIN, the same pattern as `PatientAccessService.assertCanAccess`'s role-bypass-then-ownership-check shape).
- **Password-change endpoint has no RBAC permission gate** — it's a self-service action available to every authenticated role, matching `logout`/`GET sessions`/`DELETE sessions/:id` in the existing `AuthController`.
- **Audit logging**: automatic via the existing global interceptor for every mutating endpoint in this module (staff creation, status changes, supervision assignment, password changes — the latter's request body already gets redacted by the interceptor's existing `SENSITIVE_FIELDS` set, which includes `password`/`newPassword`).
- **No hard deletes**: user accounts are only ever disabled (`status: DISABLED`), never deleted, consistent with every other module.

## Testing approach

Same TDD approach as prior modules: e2e tests against a real Postgres for every endpoint — staff-account creation (success, duplicate-mobile 409, non-ADMIN 403), the `mustChangePassword` flag appearing on login and being cleared by the change-password endpoint (including a wrong-current-password rejection case), user list/filter/enable/disable, and supervision assignment/reassignment/unassignment plus the ownership-scoped clinician-list view (SUPERVISOR sees only their own, ADMIN sees any, a different SUPERVISOR gets 403).

## Non-goals / explicitly deferred

- System settings management
- Portal backups
- Visual color-coded patient classification (frontend concern over existing data)
- Randomly-generated initial passwords / delivery mechanism
- Supervisor-assignment history beyond the existing audit log
- Any frontend
