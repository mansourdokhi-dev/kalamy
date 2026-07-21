# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

Kalamy (كلامي) is a digital therapeutics platform for fluency disorders / stuttering (اضطرابات الطلاقة والتلعثم), targeting the Arabic-speaking market. The repository now contains a **working, tested implementation** — a NestJS/Prisma backend, a React staff web app, and an Expo/React Native mobile app — alongside the original product documentation under `docs/`. The specs are written primarily in Arabic with English technical terms; the built system implements the MVP defined in KALAMY-MVP-001 plus the "Treatment Engine v2" design that superseded parts of it (see `docs/superpowers/specs/`). The platform is at ~90% pilot readiness; the remaining items are external-account/hardware setup, documented in `docs/RUNBOOK.md`.

## Documentation Layout

Product documentation lives under `docs/`:

- `SRS-001` … `SRS-007` (.docx) — Software Requirements Specification split by topic: introduction/product definition, vision & KPIs, personas & roles, user journey & use cases, authentication, patient profile module, assessment module.
- `KALAMY-001_SRS_Part1_Expanded` — expanded SRS with user stories (US-xxx) and functional requirements (FR-001…FR-016).
- `KALAMY_Executive_Product_Deck_Chapter1/3` — executive product vision decks.
- `Kalami_TechPartner_Deck_*.pdf` — tech-partner pitch decks.
- `KALAMY_All_Documents_Package (1).zip` — the complete document set, including files not extracted elsewhere: full SRS Parts 1–5 + Master, Screen Specifications (KALAMY-002, Parts 1–4, screens SCR-xxx), the MVP Execution Specification (KALAMY-MVP-001), and clinical protocol documents (KALAMY-CLINICAL-001…004, KALAMY-CP-101) covering assessment standards, stuttering severity classification, and the five treatment phases.
- `docs/KALAMY OFFICIAL DOCUMENTATION/` — placeholder folders (Foundation Bible, Kalamy Product Specification); the .docx files inside are currently 0 bytes.

