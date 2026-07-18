# KALAMY — Operations Runbook

Practical guide for running, configuring, and operating the Kalamy platform. Written for whoever deploys and runs the pilot. Last updated 2026-07-18 (MVP readiness pass).

The platform is three apps in one repo:

| App | Path | Stack | Audience |
|---|---|---|---|
| Backend API | `backend/` | NestJS + Prisma + PostgreSQL | — |
| Staff web | `staff-web/` | Vite + React + Mantine (RTL Arabic) | Clinician / Supervisor / Admin |
| Mobile | `mobile/` | Expo + React Native (RTL Arabic) | Patient / Caregiver |

---

## 1. Prerequisites

- **Node.js 24** (CI uses 24; 22+ works locally).
- **PostgreSQL 14+** reachable via a connection string.
- For mobile: the **Expo** toolchain (`npx expo`) and, to ship to devices, an **Expo/EAS account** (see §8).

---

## 2. Backend — first run

```bash
cd backend
cp .env.example .env          # then edit .env (see §3)
npm ci
npx prisma generate
npx prisma migrate deploy     # applies all migrations to the DB in DATABASE_URL
npm run start:dev             # dev (watch) — or `npm run build && npm start` for prod
```

The API listens on `PORT` (default 3000). Health check: `GET /health` → 200.

### Production build
```bash
npm run build      # nest build -> dist/
npm start          # node dist/main.js
```

---

## 3. Backend environment variables (`backend/.env`)

See `backend/.env.example` for the annotated list. The ones that matter operationally:

| Var | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | Postgres connection string. |
| `PORT` | No | Default 3000. |
| `DEV_MODE` | **Keep `false` in prod** | `true` returns OTP codes in API responses (`devOtpCode`) for local testing. The app **refuses to boot** if `DEV_MODE=true` while `NODE_ENV=production` (see `boot-guard.ts`) — this is intentional. |
| `CORS_ALLOWED_ORIGINS` | **Yes in prod** | Comma-separated exact origins for the deployed staff-web and mobile-web. Defaults to localhost dev ports if unset. |
| `TRUST_PROXY` | **Yes if behind a proxy** | Set to the number of trusted proxy hops (e.g. `1` for a single nginx/ALB) so the per-IP rate limiter sees the real client IP. **Never set `true`** — the app rejects it (it would let clients spoof `X-Forwarded-For` and bypass rate limiting). See §5. |
| `SMTP_*` | **Yes for real users** | Email delivery of OTP codes. Without it, no real user can register or reset a password (see §4). |
| `WHATSAPP_*` | Optional | WhatsApp OTP delivery. Inert until both vars are set (see §4). |

---

## 4. OTP delivery (registration & password reset) — **read before pilot**

Registration and password reset both issue a 6-digit OTP. **The code is only useful if it actually reaches the user.** Delivery is handled by `OtpDeliveryService`, which tries channels in order and uses the first one that is configured and succeeds:

1. **WhatsApp** (`whatsapp`) — disabled unless `WHATSAPP_BUSINESS_API_TOKEN` **and** `WHATSAPP_PHONE_NUMBER_ID` are set. Requires a Meta WhatsApp Business Account (a manual setup only the business owner can do). Note: delivering an auth code to a brand-new user typically requires a **pre-approved WhatsApp authentication-message template**, created/approved in Meta Business Manager — the current code sends a free-form text message and has **not** been tested against the live API. Treat WhatsApp as "wired, needs finishing + testing" until proven on a real account.
2. **Email** (`email`) — enabled when `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` are set. **This is the channel that works today.** Any transactional SMTP account works (SendGrid / Postmark / SES SMTP interface, or a mailbox + app password). Set `SMTP_FROM` to a friendly Arabic sender, e.g. `كلامي <no-reply@yourdomain>`.

If **no** channel is configured/succeeds, the OTP is still generated and stored (a warning is logged) but never delivered — so the only way to complete registration would be `DEV_MODE=true` (dev only) or a direct DB lookup. **For the pilot: configure SMTP.** The mobile registration form collects an email (labelled "to receive your verification code") precisely so email delivery has a destination.

SMS was intentionally deferred (business decision, 2026-07-17); WhatsApp + email replace it for now.

---

## 5. Rate limiting

A global per-IP throttle (60 req/min) plus a stricter limit on auth-sensitive routes (login/register/verify/forgot/reset) protects against brute-force and OTP-spam. It is **disabled under automated tests** (`NODE_ENV=test`) so test setup isn't throttled.

It keys on `req.ip`. **Behind a reverse proxy you must set `TRUST_PROXY`** (§3) or every request looks like it comes from the proxy's single IP and the limit collapses into one shared bucket for all users.

---

## 6. Database bootstrapping — **the first admin & treatment levels**

Two things a fresh database does **not** have and that block the pilot until set up:

### 6a. The first ADMIN account
Self-service registration only creates `PATIENT` / `CAREGIVER` accounts. Staff accounts (`CLINICIAN`/`SUPERVISOR`/`ADMIN`) are created by an existing **ADMIN** via the staff-web admin panel. So the **very first admin must be inserted directly**:

