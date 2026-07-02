# Kalamy Foundation (Auth + Patient Profile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally-runnable NestJS + PostgreSQL backend implementing the AUTH and Patient Profile (PAT) modules from the Kalamy SRS, with RBAC, audit logging, and mocked OTP, as the foundation later modules (Assessment, Plan, Exercises, Sessions, Reports) will build on.

**Architecture:** A single NestJS application (`backend/`) organized into feature modules (`auth`, `patients`) that mirror the SRS's own module taxonomy, plus a `common/` directory for cross-cutting concerns (RBAC guard, audit interceptor, error filter, security helpers) and a `prisma/` directory for the database schema. PostgreSQL runs in Docker; the API runs on the host via `npm run start:dev` for a fast dev loop.

**Tech Stack:** NestJS 11 (TypeScript), PostgreSQL 16 (Docker), Prisma 6.19.3 ORM, nestjs-zod 5 + Zod 4 for request validation, bcryptjs for password hashing, Jest for testing.

**Reference spec:** `docs/superpowers/specs/2026-07-02-auth-patient-foundation-design.md`

## Global Constraints

- All endpoints are under the `/api/v1` prefix (per SRS-005/006/MVP-001 endpoint tables).
- OTP codes are 6 digits, expire after 5 minutes, and allow a maximum of 5 attempts (SRS-005).
- Login lockout is 15 minutes after 5 consecutive failed attempts — **an assumption**, since the SRS specifies OTP lockout timing but not login lockout timing (see design doc "Source document notes").
- Passwords must be at least 8 characters (SRS screen spec SCR-002).
- Patient profiles are never hard-deleted — only `status: DISABLED` (SRS-006).
- A patient under 18 years old must have a guardian (`GuardianLink`) linked — enforced at profile-creation time in this implementation (see design doc; the SRS states the rule but not the exact workflow).
- Public self-registration (`POST /auth/register`) only allows the `PATIENT` and `CAREGIVER` roles — **an assumption**: staff roles (`CLINICIAN`, `SUPERVISOR`, `ADMIN`) are not self-service in these docs and provisioning them is out of scope for this plan.
- OTP codes are never sent via SMS in this phase. They are always logged server-side, and only included in the API response when the `DEV_MODE` environment variable is `"true"`.
- All mutating requests (POST/PUT/PATCH/DELETE) are audit-logged automatically via a global interceptor.
- Every new PostgreSQL-touching test is an integration test that runs against a real local Postgres (via Docker) — never mocked.

---

## File Structure

```
backend/
  docker-compose.yml
  .env.example
  .gitignore
  package.json
  tsconfig.json
  nest-cli.json
  prisma/
    schema.prisma
  src/
    main.ts
    app.module.ts
    app.controller.ts
    app.controller.spec.ts
    prisma/
      prisma.module.ts
      prisma.service.ts
    common/
      filters/
        all-exceptions.filter.ts
      rbac/
        permissions.ts
        permissions.guard.ts
        require-permission.decorator.ts
      auth/
        session.guard.ts
        current-user.decorator.ts
      security/
        password.service.ts
        password.service.spec.ts
        token-hash.util.ts
      audit/
        audit.interceptor.ts
    modules/
      auth/
        auth.module.ts
        auth.controller.ts
        auth.service.ts
        otp.service.ts
        otp.service.spec.ts
        dto/
          register.dto.ts
          verify-otp.dto.ts
          login.dto.ts
          forgot-password.dto.ts
          reset-password.dto.ts
      patients/
        patients.module.ts
        patients.controller.ts
        patients.service.ts
        patient-age.util.ts
        patient-age.util.spec.ts
        dto/
          create-patient.dto.ts
          update-patient.dto.ts
          link-guardian.dto.ts
  test/
    jest-e2e.json
    jest.setup.ts
    utils/
      test-app.ts
    auth.e2e-spec.ts
    patients.e2e-spec.ts
    smoke.e2e-spec.ts
```

---

### Task 1: Project scaffolding, Docker Compose, and health check

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/nest-cli.json`
- Create: `backend/.gitignore`
- Create: `backend/.env.example`
- Create: `backend/docker-compose.yml`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/app.controller.ts`
- Test: `backend/src/app.controller.spec.ts`

**Interfaces:**
- Produces: a running NestJS app skeleton on port 3000 (or `$PORT`) with `GET /health` returning `{ status: 'ok' }`. Every later task adds modules to `AppModule`.

- [ ] **Step 1: Create the backend directory and `package.json`**

```json
{
  "name": "kalamy-backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json --runInBand",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@nestjs/common": "^11.1.27",
    "@nestjs/config": "^4.0.4",
    "@nestjs/core": "^11.1.27",
    "@nestjs/platform-express": "^11.1.27",
    "@nestjs/swagger": "^11.4.5",
    "@prisma/client": "6.19.3",
    "bcryptjs": "^3.0.3",
    "dotenv": "^17.4.2",
    "nestjs-zod": "^5.4.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.23",
    "@nestjs/testing": "^11.1.27",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.4",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "prisma": "6.19.3",
    "supertest": "^6.3.4",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.6.2"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": true,
    "strictBindCallApply": false,
    "noFallthroughCasesInSwitch": false
  }
}
```

- [ ] **Step 3: Create `nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
*.log
coverage/
```

- [ ] **Step 5: Create `.env.example`**

```
DATABASE_URL="postgresql://kalamy:kalamy_dev_password@localhost:5432/kalamy?schema=public"
PORT=3000
DEV_MODE=true
```

Copy it to `.env` (not committed) so local runs and tests can read it:

```bash
cp .env.example .env
```

- [ ] **Step 6: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: kalamy
      POSTGRES_PASSWORD: kalamy_dev_password
      POSTGRES_DB: kalamy
    ports:
      - "5432:5432"
    volumes:
      - kalamy_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kalamy"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  kalamy_postgres_data:
