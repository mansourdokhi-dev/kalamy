# Kalamy Mobile App — Foundation (Sub-project 1 of 5) — Design

Status: Approved
Date: 2026-07-07

## Context

This is the first of five planned sub-projects for the Kalamy patient/caregiver mobile app (Android + iOS), sitting alongside the five backend sub-projects already merged to `master` (Foundation, Clinical Core, Sessions+Progress, Reports+Complaints, Administration). The mobile app is a new consumer of the existing real backend — no new backend endpoints are needed for this sub-project.

**Decomposition of the mobile app project** (confirmed with the user before this spec):
1. **Foundation** (this spec) — app scaffold, age-based theming system, RTL support, auth screens
2. Patient profile completion + guardian linking
3. Diagnosis/assessment flow (the four tests from the contract, results, medical report)
4. Treatment flow (the fixed 30-session curriculum, clinician-gate status)
5. Follow-up (progress dashboard, past reports, motivational messages, clinician messaging, complaints)

**Confirmed scope boundaries** for the whole mobile app initiative (not just this sub-project):
- **Patients and caregivers only.** Clinician/supervisor/admin functions (sample review, session approval, the admin console) stay a separate, later, web-based interface — confirmed explicitly by the user rather than assumed.
- **No payment/subscription gate.** The contract describes a payment step before diagnosis; the backend has no payments module (deliberately deferred since the Reports+Complaints sub-project's contract review). The user confirmed the app skips this entirely for now — diagnosis and treatment are reachable directly, matching what the backend actually enforces today.
- **Media capture/storage is an open, unresolved gap**, flagged to the user and explicitly deferred to when sub-project 3 (diagnosis, which needs audio recording) is designed — not blocking this sub-project, which has no recording of any kind.

## Scope (this sub-project)

**In scope:**
- A new `mobile/` Expo/React Native/TypeScript app, sibling to `backend/` in the same repo.
- Age-based theming system: three color/shape palettes (children, teens, adults) defined and wired into a theme provider, but **not yet selectable** — no screen in this sub-project collects date of birth (that happens in sub-project 2's profile-completion flow). Every screen in this sub-project renders under the "adults" palette as a neutral default; the provider is built so sub-project 2 can switch it once age is known.
- RTL-first layout (Arabic only for now, per the project's documented Arabic-first/English-later plan) — no i18n library, just centralized Arabic copy per screen so a second locale is a follow-up, not a rewrite.
- Screens: welcome → register-for-self-or-child choice → registration form → OTP verification → login → forgot/reset password → a minimal authenticated "home" placeholder.
- A typed API client wired to the real backend's existing Auth endpoints (`/api/v1/auth/register`, `/verify`, `/login`, `/forgot-password`, `/reset-password`), with the session token persisted in encrypted on-device storage and auto-attached to future requests.
- Session restore on app relaunch (read the stored token, treat as logged-in if present — no dedicated "am I still logged in" endpoint exists yet, so this sub-project treats "has a stored token" as logged-in and lets the first authenticated request's 401 response trigger a logout, since that is the only signal the backend currently provides).

**Out of scope (deferred to later sub-projects, not to this one):**
- Patient profile / clinical info screens, guardian linking.
- Any diagnosis, assessment, or treatment screens.
- Any audio or video recording/upload.
- A second language (English).
- Push notifications, deep linking, offline support.
- Automated device/e2e testing (Detox/Maestro) — component-level tests only, see Testing below.

## Architecture

- **Framework**: Expo (managed workflow) + TypeScript + `expo-router` for file-based navigation. Chosen over bare React Native (loses Expo's cloud build/OTA tooling for no benefit here) and over Flutter (would introduce Dart with zero code/type sharing with the existing NestJS/TypeScript backend, for a one-person-plus-agent team where that shared mental model matters).
- **Why this matters practically**: the development machine is Windows, with no local Xcode. Expo Go gives live device preview (Android or iOS) without any native build step; Expo's EAS Build produces the actual iOS binary in the cloud when one is needed, without requiring a local Mac.
- **Repo layout**:
  ```
  mobile/
    app/                      (expo-router screens: file = route)
      index.tsx                (welcome)
      register/
        index.tsx               (self-or-child choice)
        form.tsx                (registration form)
        verify.tsx              (OTP entry)
      login.tsx
      forgot-password.tsx
      reset-password.tsx
      home.tsx                  (authenticated placeholder)
    src/
      api/
        client.ts                (fetch wrapper: base URL, auth header, error parsing)
        auth.ts                  (register/verify/login/forgotPassword/resetPassword calls)
      theme/
        tokens.ts                 (the three palettes: colors, radii, type scale)
        ThemeContext.tsx           (React context; defaults to 'adult'; exposes setAgeGroup for sub-project 2)
      storage/
        session.ts                 (expo-secure-store wrapper: saveToken/getToken/clearToken)
      copy/
        ar.ts                       (all screen strings in one place, Arabic only for now)
      components/
        (shared primitives: Button, TextField, OtpInput, ErrorBanner — themed via ThemeContext)
  ```
- **Server state**: TanStack Query (React Query) for the register/verify/login/forgot/reset mutations and the session-restore check. No heavier global state library — there is nothing else to manage yet at this stage.
- **Networking contract this sub-project actually consumes** (verified against the real running backend, not assumed):
  - `POST /auth/register` → `{ userId, devOtpCode? }` — `devOtpCode` is only present when the backend runs with `DEV_MODE=true`. **There is no SMS-delivery integration anywhere in this backend today** — production would have no way to deliver the real code. For now the app reads `devOtpCode` directly off the registration response (this only works against a dev-mode backend) and this limitation is called out explicitly, not hidden, in the screen's dev/demo build.
  - `POST /auth/verify` → `{ verified: true }` on success; on failure the backend returns a generic `{ code: 'UNAUTHORIZED', message: 'OTP verification failed: <REASON>' }` where `<REASON>` is one of `NOT_FOUND | EXPIRED | TOO_MANY_ATTEMPTS | INCORRECT_CODE`. The client parses `<REASON>` out of the message string (there is no structured field for it in the API today) to show the right guidance: wrong code (try again), expired (5-minute window, offer resend), too many attempts (temporary lockout, matches the backend's real 5-attempt cap).
  - `POST /auth/login` → `{ token, expiresAt, mustChangePassword }` on success, 401 on bad credentials/inactive account, 429 on the backend's real lockout (5 failed attempts, 15-minute lock).
  - `POST /auth/forgot-password`, `POST /auth/reset-password` — same OTP-reason-parsing approach as verify.
  - `mustChangePassword` is read from the login response; if `true`, this sub-project just displays a one-line notice on the home placeholder ("يجب تغيير كلمة السر") rather than building the change-password screen itself — that screen belongs to whichever later sub-project first needs a settings area, since forcing it here would mean building a whole settings screen just to host one field.
- **Auth state**: a thin `AuthProvider` wrapping the app, backed by the secure-storage token + a React Query-driven "whoami" placeholder (there is no `/auth/me` endpoint yet, so this sub-project's "restore session" step is: read the token, assume valid, and let a live request's 401 flip the app back to logged-out — documented above, not glossed over).

## Theming system

Three token sets (colors, corner-radius scale, base font sizes) matching the palettes previewed with the user: children (warm orange/amber, large rounded corners), teens (dark background, teal accent, medium radius), adults (light, muted blue, small radius — the default used everywhere in this sub-project). `ThemeContext` exposes `ageGroup: 'child' | 'teen' | 'adult'` (default `'adult'`) and a `setAgeGroup` setter that sub-project 2 will call once date of birth is known. Every shared component (`Button`, `TextField`, etc.) reads from this context rather than hardcoding colors, so switching the palette later needs no changes to screen code.

## Testing approach

Jest + `jest-expo` preset + `@testing-library/react-native`, targeting logic that can silently break without a visible crash: registration form validation (mobile number format, password length), the OTP resend countdown timer, the OTP-failure-reason parser, and theme token selection by age group. No device/simulator e2e automation (Detox/Maestro) in this sub-project — that's a meaningfully different investment (real emulators/devices, CI device farms) better justified once there's enough app to actually walk through end-to-end.

## Non-goals / explicitly deferred

- Patient profile, guardian linking, diagnosis, treatment screens (later sub-projects)
- Audio/video capture of any kind
- English localization
- Push notifications, deep linking, offline mode
- Device-level e2e test automation
- A real change-password screen (only a one-line notice when `mustChangePassword` is true)
- SMS delivery integration for OTP codes (backend gap, not a mobile-app concern, noted above for transparency)
