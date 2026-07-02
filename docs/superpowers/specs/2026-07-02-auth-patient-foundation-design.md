# Kalamy Foundation: Auth & Patient Profile — Design

Status: Approved
Date: 2026-07-02

## Context

Kalamy (كلامي) is a digital therapeutics platform for stuttering/fluency disorders, specified in `docs/` (SRS documents, screen specs, clinical protocol, MVP execution spec — all converted to Markdown from the original .docx/.pdf sources). No code exists yet.

The full platform is a multi-surface system: patient app, caregiver app, clinician app, supervisor dashboard, admin dashboard, backend API, database, and (post-MVP per the SRS) an AI engine. That's too large for a single build. This spec covers only the first sub-project: the **foundation** — the backend module everything else depends on.

Recommended build order for the full platform (for reference, not all in scope here):
1. **Foundation: AUTH + Patient Profile (PAT)** — this spec
2. Clinical core: Assessment (ASM) + Treatment Plan (PLAN) + Exercise Library (EX)
3. Sessions + Progress (SES, PRO)
4. Reports + Notifications (REP)
5. Role-specific frontends (clinician dashboard, patient/caregiver app, admin panel)
6. AI engine (explicitly post-MVP per SRS-002)

## Source document notes

The docs are not a single clean spec — feedback on them is captured here since it shapes this design:

- At least four overlapping SRS efforts exist: root `SRS-001…007`, `KALAMY-001_SRS_Part1-5` + `Master` (in the zip package), `Part1_Expanded`, and `MVP-001`. `SRS_Master_v1` is treated as the umbrella authority here; `MVP-001` as the execution-ready subset. The root `SRS-001…007` series appears to be an earlier/parallel draft — not fully reconciled with the others.
- The tech-partner decks pitch an AI engine as a core differentiator, but `SRS-002` explicitly excludes advanced AI from MVP scope. No AI is included in this or the immediately following sub-projects.
- Referenced companion documents (`KALAMY-003` Database Dictionary, `KALAMY-004` API Specification, `KALAMY-005` UI Design System, `KALAMY-006` Business Rules) don't exist in the package. `MVP-001` itself states a full OpenAPI spec, detailed DB dictionary, and Figma designs are still needed before a production build — this spec and its data model are the first concrete step toward that, not a replacement for it.
- No compliance framework (e.g. Saudi PDPL) is named in the docs. Not addressed by this spec; revisit before handling real patient data or choosing a production host.
- SRS-005 specifies OTP lockout (5 min expiry, 5 attempts) but never states the lockout duration after 5 failed *login* attempts. This spec assumes **15 minutes** — flagged as an assumption, not a documented requirement.

## Scope

**In scope:**
- User registration, login/logout, OTP verification (mocked — see below), password reset, active-session management
- Role model for all 5 roles (Patient, Caregiver, Clinician, Supervisor, Admin) and the SRS-003 permission matrix, enforced at the API level
- Patient clinical profile: create/view/update, guardian-linking for minors, disable-only (never hard delete, per SRS-006)
- Audit log for sensitive operations
- A REST API (`/api/v1/...`) for later sub-projects and frontends to build against

**Out of scope (later sub-projects):**
- Assessment, Treatment Plan, Exercises, Sessions, Progress, Reports modules
- Any frontend (web/mobile apps, dashboards)
- Real SMS sending
- AI engine
- Cloud deployment (local-only for now, per explicit request)

## Architecture

- **Framework: NestJS** (Node.js/TypeScript). Chosen because NestJS's module system maps directly onto the SRS's own module taxonomy (`AUTH`, `PAT`, `ASM`, `PLAN`, ...) — this sub-project becomes two NestJS modules (`auth`, `patients`), and later sub-projects add new modules without restructuring. NestJS also provides, out of the box: **Guards** (for the SRS-003 permission matrix), **Interceptors** (for audit logging), and **auto-generated OpenAPI/Swagger** (which `MVP-001` explicitly calls for).
- **Database: PostgreSQL** — relational, strong audit-trail support, safe default for structured clinical data.
- **ORM: Prisma** — typed schema and migrations, integrates cleanly with TypeScript.
- **Validation: Zod** — request schemas encode the SRS's exact field rules (8-char minimum password, 6-digit OTP, etc.).
- **Local runtime: Docker Compose** — API + PostgreSQL, started with one command, no manual DB install.