```

Start it with `docker compose up -d` (requires Docker Desktop installed and running).

- [ ] **Step 7: Create `src/app.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 8: Write the failing test — `src/app.controller.spec.ts`**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it('returns ok status', () => {
    expect(controller.getHealth()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 9: Install dependencies**

Run: `cd backend && npm install`
Expected: installs without errors (no native build tools required — `bcryptjs` is pure JS).

- [ ] **Step 10: Run the test to verify it fails, then create `app.module.ts` and `main.ts`**

Run: `npm test`
Expected: FAIL — `Cannot find module './app.module'` or similar, since `app.module.ts`/`main.ts` don't exist yet. (The spec test itself only needs `app.controller.ts`, which does exist — if it passes already, skip to confirming with `npm test -- app.controller` and proceed; the point of this step is to confirm the test harness runs.)

Create `src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController],
})
export class AppModule {}
```

Create `src/main.ts`:

```typescript
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}
bootstrap();
```

- [ ] **Step 11: Run the unit test to verify it passes**

Run: `npm test`
Expected: PASS — 1 test suite, 1 test passed.

- [ ] **Step 12: Verify the app boots and the health check responds**

Run: `npm run start:dev` (in one terminal, leave running), then in another terminal:
`curl http://localhost:3000/health`
Expected: `{"status":"ok"}`. Stop the dev server (Ctrl+C) before continuing.

- [ ] **Step 13: Commit**

```bash
git add backend/
git commit -m "chore: scaffold NestJS backend with health check"
```

---

### Task 2: Prisma schema, PrismaService, and database connectivity test

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/prisma.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/jest-e2e.json`
- Create: `backend/test/jest.setup.ts`
- Create: `backend/test/utils/test-app.ts`
- Test: `backend/test/prisma.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppModule` from Task 1.
- Produces: `PrismaService` (injectable anywhere, since `PrismaModule` is `@Global()`), and `createTestApp()` / `resetDatabase()` helpers every later integration test uses.

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  PATIENT
  CAREGIVER
  CLINICIAN
  SUPERVISOR
  ADMIN
}

enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  LOCKED
  DISABLED
}

enum OtpPurpose {
  REGISTRATION
  PASSWORD_RESET
}

enum Gender {
  MALE
  FEMALE
}

enum PatientProfileStatus {
  ACTIVE
  DISABLED
}

model User {
  id                  String     @id @default(uuid())
  fullName            String
  email               String?    @unique
  mobile              String     @unique
  passwordHash        String
  role                Role
  status              UserStatus @default(PENDING_VERIFICATION)
  failedLoginAttempts Int        @default(0)
  lockedUntil         DateTime?
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt

  otpCodes                OtpCode[]
  sessions                Session[]
  auditLogs               AuditLog[]
  patientProfile          PatientProfile? @relation("PatientProfileUser")
  guardianLinksAsPatient  GuardianLink[]  @relation("GuardianLinkPatient")
  guardianLinksAsGuardian GuardianLink[]  @relation("GuardianLinkGuardian")
}

model OtpCode {
  id        String     @id @default(uuid())
  userId    String
  user      User       @relation(fields: [userId], references: [id])
  code      String
  purpose   OtpPurpose
  expiresAt DateTime
  attempts  Int        @default(0)
  consumed  Boolean    @default(false)
  createdAt DateTime   @default(now())

  @@index([userId, purpose, consumed])
}

model Session {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id])
  tokenHash  String    @unique
  deviceInfo String?
  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  revokedAt  DateTime?
}

model GuardianLink {
  id             String   @id @default(uuid())
  patientUserId  String
  patientUser    User     @relation("GuardianLinkPatient", fields: [patientUserId], references: [id])
  guardianUserId String
  guardianUser   User     @relation("GuardianLinkGuardian", fields: [guardianUserId], references: [id])
  relationship   String
  createdAt      DateTime @default(now())

  @@unique([patientUserId, guardianUserId])
}

model PatientProfile {
  id             String               @id @default(uuid())
  userId         String               @unique
  user           User                 @relation("PatientProfileUser", fields: [userId], references: [id])
  fullName       String
  gender         Gender
  dateOfBirth    DateTime
  nationalId     String               @unique
  address        String?
  referralSource String?
  status         PatientProfileStatus @default(ACTIVE)
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  clinicalInfo PatientClinicalInfo?
}

model PatientClinicalInfo {
  id               String         @id @default(uuid())
  patientProfileId String         @unique
  patientProfile   PatientProfile @relation(fields: [patientProfileId], references: [id])
  referralReason   String?
  initialDiagnosis String?
  medicalHistory   String?
  medications      String?
  allergies        String?
  familyHistory    String?
  consents         Json?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
}

model AuditLog {
  id        String   @id @default(uuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id])
  action    String
  entity    String
  entityId  String?
  before    Json?
  after     Json?
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: Create `src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 3: Create `src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 4: Modify `src/app.module.ts` to import `PrismaModule`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 5: Start Postgres and generate the Prisma client**

Run: `docker compose up -d`
Expected: `postgres` container starts and becomes healthy (`docker compose ps` shows `healthy`).

Run: `npm run prisma:generate`
Expected: "Generated Prisma Client" message, no errors.

Run: `npm run prisma:migrate -- --name init`
Expected: prompts for a migration name if not passed inline; creates `prisma/migrations/<timestamp>_init/migration.sql` and applies it. Expected output ends with "Your database is now in sync with your schema."

- [ ] **Step 6: Create the e2e test config — `test/jest-e2e.json`**

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "setupFiles": ["<rootDir>/jest.setup.ts"]
}
```

- [ ] **Step 7: Create `test/jest.setup.ts`**

```typescript
import 'dotenv/config';
```

- [ ] **Step 8: Create `test/utils/test-app.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const prisma = moduleRef.get(PrismaService);
  return { app, prisma };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.patientClinicalInfo.deleteMany(),
    prisma.patientProfile.deleteMany(),
    prisma.guardianLink.deleteMany(),
    prisma.session.deleteMany(),
    prisma.otpCode.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
```

- [ ] **Step 9: Write the failing test — `test/prisma.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Database connectivity', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('can create and read a User row', async () => {
    const user = await prisma.user.create({
      data: {
        fullName: 'Test User',
        mobile: '+966500000001',
        passwordHash: 'irrelevant-for-this-test',
        role: 'PATIENT',
      },
    });

    const found = await prisma.user.findUnique({ where: { id: user.id } });
    expect(found?.mobile).toBe('+966500000001');
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL if Postgres isn't running or the migration hasn't been applied yet (connection error). If Step 5 was completed correctly, this should actually PASS already — if so, this confirms the setup instead; note the result and continue.

- [ ] **Step 11: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — 1 test suite, 1 test passed.

- [ ] **Step 12: Commit**

```bash
git add backend/
git commit -m "feat: add Prisma schema and database connectivity"
```

---

### Task 3: Global error handling and Zod validation wiring

**Files:**
- Create: `backend/src/common/filters/all-exceptions.filter.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`
- Test: `backend/test/errors.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppModule`, `createTestApp()` from Task 2.
- Produces: every response body follows `{ code: string, message: string, details?: unknown }` on error. Every later DTO extends `createZodDto(...)` from `nestjs-zod` and is validated automatically — no controller needs to call validation manually.

- [ ] **Step 1: Create `src/common/filters/all-exceptions.filter.ts`**

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as { issues?: unknown };
      const body: ErrorBody = {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: zodError.issues,
      };
      response.status(HttpStatus.BAD_REQUEST).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: ErrorBody = {
        code: HttpStatus[status] ?? String(status),
        message: exception.message,
      };
      response.status(status).json(body);
      return;
    }

    const body: ErrorBody = { code: 'INTERNAL_ERROR', message: 'Unexpected error' };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
```

- [ ] **Step 2: Modify `src/app.module.ts` to register the filter and the Zod validation pipe globally**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {}
```

The Zod validation pipe can't be exercised end-to-end until a real DTO-validated endpoint exists (Task 6). For this task, prove the filter's `HttpException` branch using a route Nest generates for free: requesting an unknown path returns a 404 `HttpException`, which is enough to confirm the filter produces the `{ code, message }` shape correctly.

- [ ] **Step 3: Write the failing test — `test/errors.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

describe('Global error handling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a consistent error body for unknown routes', async () => {
    const response = await request(app.getHttpServer()).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: 'NOT_FOUND',
      message: 'Cannot GET /does-not-exist',
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — either the filter isn't wired yet or the body shape doesn't match (e.g. missing `code` field), until Step 2 is in place.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e test suites pass (including Task 2's `prisma.e2e-spec.ts`).

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add global exception filter and Zod validation pipe"
```

---

### Task 4: RBAC permission policy and guard

**Files:**
- Create: `backend/src/common/auth/authenticated-user.interface.ts`
- Create: `backend/src/common/rbac/permissions.ts`
- Create: `backend/src/common/rbac/require-permission.decorator.ts`
- Create: `backend/src/common/rbac/permissions.guard.ts`
- Test: `backend/src/common/rbac/permissions.spec.ts`

**Interfaces:**
- Consumes: `Role` enum from `@prisma/client` (Task 2).
- Produces: `Permission` enum, `hasPermission(role, permission): boolean`, `@RequirePermission(permission)` decorator, `PermissionsGuard`, and the shared `AuthenticatedUser` interface (`{ id, role, sessionId }`) — used by every protected endpoint from Task 6 onward. `SessionGuard` (Task 8) populates `request.user` with this same shape.

- [ ] **Step 1: Create `src/common/auth/authenticated-user.interface.ts`**

```typescript
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  role: Role;
  sessionId: string;
}
```

This is a standalone type with no other dependencies, shared by `PermissionsGuard` (this task) and `SessionGuard` (Task 8) so neither guard has to import from the other.

- [ ] **Step 2: Write the failing test — `src/common/rbac/permissions.spec.ts`**

```typescript
import { hasPermission, Permission } from './permissions';

describe('hasPermission', () => {
  it('allows a CLINICIAN to create a patient profile', () => {
    expect(hasPermission('CLINICIAN', Permission.CREATE_PATIENT_PROFILE)).toBe(true);
  });

  it('does not allow a PATIENT to create a patient profile', () => {
    expect(hasPermission('PATIENT', Permission.CREATE_PATIENT_PROFILE)).toBe(false);
  });

  it('allows a PATIENT to view a patient profile (ownership enforced elsewhere)', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_PATIENT_PROFILE)).toBe(true);
  });

  it('does not allow a SUPERVISOR to disable a patient profile', () => {
    expect(hasPermission('SUPERVISOR', Permission.DISABLE_PATIENT_PROFILE)).toBe(false);
  });

  it('allows an ADMIN to manage users', () => {
    expect(hasPermission('ADMIN', Permission.MANAGE_USERS)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- permissions`
Expected: FAIL — `Cannot find module './permissions'`.

- [ ] **Step 4: Create `src/common/rbac/permissions.ts`**

```typescript
import { Role } from '@prisma/client';

export enum Permission {
  CREATE_PATIENT_PROFILE = 'CREATE_PATIENT_PROFILE',
  VIEW_PATIENT_PROFILE = 'VIEW_PATIENT_PROFILE',
  EDIT_PATIENT_PROFILE = 'EDIT_PATIENT_PROFILE',
  DISABLE_PATIENT_PROFILE = 'DISABLE_PATIENT_PROFILE',
  LINK_GUARDIAN = 'LINK_GUARDIAN',
  SEARCH_PATIENTS = 'SEARCH_PATIENTS',
  MANAGE_USERS = 'MANAGE_USERS',
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PATIENT: [Permission.VIEW_PATIENT_PROFILE, Permission.EDIT_PATIENT_PROFILE],
  CAREGIVER: [Permission.VIEW_PATIENT_PROFILE, Permission.EDIT_PATIENT_PROFILE],
  CLINICIAN: [
    Permission.CREATE_PATIENT_PROFILE,
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.DISABLE_PATIENT_PROFILE,
    Permission.LINK_GUARDIAN,
    Permission.SEARCH_PATIENTS,
  ],
  SUPERVISOR: [Permission.VIEW_PATIENT_PROFILE, Permission.SEARCH_PATIENTS],
  ADMIN: [
    Permission.CREATE_PATIENT_PROFILE,
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.DISABLE_PATIENT_PROFILE,
    Permission.LINK_GUARDIAN,
    Permission.SEARCH_PATIENTS,
    Permission.MANAGE_USERS,
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- permissions`
Expected: PASS — 5 tests passed.

- [ ] **Step 6: Create `src/common/rbac/require-permission.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
```

- [ ] **Step 7: Create `src/common/rbac/permissions.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './require-permission.decorator';
import { hasPermission, Permission } from './permissions';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<Permission | undefined>(PERMISSION_KEY, context.getHandler());
    if (!required) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new ForbiddenException('No authenticated user on request');
    }
    if (!hasPermission(request.user.role, required)) {
      throw new ForbiddenException(`Role ${request.user.role} lacks permission ${required}`);
    }
    return true;
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: add RBAC permission policy and guard"
```

---

### Task 5: Password hashing and OTP domain logic

**Files:**
- Create: `backend/src/common/security/password.service.ts`
- Test: `backend/src/common/security/password.service.spec.ts`
- Create: `backend/src/modules/auth/otp.service.ts`
- Test: `backend/src/modules/auth/otp.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 2).
- Produces: `PasswordService.hash(plain): Promise<string>`, `PasswordService.compare(plain, hash): Promise<boolean>`; `OtpService.issue(userId, purpose): Promise<string>`, `OtpService.verify(userId, purpose, code): Promise<OtpCheckResult>` — used by `AuthService` from Task 6 onward.

- [ ] **Step 1: Write the failing test — `src/common/security/password.service.spec.ts`**

```typescript
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password and verifies it matches', async () => {
    const hash = await service.hash('correct-horse-battery-staple');
    expect(await service.compare('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct-horse-battery-staple');
    expect(await service.compare('wrong-password', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- password.service`
Expected: FAIL — `Cannot find module './password.service'`.

- [ ] **Step 3: Create `src/common/security/password.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- password.service`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Write the failing test — `src/modules/auth/otp.service.spec.ts`**

```typescript
import { OtpPurpose } from '@prisma/client';
import { OtpService } from './otp.service';

function makePrismaMock() {
  const otpCode = {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  return { otpCode } as any;
}

describe('OtpService', () => {
  it('issues a 6-digit code and stores it with a 5-minute expiry', async () => {
    const prisma = makePrismaMock();
    const service = new OtpService(prisma);

    const code = await service.issue('user-1', OtpPurpose.REGISTRATION);

    expect(code).toMatch(/^\d{6}$/);
    expect(prisma.otpCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', purpose: OtpPurpose.REGISTRATION, code }),
      }),
    );
  });

  it('fails verification when no OTP exists', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue(null);
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '123456');

    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('fails verification when the OTP has expired', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      attempts: 0,
      expiresAt: new Date(Date.now() - 1000),
    });
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '123456');

    expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('fails verification after 5 attempts', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      attempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '123456');

    expect(result).toEqual({ ok: false, reason: 'TOO_MANY_ATTEMPTS' });
  });

  it('increments attempts and fails on an incorrect code', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '000000');

    expect(result).toEqual({ ok: false, reason: 'INCORRECT_CODE' });
    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { attempts: { increment: 1 } },
    });
  });

  it('succeeds and consumes the OTP on a correct code', async () => {
    const prisma = makePrismaMock();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new OtpService(prisma);

    const result = await service.verify('user-1', OtpPurpose.REGISTRATION, '123456');

    expect(result).toEqual({ ok: true });
    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { consumed: true },
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- otp.service`
Expected: FAIL — `Cannot find module './otp.service'`.

- [ ] **Step 7: Create `src/modules/auth/otp.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

export type OtpCheckResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INCORRECT_CODE' };

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  async issue(userId: string, purpose: OtpPurpose): Promise<string> {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
    await this.prisma.otpCode.create({
      data: { userId, purpose, code, expiresAt },
    });
    return code;
  }

  async verify(userId: string, purpose: OtpPurpose, submittedCode: string): Promise<OtpCheckResult> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumed: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (otp.expiresAt < new Date()) {
      return { ok: false, reason: 'EXPIRED' };
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
    }
    if (otp.code !== submittedCode) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, reason: 'INCORRECT_CODE' };
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumed: true },
    });
    return { ok: true };
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- otp.service`
Expected: PASS — 6 tests passed.

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat: add password hashing and OTP domain logic"
```

---

### Task 6: Auth — registration and OTP verification endpoints

**Files:**
- Create: `backend/src/modules/auth/dto/register.dto.ts`
- Create: `backend/src/modules/auth/dto/verify-otp.dto.ts`
- Create: `backend/src/modules/auth/auth.service.ts`
- Create: `backend/src/modules/auth/auth.controller.ts`
- Create: `backend/src/modules/auth/auth.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 2), `PermissionsGuard`/`Permission` (Task 4 — not used by these two endpoints, which are public), `PasswordService`, `OtpService` (Task 5).
- Produces: `POST /api/v1/auth/register`, `POST /api/v1/auth/verify`. `AuthService` and `AuthModule` are extended by every later Auth task.

- [ ] **Step 1: Create `src/modules/auth/dto/register.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RegisterSchema = z.object({
  fullName: z.string().min(1).max(100),
  mobile: z.string().regex(/^\+?[0-9]{9,15}$/, 'Invalid mobile number'),
  email: z.email().optional(),
  password: z.string().min(8),
  role: z.enum(['PATIENT', 'CAREGIVER']),
});

export class RegisterDto extends createZodDto(RegisterSchema) {}
```

- [ ] **Step 2: Create `src/modules/auth/dto/verify-otp.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const VerifyOtpSchema = z.object({
  mobile: z.string().min(1),
  code: z.string().length(6),
});

export class VerifyOtpDto extends createZodDto(VerifyOtpSchema) {}
```

- [ ] **Step 3: Create `src/modules/auth/auth.service.ts`**

```typescript
import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from './otp.service';
import { PasswordService } from '../../common/security/password.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string; devOtpCode?: string }> {
    const existing = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (existing) {
      throw new ConflictException('Mobile number already registered');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        mobile: dto.mobile,
        email: dto.email,
        passwordHash,
        role: dto.role,
        status: UserStatus.PENDING_VERIFICATION,
      },
    });

    const code = await this.otpService.issue(user.id, OtpPurpose.REGISTRATION);

    return {
      userId: user.id,
      devOtpCode: process.env.DEV_MODE === 'true' ? code : undefined,
    };
  }

  async verifyRegistration(dto: VerifyOtpDto): Promise<{ verified: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const result = await this.otpService.verify(user.id, OtpPurpose.REGISTRATION, dto.code);
    if (!result.ok) {
      throw new UnauthorizedException(`OTP verification failed: ${result.reason}`);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.ACTIVE },
    });
    return { verified: true };
  }
}
```

- [ ] **Step 4: Create `src/modules/auth/auth.controller.ts`**

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify')
  verify(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyRegistration(dto);
  }
}
```

- [ ] **Step 5: Create `src/modules/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordService } from '../../common/security/password.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, OtpService, PasswordService],
  exports: [PasswordService],
})
export class AuthModule {}
```

- [ ] **Step 6: Modify `src/app.module.ts` to import `AuthModule`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Write the failing test — `test/auth.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth: register + verify', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('registers a new patient and returns the OTP in dev mode', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Fatimah Al-Otaibi',
      mobile: '+966500000010',
      password: 'password123',
      role: 'PATIENT',
    });

    expect(response.status).toBe(201);
    expect(response.body.userId).toBeDefined();
    expect(response.body.devOtpCode).toMatch(/^\d{6}$/);

    const user = await prisma.user.findUnique({ where: { mobile: '+966500000010' } });
    expect(user?.status).toBe('PENDING_VERIFICATION');
  });

  it('rejects registration with a duplicate mobile number', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'First User',
      mobile: '+966500000011',
      password: 'password123',
      role: 'PATIENT',
    });

    const response = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Second User',
      mobile: '+966500000011',
      password: 'password456',
      role: 'CAREGIVER',
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('rejects registration with a role other than PATIENT or CAREGIVER', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Sneaky Admin',
      mobile: '+966500000012',
      password: 'password123',
      role: 'ADMIN',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('activates the user when the correct OTP is submitted', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Fatimah Al-Otaibi',
      mobile: '+966500000013',
      password: 'password123',
      role: 'PATIENT',
    });
    const code = registerResponse.body.devOtpCode;

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000013', code });

    expect(verifyResponse.status).toBe(201);
    expect(verifyResponse.body).toEqual({ verified: true });

    const user = await prisma.user.findUnique({ where: { mobile: '+966500000013' } });
    expect(user?.status).toBe('ACTIVE');
  });

  it('rejects an incorrect OTP', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Fatimah Al-Otaibi',
      mobile: '+966500000014',
      password: 'password123',
      role: 'PATIENT',
    });

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000014', code: '000000' });

    expect(verifyResponse.status).toBe(401);
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — routes don't exist yet, or (if Steps 1-6 were already done) some assertion mismatch. Confirm failure relates to the new suite, not a regression in earlier suites.

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 5 new tests in `auth.e2e-spec.ts`.