The .docx files remain the product source of truth for *requirements*. To read them, extract `word/document.xml` from the zip archive (or use pandoc if available). Prior-session design specs and plans (authoritative for already-built architecture decisions) live under `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## Codebase Layout

Three apps, each its own npm project (run `npm ci` in each first):

- **`backend/`** — NestJS 11 + Prisma 6 + PostgreSQL. REST API under `/api/v1/...`. Modules live in `backend/src/modules/*` (auth, patients, assessments, treatment-plans, exercises, treatment-engine, progress, reports, complaints, consultations, notifications, admin-users, supervision); cross-cutting concerns in `backend/src/common/*` (auth/session guard, rbac, audit, otp-delivery, patient-access, security). Prisma schema + migrations in `backend/prisma/`.
  - Build/run: `npm run build` → `npm start` (prod); `npm run start:dev` (watch).
  - DB: `npx prisma generate`, `npx prisma migrate deploy` (prod) / `npm run prisma:migrate` (dev).
  - Tests: `npm test` (unit, mocks, fast — **this is what CI runs**); `npm run test:e2e` (needs a real Postgres from `DATABASE_URL`). **Never run two e2e invocations at once — they share and reset the same DB.** The full e2e suite (45 spec files, incl. `test/full-patient-journey.e2e-spec.ts` which walks the whole gated pipeline registration→final report) is green as of 2026-07-21 — **330/330 tests, 45/45 suites (`JEST_EXIT=0`)**; `npm run test:e2e` runs them serially in one process (`--runInBand`). Capture jest's own exit code (`JEST_EXIT=$?`) as the pass/fail signal — the `Test Suites:`/`Tests:` summary lines don't survive a non-TTY pipe.
- **`staff-web/`** — Vite + React 19 + Mantine, RTL Arabic UI for CLINICIAN/SUPERVISOR/ADMIN. Pages in `staff-web/src/pages/`, patient-detail sections in `staff-web/src/patients/`, API clients in `staff-web/src/api/`.
  - Run: `npm run dev` (:5173). Build: `npm run build` (`tsc -b && vite build`). Tests: `npm test` (Vitest). Lint: `npm run lint` (oxlint). Typecheck alone: `npx tsc -b`.
- **`mobile/`** — Expo (SDK 57) + React Native + expo-router, RTL Arabic UI for PATIENT/CAREGIVER. Screens in `mobile/app/` (file-based routing), shared code in `mobile/src/`. **Read `mobile/AGENTS.md` before touching Expo APIs — the SDK has changed significantly; consult the versioned docs.**
  - Run: `npm run web` (:8081) / `npm run android` / `npm run ios`. Tests: `npm test` (Jest). Typecheck: `npx tsc --noEmit` (note: test files have pre-existing Jest-global type errors unrelated to app code).

Config: backend via `backend/.env` (see `backend/.env.example` — `DATABASE_URL`, `DEV_MODE`, `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY`, `SMTP_*`, `WHATSAPP_*`); frontends via `VITE_API_BASE_URL` (staff-web) / `EXPO_PUBLIC_API_BASE_URL` (mobile). Full deploy/bootstrapping guide (incl. the manual first-admin and treatment-level setup — there is no seed script) is in `docs/RUNBOOK.md`.

CI (`.github/workflows/tests.yml`) runs the **unit** suites of all three apps on push/PR to `master`; e2e is not yet in CI (needs a Postgres service container). `master` is protected — merge via PR.

**TDD is the norm here** (see the many `*.spec.ts`/`*.test.tsx`/`*.e2e-spec.ts` files): write the failing test first, watch it fail for the right reason, then implement. Match this when adding features or fixing bugs.

## Product Architecture (from the specs)

The planned MVP 1.0 system, per KALAMY-001/KALAMY-MVP-001:

- **Five roles**: Patient (المستفيد), Caregiver (ولي الأمر), Clinician/speech therapist (الأخصائي), Clinical Supervisor (المشرف), System Admin (مدير النظام). A permissions matrix in SRS-003 defines least-privilege access per role.
- **Core modules** with codes used throughout the docs: AUTH (accounts), PAT (clinical patient profile), ASM (assessment), PLAN (treatment plan), EX (exercises), SES (sessions), PRO (progress), REP (reports), ADM (administration).
- **Patient journey is a strict gated pipeline**: registration → profile completion → initial assessment → treatment plan → daily exercises → therapy sessions (in-person and remote) → re-assessment → final report. A stage cannot begin until the previous one is approved (e.g., assessment requires a complete clinical profile; a treatment plan requires an approved assessment).
- **REST API** is specified as `/api/v1/...` (e.g., `POST /api/v1/auth/register`, `POST /api/v1/auth/verify`, `/api/v1/patients`, `/api/v1/assessments`). Endpoint tables appear in SRS-005/006/007 and the screen specs.
- **Key business rules** repeated across docs: phone number is the unique registration identity with OTP verification (5-minute expiry, 5 attempts max, temporary lockout); users under 18 must be linked to a caregiver; clinical profiles can never be deleted, only deactivated; all sensitive operations go to an audit log; assessment results are versioned and re-assessments compare against baseline.
- **Platform targets**: web + iOS + Android; Arabic is the primary language (English planned later) — UI work must handle RTL.
- **Out of MVP scope** (do not design for these yet): advanced AI, hospital integration (HL7/FHIR), insurance, external medical devices, marketplace, complex multi-tenancy.

## Working Conventions

- Document IDs follow `KALAMY-NNN` / `SRS-NNN`; requirements are `FR-xxx` / `MVP-FR-xxx`, user stories `US-xxx`, use cases `UC-xxx`, screens `SCR-xxx`. Reference these codes when discussing or implementing requirements.
- Referenced companion documents that may not exist as separate files: KALAMY-003 Database Dictionary (the live schema is `backend/prisma/schema.prisma`), KALAMY-004 API Specification (the live routes are the `*.controller.ts` files), KALAMY-005 UI Design System, KALAMY-006 Business Rules.
- Filenames and content mix Arabic and English; always use UTF-8 handling on Windows.
- All user-facing UI copy is Arabic and centralized in each frontend's `src/copy/ar.ts` — never hardcode strings in components. UI must handle RTL.
- The implementation sometimes extends beyond KALAMY-MVP-001's original 12 requirements (e.g. the Treatment Engine v2 level/72h-cycle model, specialist review queue, consultations). When a gap or ambiguity arises, check the approved docs (SRS / KALAMY-MVP-001 / KALAMY-002 screen specs / the corrected executive reference) before treating something as in-scope — do not invent new features.