1. Register a normal account (or insert a `User` row) with a known mobile + password.
2. Promote it in the DB:
   ```sql
   UPDATE "User" SET role = 'ADMIN', status = 'ACTIVE', "mustChangePassword" = false WHERE mobile = '<the mobile>';
   ```
3. Log into staff-web with it; create the real clinician/supervisor/admin accounts from there.

(This mirrors exactly how the e2e tests promote a user — there is no seeded admin.)

### 6b. Treatment levels
The patient training journey cannot start until at least one **Level** with a **published LevelVersion** exists — otherwise `POST /cycles/start` fails with *"No active level is configured"*. Levels are created by an ADMIN (permission `MANAGE_LEVELS`) via:
- `POST /api/v1/levels` (create a level)
- `POST /api/v1/levels/:levelId/versions` (add a version)
- `POST /api/v1/levels/:levelId/versions/:versionId/publish` (publish it)

The number of configured levels effectively bounds how far a patient can progress. Configure the full set of clinical levels from the protocol docs before onboarding real patients. **There is no seed script** — this is a deliberate manual clinical-setup step.

---

## 7. Staff-web

```bash
cd staff-web
npm ci
npm run dev        # dev server on :5173
# production:
npm run build      # tsc -b && vite build -> dist/  (static; serve behind any web server / CDN)
npm run preview    # preview the production build locally
```

Config: `VITE_API_BASE_URL` (build-time env) points at the backend, e.g. `VITE_API_BASE_URL=https://api.yourdomain`. Defaults to `http://localhost:3000`. Set it in the build environment (a `.env` file in `staff-web/` or CI env) — Vite inlines it at build time, so rebuild after changing it.

Tests: `npm test` (Vitest). Typecheck: `npx tsc -b`.

---

## 8. Mobile

```bash
cd mobile
npm ci
npm run web        # run in a browser on :8081 (used for quick verification)
npm run android    # Android device/emulator
npm run ios        # iOS simulator (macOS only)
```

Config: `EXPO_PUBLIC_API_BASE_URL` points at the backend (defaults to `http://localhost:3000`). For a device to reach a locally-running backend, use the host machine's LAN IP, not `localhost`.

Tests: `npm test` (Jest). The app is Arabic-only and forces RTL.

**Shipping to real devices** needs an Expo/EAS project (`npx eas init`, then `eas build`) — this requires an Expo account and is a business-owner setup step. Push notifications additionally require a real development build (they don't work in Expo Go or the web build) — deferred for the pilot.

---

## 9. Running the tests

```bash
# Backend
cd backend
npm test                                        # unit tests (mocks; fast; this is what CI runs)
npm run test:e2e                                # e2e tests (needs a real Postgres from DATABASE_URL)

# Staff-web
cd staff-web && npm test                        # Vitest
# Mobile
cd mobile && npm test                           # Jest
```

**Backend e2e caveat:** every e2e file truncates and re-seeds the shared database in `beforeEach`. **Never run two backend e2e processes against the same database at once** — they corrupt each other's fixtures and produce confusing phantom failures. Run one e2e invocation at a time. CI currently runs only the unit suites (`npm test`), not e2e (e2e needs a Postgres service container — a known gap to close later).

---

## 10. Deploy checklist (pilot)

- [ ] Postgres provisioned; `DATABASE_URL` set; `npx prisma migrate deploy` run.
- [ ] `DEV_MODE=false` (and `NODE_ENV=production`).
- [ ] `CORS_ALLOWED_ORIGINS` set to the real staff-web + mobile origins.
- [ ] `TRUST_PROXY` set to the correct hop count for your proxy.
- [ ] `SMTP_*` configured and a test OTP email actually received.
- [ ] First ADMIN promoted in the DB (§6a).
- [ ] Treatment levels created and published (§6b).
- [ ] Staff-web built with the production `VITE_API_BASE_URL` and served over HTTPS.
- [ ] Mobile built (web for now; native via EAS when ready) with production `EXPO_PUBLIC_API_BASE_URL`.
- [ ] A full smoke test: register a patient (receive the real OTP email) → clinician creates profile → assessment → plan → patient starts a cycle → records/submits a sample → clinician reviews.

---

## 11. Known deferred items (not blockers, tracked)

- **SMS** — deferred; replaced by email (+WhatsApp when finished).
- **Payments / subscriptions** — deferred to phase 2. Architecture is documented in `docs/superpowers/specs/2026-07-18-payments-ready-architecture.md` (provider-agnostic, ready for Stripe/Moyasar/HyperPay) but not built.
- **Unregistered-visitor analytics report** — deferred to phase 2 (needs an anonymous-analytics system that doesn't exist yet).
- **Push notifications** — needs an EAS build + device; deferred.
- **On-device iOS/Android QA** — not yet run; do at least one pass on a real device of each OS before real patients use the recording flow.