- [ ] **Step 10: Commit**

```bash
git add backend/
git commit -m "feat: add registration and OTP verification endpoints"
```

---

### Task 7: Auth — login endpoint with lockout

**Files:**
- Create: `backend/src/common/security/token-hash.util.ts`
- Create: `backend/src/modules/auth/dto/login.dto.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthService`, `PrismaService` from earlier tasks.
- Produces: `POST /api/v1/auth/login` returning `{ token: string, expiresAt: string }`; `generateSessionToken()` and `hashToken(token)` utilities reused by Task 8.

- [ ] **Step 1: Create `src/common/security/token-hash.util.ts`**

```typescript
import { createHash, randomBytes } from 'crypto';

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

- [ ] **Step 2: Create `src/modules/auth/dto/login.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LoginSchema = z.object({
  mobile: z.string().min(1),
  password: z.string().min(1),
});

export class LoginDto extends createZodDto(LoginSchema) {}
```

- [ ] **Step 3: Append test cases to `test/auth.e2e-spec.ts`** — add this `describe` block after the existing one, before the final closing of the file:

```typescript
describe('Auth: login', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function registerAndActivate(mobile: string, password: string) {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
  }

  it('logs in with correct credentials and returns a session token', async () => {
    await registerAndActivate('+966500000020', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000020', password: 'password123' });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');
    expect(response.body.token.length).toBeGreaterThan(20);

    const sessionCount = await prisma.session.count();
    expect(sessionCount).toBe(1);
  });

  it('rejects an incorrect password without revealing the reason precisely', async () => {
    await registerAndActivate('+966500000021', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000021', password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('locks the account after 5 failed attempts', async () => {
    await registerAndActivate('+966500000022', 'password123');

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ mobile: '+966500000022', password: 'wrong-password' });
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000022', password: 'password123' });

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/locked/i);
  });

  it('rejects login for a user who has not verified OTP yet', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Unverified User',
      mobile: '+966500000023',
      password: 'password123',
      role: 'PATIENT',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000023', password: 'password123' });

    expect(response.status).toBe(401);
  });
});
```

Add `import { INestApplication } from '@nestjs/common';`, `import request from 'supertest';`, `import { PrismaService } from '../src/prisma/prisma.service';`, and `import { createTestApp, resetDatabase } from './utils/test-app';` to the top of the file if not already present (they are, from Task 6 — reuse them).

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `POST /api/v1/auth/login` returns 404, since the endpoint doesn't exist yet.

- [ ] **Step 5: Modify `src/modules/auth/auth.service.ts`** — replace the entire file with:

```typescript
import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from './otp.service';
import { PasswordService } from '../../common/security/password.service';
import { generateSessionToken, hashToken } from '../../common/security/token-hash.util';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;
const SESSION_TTL_HOURS = 24;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string; devOtpCode?: string }> {
    const existing = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (existing) {
      throw new ConflictException('Mobile number already registered');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        mobile: dto.mobile,
        email: dto.email,
        passwordHash,
        role: dto.role,
        status: UserStatus.PENDING_VERIFICATION,
      },
    });

    const code = await this.otpService.issue(user.id, OtpPurpose.REGISTRATION);

    return {
      userId: user.id,
      devOtpCode: process.env.DEV_MODE === 'true' ? code : undefined,
    };
  }

  async verifyRegistration(dto: VerifyOtpDto): Promise<{ verified: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const result = await this.otpService.verify(user.id, OtpPurpose.REGISTRATION, dto.code);
    if (!result.ok) {
      throw new UnauthorizedException(`OTP verification failed: ${result.reason}`);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.ACTIVE },
    });
    return { verified: true };
  }

  async login(dto: LoginDto, deviceInfo?: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    const passwordMatches = await this.passwordService.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= LOGIN_MAX_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60_000);
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        deviceInfo,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }
}
```

- [ ] **Step 6: Modify `src/modules/auth/auth.controller.ts`** — replace the entire file with:

```typescript
import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify')
  verify(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyRegistration(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, userAgent);
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 4 new login tests.

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: add login endpoint with lockout"
```

---

### Task 8: Session auth guard and session lifecycle endpoints

**Files:**
- Create: `backend/src/common/auth/session.guard.ts`
- Create: `backend/src/common/auth/current-user.decorator.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/modules/auth/auth.module.ts`
- Modify: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `hashToken` (Task 7), `AuthenticatedUser` interface (Task 4).
- Produces: `SessionGuard` (`CanActivate`, populates `request.user: AuthenticatedUser`), `@CurrentUser()` decorator, `POST /api/v1/auth/logout`, `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:id`. `SessionGuard` and `@CurrentUser()` are reused by every protected endpoint in the Patients module (Tasks 11-14).

- [ ] **Step 1: Create `src/common/auth/session.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from '../security/token-hash.util';
import { AuthenticatedUser } from './authenticated-user.interface';

export type { AuthenticatedUser } from './authenticated-user.interface';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    const tokenHash = hashToken(token);

    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    request.user = { id: session.user.id, role: session.user.role, sessionId: session.id };
    return true;
  }
}
```

- [ ] **Step 2: Create `src/common/auth/current-user.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from './session.guard';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
```

- [ ] **Step 3: Append test cases to `test/auth.e2e-spec.ts`** — add this `describe` block:

```typescript
describe('Auth: session lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function registerActivateAndLogin(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('rejects requests with no bearer token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/sessions');
    expect(response.status).toBe(401);
  });

  it('lists the active session after login', async () => {
    const token = await registerActivateAndLogin('+966500000030', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('revokes a session so it can no longer authenticate', async () => {
    const token = await registerActivateAndLogin('+966500000031', 'password123');
    const sessionsResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    const sessionId = sessionsResponse.body[0].id;

    const revokeResponse = await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revokeResponse.status).toBe(204);

    const afterRevoke = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(afterRevoke.status).toBe(401);
  });

  it('logs out and invalidates the current session', async () => {
    const token = await registerActivateAndLogin('+966500000032', 'password123');

    const logoutResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logoutResponse.status).toBe(204);

    const afterLogout = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `POST /api/v1/auth/logout`, `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:id` all return 404.

- [ ] **Step 5: Modify `src/modules/auth/auth.service.ts`** — add these three methods to the `AuthService` class, immediately before the closing `}` of the class (after the `login` method):

```typescript
  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async listSessions(
    userId: string,
  ): Promise<Array<{ id: string; deviceInfo: string | null; createdAt: Date; expiresAt: Date }>> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }
```

- [ ] **Step 6: Modify `src/modules/auth/auth.controller.ts`** — replace the entire file with:

```typescript
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify')
  verify(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyRegistration(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, userAgent);
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logout(user.sessionId);
  }

  @Get('sessions')
  @UseGuards(SessionGuard)
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async revokeSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.revokeSession(user.id, id);
  }
}
```

- [ ] **Step 7: Modify `src/modules/auth/auth.module.ts`** — replace the entire file with:

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordService } from '../../common/security/password.service';
import { SessionGuard } from '../../common/auth/session.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, OtpService, PasswordService, SessionGuard],
  exports: [PasswordService, SessionGuard],
})
export class AuthModule {}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 4 new session lifecycle tests.

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat: add session guard and session lifecycle endpoints"
```

---

### Task 9: Auth — forgot-password and reset-password

**Files:**
- Create: `backend/src/modules/auth/dto/forgot-password.dto.ts`
- Create: `backend/src/modules/auth/dto/reset-password.dto.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthService`, `OtpService`, `PasswordService` from earlier tasks.
- Produces: `POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/reset-password`.

- [ ] **Step 1: Create `src/modules/auth/dto/forgot-password.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ForgotPasswordSchema = z.object({
  mobile: z.string().min(1),
});

