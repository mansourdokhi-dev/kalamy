# Staff Web App — Foundation (Sub-project 1) — Design Spec

## Context

This is sub-project 1 of a new, larger project: a staff-facing web application for Clinicians, Clinical Supervisors, and System Admins. The patient-facing mobile app (5 sub-projects: auth, treatment-engine screens, sample recording, reports, complaints) is complete and merged to master. The backend already has full functionality for all three staff roles — creating patient profiles, approving assessments, reviewing samples, managing treatment plans (Clinician); managing clinician assignments and viewing admin reports (Supervisor); managing staff accounts and system-wide reports/complaints (Admin) — but none of it has a UI yet. Today it's reachable only via the Swagger API docs.

## Project decomposition

The full staff-web project is planned as 5 sub-projects, each its own spec → plan → implementation cycle:

1. **Staff foundation** (this spec) — login, forced password-change, app shell, patient search
2. **Clinical workflow** — patient profile view/edit, assessment creation/approval, treatment plan management
3. **Sample review & progress** — reviewing submitted speech samples, treatment decisions, patient progress dashboards
4. **Reports & complaints management** — supervisor/admin operational reports, complaint status management
5. **Admin & supervision** — staff account creation/management, clinician-supervisor assignment

## Scope decisions from brainstorming

- **One unified app, not separate apps per role.** All three staff roles log into the same app; navigation and available screens are conditional on the backend's existing `Permission`/`ROLE_PERMISSIONS` system, avoiding duplicated login/shell code. This also lets an admin see clinician-style views (e.g., reviewing a specific complaint) without a separate app.
- **Force password-change on first login.** The backend's `mustChangePassword` flag (set when an admin creates a staff account) blocks all other navigation until the staff member sets their own password — this is the flow the backend feature was clearly built for.
- **Tech stack: Vite + React + TypeScript**, not Next.js. This is an internal, auth-gated tool with no public pages, so Next.js's server-rendering strengths (SEO, public page performance) don't apply — it would only add routing/component-split complexity with no payoff.
- **UI component library: Mantine.** Unlike the mobile app (which hand-rolled every component), this is a data-heavy internal tool — tables, filters, forms, modals — where a component library saves significant time. Mantine has strong TypeScript support and built-in RTL support.
- **Patient search is read-only in this sub-project**, with no click-through to a detail view — patient profile view/edit is explicitly sub-project 2's scope. Keeping this boundary crisp avoids building a half-finished detail page now.
- **Forgot-password is included**, reusing the same OTP-based flow as patients — verified directly against `backend/src/modules/auth/auth.service.ts`: `forgotPassword`/`resetPassword` look up the user by mobile number only, with no role restriction.

## Architecture

New `staff-web/` directory at the repo root, sibling to `backend/` and `mobile/`. Vite + React + TypeScript + Mantine + React Router. Auth uses the same bearer-token model the backend already expects (`Authorization: Bearer <token>`), with the token stored in `localStorage` (this app only ever runs in a browser — no native-storage concern like mobile had to solve for `expo-secure-store`).

### Screens

- **Login** (`/login`) — mobile number + password, calling the same `POST /api/v1/auth/login` endpoint the mobile app uses. The backend doesn't distinguish staff vs. patient login mechanically, only by the account's role in the response.
- **Forgot password** (`/forgot-password`) / **Reset password** (`/reset-password`) — mobile-number + OTP flow, mirroring the mobile app's screens.
- **Force change password** (`/change-password`, forced) — shown immediately after login when `mustChangePassword` is true. No navigation is possible until this is completed.
- **App shell** — a header/sidebar showing the logged-in staff member's name and role, a "Patients" nav link, and logout. Deliberately minimal: sub-projects 2-5 will add their own nav links (Reports, Admin, Supervision, etc.) as those screens are built. No placeholder links for screens that don't exist yet.
- **Patient search/list** (`/patients`) — a search box (matching the backend's actual behavior: name or national ID substring match) plus a results table (name, national ID, gender, date of birth, status). Capped at the backend's 50-result limit — no additional pagination UI needed since the backend doesn't support it yet. Read-only, no click-through.

### Data flow & error handling

A small hand-rolled `apiRequest` client (mirroring the mobile app's `mobile/src/api/client.ts` pattern) wraps `fetch`, attaches the bearer token, and parses backend error responses into a typed `ApiError` (status, code, message). Errors surface via Mantine's notification/alert components. Loading states use Mantine's built-in loading/skeleton primitives where applicable.

### RTL & copy

Per the project's product-wide constraint (Arabic is the primary language; UI must handle RTL), this app is Arabic-first like the mobile app. Mantine's `MantineProvider` is configured with `dir="rtl"`, and the document's `dir` attribute is set accordingly. All user-facing strings live in a centralized copy module (mirroring `mobile/src/copy/ar.ts`'s convention), not inline in components.

### Testing

**Vitest + React Testing Library** — Vitest is Vite's native test runner and needs no additional build configuration, unlike Jest (which the mobile app uses because Expo's tooling is Jest-based). Conventions otherwise mirror the mobile app: mocked API modules, real-string assertions (not snapshot tests), TDD (failing test → implementation → passing test) per task.

## Out of scope for this sub-project

- Patient profile view/edit (sub-project 2)
- Assessment/treatment-plan screens (sub-project 2)
- Sample review, progress dashboards (sub-project 3)
- Reports, complaints management (sub-project 4)
- Staff account management, supervision assignment (sub-project 5)
- Pagination beyond the backend's current 50-result cap on patient search (a future backend enhancement if patient volume ever requires it)
