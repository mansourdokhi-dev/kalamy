# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

Kalamy (كلامي) is a digital therapeutics platform for fluency disorders / stuttering (اضطرابات الطلاقة والتلعثم), targeting the Arabic-speaking market. **This repository currently contains only product documentation — there is no source code, build system, or test suite yet.** All specs are written primarily in Arabic with English technical terms.

## Documentation Layout

Everything lives under `docs/`:

- `SRS-001` … `SRS-007` (.docx) — Software Requirements Specification split by topic: introduction/product definition, vision & KPIs, personas & roles, user journey & use cases, authentication, patient profile module, assessment module.
- `KALAMY-001_SRS_Part1_Expanded` — expanded SRS with user stories (US-xxx) and functional requirements (FR-001…FR-016).
- `KALAMY_Executive_Product_Deck_Chapter1/3` — executive product vision decks.
- `Kalami_TechPartner_Deck_*.pdf` — tech-partner pitch decks.
- `KALAMY_All_Documents_Package (1).zip` — the complete document set, including files not extracted elsewhere: full SRS Parts 1–5 + Master, Screen Specifications (KALAMY-002, Parts 1–4, screens SCR-xxx), the MVP Execution Specification (KALAMY-MVP-001), and clinical protocol documents (KALAMY-CLINICAL-001…004, KALAMY-CP-101) covering assessment standards, stuttering severity classification, and the five treatment phases.
- `docs/KALAMY OFFICIAL DOCUMENTATION/` — placeholder folders (Foundation Bible, Kalamy Product Specification); the .docx files inside are currently 0 bytes.

The .docx files are the source of truth. To read them, extract `word/document.xml` from the zip archive (or use pandoc if available).

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
- Referenced companion documents that may not exist yet: KALAMY-003 Database Dictionary, KALAMY-004 API Specification, KALAMY-005 UI Design System, KALAMY-006 Business Rules.
- Filenames and content mix Arabic and English; always use UTF-8 handling on Windows.
- No tech stack has been chosen yet in the docs. When code is added, record the actual build/lint/test commands here.