export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}
```

- [ ] **Step 2: Create `src/modules/auth/dto/reset-password.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ResetPasswordSchema = z.object({
  mobile: z.string().min(1),
  code: z.string().length(6),
  newPassword: z.string().min(8),
});

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
```

- [ ] **Step 3: Append test cases to `test/auth.e2e-spec.ts`**

```typescript
describe('Auth: password reset', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function registerAndActivate(mobile: string, password: string) {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test Patient',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
  }

  it('does not reveal whether a mobile number is registered', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ mobile: '+966500000099' });

    expect(response.status).toBe(200);
    expect(response.body.devOtpCode).toBeUndefined();
  });

  it('resets the password with a valid OTP and invalidates existing sessions', async () => {
    await registerAndActivate('+966500000040', 'old-password1');
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000040', password: 'old-password1' });
    const oldToken = loginResponse.body.token;

    const forgotResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ mobile: '+966500000040' });
    const code = forgotResponse.body.devOtpCode;

    const resetResponse = await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({
      mobile: '+966500000040',
      code,
      newPassword: 'new-password2',
    });
    expect(resetResponse.status).toBe(200);

    const oldSessionCheck = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(oldSessionCheck.status).toBe(401);

    const loginWithNewPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000040', password: 'new-password2' });
    expect(loginWithNewPassword.status).toBe(200);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password` return 404.

- [ ] **Step 5: Modify `src/modules/auth/auth.service.ts`** — add these two methods to the `AuthService` class, immediately before the closing `}` (after `revokeSession`). Also add the two new DTO imports at the top of the file.

Add to imports:

```typescript
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
```

Add to the class:

```typescript
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ devOtpCode?: string }> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      // Deliberately do not reveal whether the mobile number is registered.
      return {};
    }
    const code = await this.otpService.issue(user.id, OtpPurpose.PASSWORD_RESET);
    return { devOtpCode: process.env.DEV_MODE === 'true' ? code : undefined };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const result = await this.otpService.verify(user.id, OtpPurpose.PASSWORD_RESET, dto.code);
    if (!result.ok) {
      throw new UnauthorizedException(`OTP verification failed: ${result.reason}`);
    }
    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
