# Kalamy Backend — Foundation (Auth + Patient Profile)

## Setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL: `docker compose up -d`
3. Install dependencies: `npm install`
4. Generate the Prisma client and apply migrations: `npm run prisma:generate && npm run prisma:migrate`
5. Run the dev server: `npm run start:dev`

## Testing

- Unit tests: `npm test`
- Integration/e2e tests (requires Postgres running): `npm run test:e2e`

## API docs

With the dev server running, Swagger UI is at `http://localhost:3000/api/docs`.

## Scope

This is the foundation sub-project only: the `AUTH` and `PAT` (Patient Profile) modules from the Kalamy SRS. See `docs/superpowers/specs/2026-07-02-auth-patient-foundation-design.md` for the full design and `docs/superpowers/plans/2026-07-02-auth-patient-foundation.md` for the implementation plan. Assessment, Treatment Plan, Exercises, Sessions, Reports, and all frontends are separate, later sub-projects.