Layout: a single repo, with `src/modules/auth/` and `src/modules/patients/`, each self-contained (controller, service, Prisma models) — a template for every module added afterward.

## Data model

- **User** — id, fullName, email, mobile (unique), passwordHash, role, status, timestamps. `role` ∈ `{PATIENT, CAREGIVER, CLINICIAN, SUPERVISOR, ADMIN}`.
- **OtpCode** — code, purpose, expiresAt (5 min), attempts (max 5), consumed flag. Belongs to a User.
- **Session** — active login sessions / trusted devices (supports "view/revoke active sessions," required by SRS-005).
- **GuardianLink** — links a caregiver User to a patient User; required when the patient is under 18 (SRS-006).
- **PatientProfile** — demographic/identity data: four-part name, gender, DOB, national ID, contact info, referral source, status (`active` | `disabled` — never deleted).
- **PatientClinicalInfo** — separate table from PatientProfile, matching the SRS's split between basic and clinical data: referral reason, initial diagnosis, medical history, medications, allergies, family history, e-consents.
- **AuditLog** — userId, action, entity, entityId, before/after snapshot (JSON), timestamp. Also serves as the "full edit history" required by SRS-006 — no separate versioning table.

**Permission model:** the SRS-003 permission matrix (5 roles × ~5 functions) is small and fixed. It is hardcoded as a policy object in code, used by the NestJS guards, rather than stored in the database. If admin-configurable roles are needed later, this is a contained change to make.

## API surface

**Auth** (`/api/v1/auth/...`):
- `POST /register`, `POST /verify` (OTP), `POST /login`, `POST /logout`
- `POST /forgot-password`, `POST /reset-password`
- `GET /sessions`, `DELETE /sessions/:id` — list/revoke active devices (required by SRS-005; not present in the source endpoint tables — added here to satisfy the requirement)

**Patients** (`/api/v1/patients/...`):
- `POST /` (create profile), `GET /:id`, `PUT /:id`, `GET /` (search, role-restricted)
- `POST /:id/guardian` (link a caregiver)
- `PATCH /:id/status` (disable — no DELETE endpoint exists by design)

## Cross-cutting concerns

- **RBAC** — a guard on every endpoint checks the caller's role against the hardcoded policy.
- **Audit logging** — an interceptor automatically logs every mutating request (register, login, logout, profile create/update/disable) with before/after snapshots, so individual endpoints can't forget to log.
- **Errors** — consistent JSON shape (`code`, `message`, field-level `details`); standard HTTP codes (401/403/404/409 duplicate mobile, 429 lockout).
- **OTP mock** — the code is always logged server-side; it is only echoed back in the API response when a `DEV_MODE` env flag is set, so the mock cannot leak into a real deployment later. No real SMS provider is integrated in this phase.
- **Login lockout** — 15 minutes after 5 failed attempts (assumption, see Source document notes).

## Testing approach

Test-driven development: write a failing test before implementing each behavior.

- **Unit tests** for logic with no DB dependency — password validation, OTP expiry/attempt handling, lockout timing, the RBAC policy.
- **Integration tests** against a real, throwaway PostgreSQL instance (via Docker) for anything touching the database or spanning layers — e.g. duplicate-mobile registration returns 409, disabling a profile doesn't hard-delete it, login creates an audit log entry.
- Single-command test run (`npm test`); integration tests manage their own DB setup/teardown.

## Non-goals / explicitly deferred

- Cloud hosting and data-residency decisions
- Real SMS integration
- Compliance framework selection (Saudi PDPL, etc.)
- Any module beyond AUTH/PAT
- Any frontend