```

- [ ] **Step 6: Modify `src/modules/auth/auth.controller.ts`** — add the two DTO imports and two endpoints:

Add to imports:

```typescript
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
```

Add to the class, after `login`:

```typescript
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ reset: true }> {
    await this.authService.resetPassword(dto);
    return { reset: true };
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 2 new password reset tests.

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: add forgot-password and reset-password endpoints"
```

---

### Task 10: Audit logging interceptor

**Files:**
- Create: `backend/src/common/audit/audit.interceptor.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/audit.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 2), `AuthenticatedUser` (Task 8).
- Produces: every mutating request creates an `AuditLog` row automatically.

- [ ] **Step 1: Create `src/common/audit/audit.interceptor.ts`**

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/session.guard';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface AuditableRequest {
  method: string;
  url: string;
  user?: AuthenticatedUser;
  body: unknown;
}

// "before" stores the request payload (what was asked for), "after" stores the
// resulting response body (what actually happened) — not a database pre/post diff.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditableRequest>();

    if (!MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((responseBody) => {
        this.prisma.auditLog
          .create({
            data: {
              userId: request.user?.id,
              action: `${request.method} ${request.url}`,
              entity: request.url.split('/')[3] ?? 'unknown',
              entityId: this.extractEntityId(responseBody),
              before: this.toJson(request.body),
              after: this.toJson(responseBody),
            },
          })
          .catch(() => undefined);
      }),
    );
  }

  private extractEntityId(body: unknown): string | undefined {
    if (body && typeof body === 'object' && 'id' in body) {
      return String((body as { id: unknown }).id);
    }
    if (body && typeof body === 'object' && 'userId' in body) {
      return String((body as { userId: unknown }).userId);
    }
    return undefined;
  }

  private toJson(body: unknown): unknown {
    return body ? JSON.parse(JSON.stringify(body)) : undefined;
  }
}
```

- [ ] **Step 2: Modify `src/app.module.ts`** — replace the entire file with:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Write the failing test — `test/audit.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Audit logging', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('does not log a GET request', async () => {
    await request(app.getHttpServer()).get('/health');
    const count = await prisma.auditLog.count();
    expect(count).toBe(0);
  });

  it('logs a registration as a mutating request', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Audit Test User',
      mobile: '+966500000050',
      password: 'password123',
      role: 'PATIENT',
    });

    const logs = await prisma.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('POST /api/v1/auth/register');
    expect(logs[0].entity).toBe('auth');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `auditLog.count()` is 1 (or an error) instead of 0 for the GET case, or 0 instead of 1 for the POST case, since the interceptor isn't wired yet.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 2 new audit tests.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add global audit logging interceptor"
```

---

### Task 11: Patients — create profile (with guardian-at-creation rule)

**Files:**
- Create: `backend/src/modules/patients/patient-age.util.ts`
- Test: `backend/src/modules/patients/patient-age.util.spec.ts`
- Create: `backend/src/modules/patients/dto/create-patient.dto.ts`
- Create: `backend/src/modules/patients/patients.service.ts`
- Create: `backend/src/modules/patients/patients.controller.ts`
- Create: `backend/src/modules/patients/patients.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/patients.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `SessionGuard`, `CurrentUser`, `PermissionsGuard`, `RequirePermission`, `Permission` from earlier tasks.
- Produces: `POST /api/v1/patients`; `PatientsService` and `PatientsModule` extended by Tasks 12-14; `calculateAge()` reused nowhere else but documented here for clarity.

- [ ] **Step 1: Write the failing test — `src/modules/patients/patient-age.util.spec.ts`**

```typescript
import { calculateAge } from './patient-age.util';

describe('calculateAge', () => {
  it('calculates age when the birthday has already passed this year', () => {
    const dob = new Date('2010-01-15');
    const now = new Date('2026-06-01');
    expect(calculateAge(dob, now)).toBe(16);
  });

  it('calculates age when the birthday has not happened yet this year', () => {
    const dob = new Date('2010-12-15');
    const now = new Date('2026-06-01');
    expect(calculateAge(dob, now)).toBe(15);
  });

  it('calculates age correctly on the exact birthday', () => {
    const dob = new Date('2010-06-01');
    const now = new Date('2026-06-01');
    expect(calculateAge(dob, now)).toBe(16);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- patient-age`
Expected: FAIL — `Cannot find module './patient-age.util'`.

- [ ] **Step 3: Create `src/modules/patients/patient-age.util.ts`**

```typescript
export function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = now.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- patient-age`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Create `src/modules/patients/dto/create-patient.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreatePatientSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().min(1).max(100),
  gender: z.enum(['MALE', 'FEMALE']),
  dateOfBirth: z.iso.date(),
  nationalId: z.string().min(5).max(20),
  address: z.string().optional(),
  referralSource: z.string().optional(),
  guardianUserId: z.uuid().optional(),
  clinicalInfo: z
    .object({
      referralReason: z.string().optional(),
      initialDiagnosis: z.string().optional(),
      medicalHistory: z.string().optional(),
      medications: z.string().optional(),
      allergies: z.string().optional(),
      familyHistory: z.string().optional(),
    })
    .optional(),
});

export class CreatePatientDto extends createZodDto(CreatePatientSchema) {}
```

- [ ] **Step 6: Create `src/modules/patients/patients.service.ts`**

```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { calculateAge } from './patient-age.util';
import { CreatePatientDto } from './dto/create-patient.dto';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePatientDto): Promise<PatientProfile> {
    const targetUser = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const existingProfile = await this.prisma.patientProfile.findUnique({ where: { userId: dto.userId } });
    if (existingProfile) {
      throw new ConflictException('Patient profile already exists for this user');
    }

    const existingNationalId = await this.prisma.patientProfile.findUnique({
      where: { nationalId: dto.nationalId },
    });
    if (existingNationalId) {
      throw new ConflictException('National ID already registered');
    }

    const dateOfBirth = new Date(dto.dateOfBirth);
    const age = calculateAge(dateOfBirth);
    if (age < 18 && !dto.guardianUserId) {
      throw new BadRequestException('Patients under 18 require guardianUserId at creation time');
    }

    if (dto.guardianUserId) {
      const guardian = await this.prisma.user.findUnique({ where: { id: dto.guardianUserId } });
      if (!guardian || guardian.role !== Role.CAREGIVER) {
        throw new BadRequestException('guardianUserId must reference an existing user with role CAREGIVER');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.patientProfile.create({
        data: {
          userId: dto.userId,
          fullName: dto.fullName,
          gender: dto.gender,
          dateOfBirth,
          nationalId: dto.nationalId,
          address: dto.address,
          referralSource: dto.referralSource,
          clinicalInfo: dto.clinicalInfo ? { create: dto.clinicalInfo } : undefined,
        },
        include: { clinicalInfo: true },
      });

      if (dto.guardianUserId) {
        await tx.guardianLink.create({
          data: {
            patientUserId: dto.userId,
            guardianUserId: dto.guardianUserId,
            relationship: 'GUARDIAN',
          },
        });
      }

      return created;
    });
  }
}
```

- [ ] **Step 7: Create `src/modules/patients/patients.controller.ts`**

```typescript
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients')
@UseGuards(SessionGuard, PermissionsGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @RequirePermission(Permission.CREATE_PATIENT_PROFILE)
  create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }
}
```

- [ ] **Step 8: Create `src/modules/patients/patients.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PatientsController],
  providers: [PatientsService],
})
export class PatientsModule {}
```

- [ ] **Step 9: Modify `src/app.module.ts`** — add `PatientsModule` to imports:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, PatientsModule],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

- [ ] **Step 10: Write the failing test — `test/patients.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Patients: create profile', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function createActiveUser(mobile: string, role: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN') {
    const passwordHash = '$2a$10$abcdefghijklmnopqrstuv'; // not used for login in these tests
    return prisma.user.create({
      data: { fullName: 'Seed User', mobile, passwordHash, role, status: 'ACTIVE' },
    });
  }

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
  }

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN') {
    if (role === 'CLINICIAN') {
      // Clinicians can't self-register (Task 6 restricts /register to PATIENT/CAREGIVER),
      // so seed one directly with a real password hash via the register+verify flow's hashing,
      // by registering as PATIENT then promoting the row for test purposes.
      const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
        fullName: 'Clinician User',
        mobile,
        password,
        role: 'PATIENT',
      });
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify')
        .send({ mobile, code: registerResponse.body.devOtpCode });
      await prisma.user.update({ where: { mobile }, data: { role: 'CLINICIAN' } });
      return loginAs(mobile, password);
    }

    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test User',
      mobile,
      password,
      role,
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    return loginAs(mobile, password);
  }

  it('lets a CLINICIAN create an adult patient profile', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000060', 'password123', 'CLINICIAN');
    const patientUser = await createActiveUser('+966500000061', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientUser.id,
        fullName: 'Adult Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: '1234567890',
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACTIVE');
  });

  it('rejects a PATIENT trying to create a profile', async () => {
    const patientToken = await registerActivateAndLogin('+966500000062', 'password123', 'PATIENT');
    const targetUser = await createActiveUser('+966500000063', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        userId: targetUser.id,
        fullName: 'Some Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: '1234567891',
      });

    expect(response.status).toBe(403);
  });

  it('rejects creating a minor profile without a guardianUserId', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000064', 'password123', 'CLINICIAN');
    const minorUser = await createActiveUser('+966500000065', 'PATIENT');

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minorUser.id,
        fullName: 'Minor Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: '1234567892',
      });

    expect(response.status).toBe(400);
  });

  it('creates a minor profile with a guardian atomically when guardianUserId is provided', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000066', 'password123', 'CLINICIAN');
    const minorUser = await createActiveUser('+966500000067', 'PATIENT');
    const guardianUser = await createActiveUser('+966500000068', 'CAREGIVER');

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minorUser.id,
        fullName: 'Minor Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: '1234567893',
        guardianUserId: guardianUser.id,
      });

    expect(response.status).toBe(201);

    const link = await prisma.guardianLink.findFirst({
      where: { patientUserId: minorUser.id, guardianUserId: guardianUser.id },
    });
    expect(link).not.toBeNull();
  });

  it('rejects a duplicate national ID', async () => {
    const clinicianToken = await registerActivateAndLogin('+966500000069', 'password123', 'CLINICIAN');
    const firstPatient = await createActiveUser('+966500000070', 'PATIENT');
    const secondPatient = await createActiveUser('+966500000071', 'PATIENT');

    await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: firstPatient.id,
        fullName: 'First Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'DUPLICATE-ID',
      });

    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: secondPatient.id,
        fullName: 'Second Patient',
        gender: 'MALE',
        dateOfBirth: '1991-05-01',
        nationalId: 'DUPLICATE-ID',
      });

    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `POST /api/v1/patients` returns 404, since the module doesn't exist yet.

- [ ] **Step 12: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 5 new patient-creation tests.

- [ ] **Step 13: Commit**

```bash
git add backend/
git commit -m "feat: add patient profile creation with guardian rule for minors"
```

---

### Task 12: Patients — get and update profile (ownership enforcement)

**Files:**
- Create: `backend/src/modules/patients/dto/update-patient.dto.ts`
- Modify: `backend/src/modules/patients/patients.service.ts`
- Modify: `backend/src/modules/patients/patients.controller.ts`
- Modify: `backend/test/patients.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientsService`, `CurrentUser`, `AuthenticatedUser` from earlier tasks.
- Produces: `GET /api/v1/patients/:id`, `PUT /api/v1/patients/:id`, with ownership rules: `PATIENT` may only access their own profile; `CAREGIVER` only a profile they're guardian-linked to; `CLINICIAN`/`SUPERVISOR`/`ADMIN` may access any.

- [ ] **Step 1: Create `src/modules/patients/dto/update-patient.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdatePatientSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  address: z.string().optional(),
  referralSource: z.string().optional(),
});

export class UpdatePatientDto extends createZodDto(UpdatePatientSchema) {}
```

- [ ] **Step 2: Append test cases to `test/patients.e2e-spec.ts`**

```typescript
describe('Patients: get and update profile', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
  }

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER') {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test User',
      mobile,
      password,
      role,
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

  async function createClinicianToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'CLINICIAN' } });
    return loginAs(mobile, password);
  }

  it('lets a patient view their own profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000080', 'password123');
    const patient = await registerActivateAndLogin('+966500000081', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Own Profile Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'OWN-PROFILE-1',
      });
    const profileId = createResponse.body.id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${patient.token}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(profileId);
  });

  it('forbids a patient from viewing another patient\'s profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000082', 'password123');
    const owner = await registerActivateAndLogin('+966500000083', 'password123', 'PATIENT');
    const stranger = await registerActivateAndLogin('+966500000084', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: owner.userId,
        fullName: 'Owner Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'OWN-PROFILE-2',
      });
    const profileId = createResponse.body.id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${stranger.token}`);

    expect(response.status).toBe(403);
  });

  it('lets a linked caregiver view and update the patient profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000085', 'password123');
    const minor = await registerActivateAndLogin('+966500000086', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000087', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minor.userId,
        fullName: 'Minor Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: 'MINOR-PROFILE-1',
        guardianUserId: guardian.userId,
      });
    const profileId = createResponse.body.id;

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${guardian.token}`);
    expect(getResponse.status).toBe(200);

    const updateResponse = await request(app.getHttpServer())
      .put(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${guardian.token}`)
      .send({ address: 'Riyadh, Saudi Arabia' });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.address).toBe('Riyadh, Saudi Arabia');
  });

  it('forbids an unlinked caregiver from viewing the profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000088', 'password123');
    const minor = await registerActivateAndLogin('+966500000089', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000090', 'password123', 'CAREGIVER');
    const unrelatedCaregiver = await registerActivateAndLogin('+966500000091', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: minor.userId,
        fullName: 'Minor Patient',
        gender: 'FEMALE',
        dateOfBirth: '2015-05-01',
        nationalId: 'MINOR-PROFILE-2',
        guardianUserId: guardian.userId,
      });
    const profileId = createResponse.body.id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${unrelatedCaregiver.token}`);

    expect(response.status).toBe(403);
  });

  it('returns 404 for a non-existent profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000092', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `GET /api/v1/patients/:id` and `PUT /api/v1/patients/:id` return 404 (route not found).

- [ ] **Step 4: Modify `src/modules/patients/patients.service.ts`** — replace the entire file with:

```typescript
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { calculateAge } from './patient-age.util';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePatientDto): Promise<PatientProfile> {
    const targetUser = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const existingProfile = await this.prisma.patientProfile.findUnique({ where: { userId: dto.userId } });
    if (existingProfile) {
      throw new ConflictException('Patient profile already exists for this user');
    }

    const existingNationalId = await this.prisma.patientProfile.findUnique({
      where: { nationalId: dto.nationalId },
    });
    if (existingNationalId) {
      throw new ConflictException('National ID already registered');
    }

    const dateOfBirth = new Date(dto.dateOfBirth);
    const age = calculateAge(dateOfBirth);
    if (age < 18 && !dto.guardianUserId) {
      throw new BadRequestException('Patients under 18 require guardianUserId at creation time');
    }

    if (dto.guardianUserId) {
      const guardian = await this.prisma.user.findUnique({ where: { id: dto.guardianUserId } });
      if (!guardian || guardian.role !== Role.CAREGIVER) {
        throw new BadRequestException('guardianUserId must reference an existing user with role CAREGIVER');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.patientProfile.create({
        data: {
          userId: dto.userId,
          fullName: dto.fullName,
          gender: dto.gender,
          dateOfBirth,
          nationalId: dto.nationalId,
          address: dto.address,
          referralSource: dto.referralSource,
          clinicalInfo: dto.clinicalInfo ? { create: dto.clinicalInfo } : undefined,
        },
        include: { clinicalInfo: true },
      });

      if (dto.guardianUserId) {
        await tx.guardianLink.create({
          data: {
            patientUserId: dto.userId,
            guardianUserId: dto.guardianUserId,
            relationship: 'GUARDIAN',
          },
        });
      }

      return created;
    });
  }

  async findById(id: string, actor: AuthenticatedUser): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { id },
      include: { clinicalInfo: true },
    });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    await this.assertCanAccess(actor, profile);
    return profile;
  }

  async update(id: string, dto: UpdatePatientDto, actor: AuthenticatedUser): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    await this.assertCanAccess(actor, profile);

    return this.prisma.patientProfile.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        address: dto.address,
        referralSource: dto.referralSource,
      },
      include: { clinicalInfo: true },
    });
  }

  private async assertCanAccess(actor: AuthenticatedUser, profile: PatientProfile): Promise<void> {
    if (actor.role === Role.CLINICIAN || actor.role === Role.SUPERVISOR || actor.role === Role.ADMIN) {
      return;
    }
    if (actor.role === Role.PATIENT) {
      if (profile.userId === actor.id) {
        return;
      }
      throw new ForbiddenException("Cannot access another patient's profile");
    }
    if (actor.role === Role.CAREGIVER) {
      const link = await this.prisma.guardianLink.findFirst({
        where: { guardianUserId: actor.id, patientUserId: profile.userId },
      });
      if (link) {
        return;
      }
      throw new ForbiddenException('Not linked as guardian for this patient');
    }
    throw new ForbiddenException('Access denied');
  }
}
```

- [ ] **Step 5: Modify `src/modules/patients/patients.controller.ts`** — replace the entire file with:

```typescript
import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients')
@UseGuards(SessionGuard, PermissionsGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @RequirePermission(Permission.CREATE_PATIENT_PROFILE)
  create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_PATIENT_PROFILE)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.findById(id, user);
  }

  @Put(':id')
  @RequirePermission(Permission.EDIT_PATIENT_PROFILE)
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.update(id, dto, user);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 5 new get/update tests.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add patient profile get/update with ownership enforcement"
```

---

### Task 13: Patients — link an additional guardian

**Files:**
- Create: `backend/src/modules/patients/dto/link-guardian.dto.ts`
- Modify: `backend/src/modules/patients/patients.service.ts`
- Modify: `backend/src/modules/patients/patients.controller.ts`
- Modify: `backend/test/patients.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientsService`, RBAC pieces from earlier tasks.
- Produces: `POST /api/v1/patients/:id/guardian` — links an additional caregiver to an existing patient profile (adult or minor).

- [ ] **Step 1: Create `src/modules/patients/dto/link-guardian.dto.ts`**

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LinkGuardianSchema = z.object({
  guardianUserId: z.uuid(),
  relationship: z.string().min(1).max(50),
});

export class LinkGuardianDto extends createZodDto(LinkGuardianSchema) {}
```

- [ ] **Step 2: Append test cases to `test/patients.e2e-spec.ts`**

```typescript
describe('Patients: link guardian', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
  }

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER') {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test User',
      mobile,
      password,
      role,
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

  async function createClinicianToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'CLINICIAN' } });
    return loginAs(mobile, password);
  }

  it('lets a clinician link a second guardian to an adult patient', async () => {
    const clinicianToken = await createClinicianToken('+966500000100', 'password123');
    const adult = await registerActivateAndLogin('+966500000101', 'password123', 'PATIENT');
    const secondGuardian = await registerActivateAndLogin('+966500000102', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: adult.userId,
        fullName: 'Adult Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'LINK-GUARDIAN-1',
      });
    const profileId = createResponse.body.id;

    const linkResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/guardian`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ guardianUserId: secondGuardian.userId, relationship: 'FAMILY_SUPPORT' });

    expect(linkResponse.status).toBe(201);

    const link = await prisma.guardianLink.findFirst({
      where: { patientUserId: adult.userId, guardianUserId: secondGuardian.userId },
    });
    expect(link?.relationship).toBe('FAMILY_SUPPORT');
  });

  it('rejects linking a guardianUserId that is not a CAREGIVER role', async () => {
    const clinicianToken = await createClinicianToken('+966500000103', 'password123');
    const adult = await registerActivateAndLogin('+966500000104', 'password123', 'PATIENT');
    const notAGuardian = await registerActivateAndLogin('+966500000105', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: adult.userId,
        fullName: 'Adult Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'LINK-GUARDIAN-2',
      });
    const profileId = createResponse.body.id;

    const linkResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/guardian`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ guardianUserId: notAGuardian.userId, relationship: 'FAMILY_SUPPORT' });

    expect(linkResponse.status).toBe(400);
  });

  it('rejects a PATIENT trying to link a guardian', async () => {
    const clinicianToken = await createClinicianToken('+966500000106', 'password123');
    const adult = await registerActivateAndLogin('+966500000107', 'password123', 'PATIENT');
    const guardian = await registerActivateAndLogin('+966500000108', 'password123', 'CAREGIVER');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: adult.userId,
        fullName: 'Adult Patient',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'LINK-GUARDIAN-3',
      });
    const profileId = createResponse.body.id;

    const linkResponse = await request(app.getHttpServer())
      .post(`/api/v1/patients/${profileId}/guardian`)
      .set('Authorization', `Bearer ${adult.token}`)
      .send({ guardianUserId: guardian.userId, relationship: 'FAMILY_SUPPORT' });

    expect(linkResponse.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `POST /api/v1/patients/:id/guardian` returns 404.

- [ ] **Step 4: Modify `src/modules/patients/patients.service.ts`** — add this method to the class, immediately before the closing `}` (after `update`), and add the `LinkGuardianDto` and `GuardianLink` imports:

Add to imports:

```typescript
import { GuardianLink } from '@prisma/client';
import { LinkGuardianDto } from './dto/link-guardian.dto';
```

Add to the class:

```typescript
  async linkGuardian(patientProfileId: string, dto: LinkGuardianDto): Promise<GuardianLink> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }

    const guardian = await this.prisma.user.findUnique({ where: { id: dto.guardianUserId } });
    if (!guardian || guardian.role !== Role.CAREGIVER) {
      throw new BadRequestException('guardianUserId must reference an existing user with role CAREGIVER');
    }

    const existingLink = await this.prisma.guardianLink.findFirst({
      where: { patientUserId: profile.userId, guardianUserId: dto.guardianUserId },
    });
    if (existingLink) {
      throw new ConflictException('This guardian is already linked to this patient');
    }

    return this.prisma.guardianLink.create({
      data: {
        patientUserId: profile.userId,
        guardianUserId: dto.guardianUserId,
        relationship: dto.relationship,
      },
    });
  }
```

- [ ] **Step 5: Modify `src/modules/patients/patients.controller.ts`** — add the import and endpoint:

Add to imports:

```typescript
import { LinkGuardianDto } from './dto/link-guardian.dto';
```

Add to the class, after `update`:

```typescript
  @Post(':id/guardian')
  @RequirePermission(Permission.LINK_GUARDIAN)
  linkGuardian(@Param('id') id: string, @Body() dto: LinkGuardianDto) {
    return this.patientsService.linkGuardian(id, dto);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 3 new guardian-linking tests.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add endpoint to link an additional guardian to a patient"
```

---

### Task 14: Patients — disable status and search (staff-only)

**Files:**
- Modify: `backend/src/modules/patients/patients.service.ts`
- Modify: `backend/src/modules/patients/patients.controller.ts`
- Modify: `backend/test/patients.e2e-spec.ts`

**Interfaces:**
- Consumes: `PatientsService`, RBAC pieces from earlier tasks.
- Produces: `PATCH /api/v1/patients/:id/status` (disable only, no delete endpoint exists), `GET /api/v1/patients?q=` (search, staff-only).

- [ ] **Step 1: Append test cases to `test/patients.e2e-spec.ts`**

```typescript
describe('Patients: disable and search', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function loginAs(mobile: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return response.body.token;
  }

  async function registerActivateAndLogin(mobile: string, password: string, role: 'PATIENT' | 'CAREGIVER') {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Test User',
      mobile,
      password,
      role,
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    return { token: await loginAs(mobile, password), userId: registerResponse.body.userId };
  }

  async function createClinicianToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'CLINICIAN' } });
    return loginAs(mobile, password);
  }

  it('disables a profile without deleting the row', async () => {
    const clinicianToken = await createClinicianToken('+966500000110', 'password123');
    const patient = await registerActivateAndLogin('+966500000111', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'To Be Disabled',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'DISABLE-TEST-1',
      });
    const profileId = createResponse.body.id;

    const disableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${profileId}/status`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({ status: 'DISABLED' });

    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body.status).toBe('DISABLED');

    const stillExists = await prisma.patientProfile.findUnique({ where: { id: profileId } });
    expect(stillExists).not.toBeNull();
  });

  it('rejects a PATIENT trying to disable a profile', async () => {
    const clinicianToken = await createClinicianToken('+966500000112', 'password123');
    const patient = await registerActivateAndLogin('+966500000113', 'password123', 'PATIENT');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Protected Profile',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'DISABLE-TEST-2',
      });
    const profileId = createResponse.body.id;

    const disableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${profileId}/status`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ status: 'DISABLED' });

    expect(disableResponse.status).toBe(403);
  });

  it('lets a clinician search patients by name', async () => {
    const clinicianToken = await createClinicianToken('+966500000114', 'password123');
    const patient = await registerActivateAndLogin('+966500000115', 'password123', 'PATIENT');

    await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patient.userId,
        fullName: 'Findable Patient Name',
        gender: 'MALE',
        dateOfBirth: '1990-05-01',
        nationalId: 'SEARCH-TEST-1',
      });

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients?q=Findable')
      .set('Authorization', `Bearer ${clinicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].fullName).toBe('Findable Patient Name');
  });

  it('rejects a PATIENT trying to search', async () => {
    const patient = await registerActivateAndLogin('+966500000116', 'password123', 'PATIENT');

    const response = await request(app.getHttpServer())
      .get('/api/v1/patients?q=anything')
      .set('Authorization', `Bearer ${patient.token}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `PATCH /api/v1/patients/:id/status` and `GET /api/v1/patients` return 404.

- [ ] **Step 3: Modify `src/modules/patients/dto/create-patient.dto.ts`** — no change needed. Instead, create a small inline status DTO. Create `src/modules/patients/dto/update-status.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});

export class UpdateStatusDto extends createZodDto(UpdateStatusSchema) {}
```

- [ ] **Step 4: Modify `src/modules/patients/patients.service.ts`** — add these two methods to the class, immediately before the closing `}` (after `linkGuardian`), and add the `UpdateStatusDto` import:

Add to imports:

```typescript
import { UpdateStatusDto } from './dto/update-status.dto';
```

Add to the class:

```typescript
  async updateStatus(id: string, dto: UpdateStatusDto): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return this.prisma.patientProfile.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async search(query: string | undefined): Promise<PatientProfile[]> {
    return this.prisma.patientProfile.findMany({
      where: query
        ? {
            OR: [{ fullName: { contains: query, mode: 'insensitive' } }, { nationalId: { contains: query } }],
          }
        : undefined,
      include: { clinicalInfo: true },
      take: 50,
    });
  }
```

- [ ] **Step 5: Modify `src/modules/patients/patients.controller.ts`** — add imports and two endpoints:

Add to imports:

```typescript
import { Patch, Query } from '@nestjs/common';
import { UpdateStatusDto } from './dto/update-status.dto';
```

(Combine with the existing `@nestjs/common` import line rather than duplicating it — the final import line should read:
`import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';`)

Add to the class, after `linkGuardian`:

```typescript
  @Get()
  @RequirePermission(Permission.SEARCH_PATIENTS)
  search(@Query('q') q?: string) {
    return this.patientsService.search(q);
  }

  @Patch(':id/status')
  @RequirePermission(Permission.DISABLE_PATIENT_PROFILE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.patientsService.updateStatus(id, dto);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the 4 new disable/search tests.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add patient disable and search endpoints"
```

---

### Task 15: Swagger/OpenAPI wiring and full end-to-end smoke test

**Files:**
- Modify: `backend/src/main.ts`
- Test: `backend/test/smoke.e2e-spec.ts`
- Create: `backend/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-14.
- Produces: `GET /api/docs` (Swagger UI), and a single smoke test proving the full patient journey (register → verify → login → create profile → link guardian → view) works end-to-end with real audit logging.

- [ ] **Step 1: Modify `src/main.ts`** — replace the entire file with:

```typescript
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Kalamy API')
    .setDescription('Kalamy foundation: Auth + Patient Profile modules')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}
bootstrap();
```

- [ ] **Step 2: Write the failing test — `test/smoke.e2e-spec.ts`**

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Smoke test: full patient onboarding journey', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('walks a minor patient from registration to a viewable, guardian-linked profile', async () => {
    // 1. Register the clinician's account directly (self-registration is PATIENT/CAREGIVER only)
    // by seeding it, then verifying the rest of the journey through the real API.
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Dr. Sara Al-Harbi',
      mobile: '+966500000200',
      password: 'clinician-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000200', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500000200' }, data: { role: 'CLINICIAN' } });
    const clinicianLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000200', password: 'clinician-pass1' });
    const clinicianToken = clinicianLogin.body.token;

    // 2. Register the guardian
    const guardianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Mohammed Al-Otaibi',
      mobile: '+966500000201',
      password: 'guardian-pass1',
      role: 'CAREGIVER',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000201', code: guardianRegister.body.devOtpCode });
    const guardianId = guardianRegister.body.userId;

    // 3. Register the minor patient
    const patientRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Sultan Al-Otaibi',
      mobile: '+966500000202',
      password: 'patient-pass1',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500000202', code: patientRegister.body.devOtpCode });
    const patientId = patientRegister.body.userId;
    const patientLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500000202', password: 'patient-pass1' });
    const patientToken = patientLogin.body.token;

    // 4. Clinician creates the patient's clinical profile, linking the guardian atomically (minor)
    const createProfile = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .send({
        userId: patientId,
        fullName: 'Sultan Al-Otaibi',
        gender: 'MALE',
        dateOfBirth: '2016-03-10',
        nationalId: 'SMOKE-TEST-NID-1',
        guardianUserId: guardianId,
        clinicalInfo: {
          referralReason: 'Parental concern about stuttering onset at age 4',
          initialDiagnosis: 'Suspected developmental stuttering',
        },
      });
    expect(createProfile.status).toBe(201);
    const profileId = createProfile.body.id;

    // 5. The patient can view their own profile
    const patientView = await request(app.getHttpServer())
      .get(`/api/v1/patients/${profileId}`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(patientView.status).toBe(200);
    expect(patientView.body.clinicalInfo.initialDiagnosis).toBe('Suspected developmental stuttering');

    // 6. The clinician can find the patient via search
    const search = await request(app.getHttpServer())
      .get('/api/v1/patients?q=Sultan')
      .set('Authorization', `Bearer ${clinicianToken}`);
    expect(search.status).toBe(200);
    expect(search.body.some((p: { id: string }) => p.id === profileId)).toBe(true);

    // 7. Every mutating step along the way was audit-logged
    const auditActions = (await prisma.auditLog.findMany()).map((log) => log.action);
    expect(auditActions).toEqual(
      expect.arrayContaining([
        'POST /api/v1/auth/register',
        'POST /api/v1/auth/verify',
        'POST /api/v1/patients',
      ]),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: this test may already pass if all prior tasks are correctly implemented, since it exercises only already-built endpoints — if so, this step confirms full integration rather than catching a missing feature. If it fails, the failure will point to whichever step in the journey is broken; fix the underlying task before proceeding.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — all e2e suites pass, including the full smoke test.

- [ ] **Step 5: Verify Swagger UI is reachable**

Run: `npm run start:dev` (in one terminal), then in another:
`curl -s http://localhost:3000/api/docs -o /dev/null -w "%{http_code}\n"`
Expected: `200`. Stop the dev server before continuing.

- [ ] **Step 6: Create `backend/README.md`**

```markdown
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
```

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add Swagger docs, full smoke test, and backend README"
```

---

## Post-plan

Once all 15 tasks are complete, the foundation is done: a NestJS + PostgreSQL API implementing AUTH and Patient Profile, with RBAC, audit logging, and OTP (mocked), fully tested. The next sub-project per the design doc's build order is the clinical core (Assessment + Treatment Plan + Exercise Library modules), which should go through its own brainstorming → spec → plan cycle.
