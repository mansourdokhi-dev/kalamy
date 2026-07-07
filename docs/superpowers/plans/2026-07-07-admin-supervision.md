# Administration (Staff Accounts + Supervision) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ADMIN create real CLINICIAN/SUPERVISOR/ADMIN accounts (replacing the test-only role-flip shortcut), manage any user account, force a password change on first login for admin-created staff, and assign exactly one supervisor per clinician — per `docs/superpowers/specs/2026-07-07-admin-supervision-design.md`.

**Architecture:** Two new NestJS modules — `AdminUsersModule` (staff creation + generic user management) and `SupervisionModule` (supervisor–clinician assignment) — plus a small addition to the existing `AuthModule` (a `mustChangePassword` flag on login, and a new self-service `change-password` endpoint). No new Prisma models; two new fields on the existing `User` model.

**Tech Stack:** NestJS 11 (TypeScript), PostgreSQL 16 via Prisma 6.19.3, nestjs-zod/Zod, Jest + Supertest against a real Postgres (Docker).

## Global Constraints

- No hard deletes — accounts are only ever disabled (`status: DISABLED`), never deleted.
- Only ADMIN can create staff accounts or reassign supervisors — confirmed explicitly by the user (no SUPERVISOR self-service account creation).
- Exactly one supervisor per clinician at a time — confirmed explicitly by the user (not a many-to-many).
- Admin sets the initial password directly at staff-creation time — no random-password generation or delivery mechanism.
- Every new controller uses `@UseGuards(SessionGuard, PermissionsGuard)` at the class level and `@RequirePermission(Permission.X)` per route, matching every existing controller — except the self-service `change-password` endpoint, which uses only `@UseGuards(SessionGuard)` (no RBAC gate), matching the existing `logout`/`sessions` endpoints in `AuthController`.
- Any module using `SessionGuard` in its controllers must import `AuthModule`.
- DTOs are Zod schemas wrapped with `createZodDto`, matching every existing DTO.
- e2e tests run against a real Postgres via `createTestApp()`/`resetDatabase()` from `backend/test/utils/test-app.ts` — never mocked.
- Out of scope for this plan (do not build): system settings, portal backups, visual color-coded patient classification, supervisor-assignment history beyond the existing audit log.

---

## File Structure

- `backend/prisma/schema.prisma` — add `mustChangePassword`, `supervisorUserId` fields and the `ClinicianSupervisor` self-relation to `User`.
- `backend/src/modules/auth/dto/change-password.dto.ts` — new DTO.
- `backend/src/modules/auth/auth.service.ts` — modify `login()` to return `mustChangePassword`; add `changePassword()`.
- `backend/src/modules/auth/auth.controller.ts` — add `POST /change-password`.
- `backend/src/common/rbac/permissions.ts` — add 4 new permissions.
- `backend/src/modules/admin-users/dto/create-staff.dto.ts`, `dto/update-user-status.dto.ts` — new DTOs.
- `backend/src/modules/admin-users/admin-users.service.ts` — `createStaff`, `list`, `findById`, `updateStatus`.
- `backend/src/modules/admin-users/admin-users.controller.ts` — `POST /api/v1/admin/staff`, `GET /api/v1/admin/users`, `GET /api/v1/admin/users/:id`, `PATCH /api/v1/admin/users/:id/status`.
- `backend/src/modules/admin-users/admin-users.module.ts`.
- `backend/src/modules/supervision/dto/assign-supervisor.dto.ts` — new DTO.
- `backend/src/modules/supervision/supervision.service.ts` — `assignSupervisor`, `listClinicians`.
- `backend/src/modules/supervision/supervision.controller.ts` — `PUT /api/v1/admin/supervision/:clinicianUserId`, `GET /api/v1/admin/supervision/:supervisorUserId/clinicians`.
- `backend/src/modules/supervision/supervision.module.ts`.
- `backend/src/app.module.ts` — register `AdminUsersModule`, `SupervisionModule`.
- `backend/src/main.ts` — update Swagger description.
- Test files: `backend/test/auth.e2e-spec.ts` (extended), `backend/test/admin-users.e2e-spec.ts`, `backend/test/supervision.e2e-spec.ts`, `backend/test/admin-supervision-smoke.e2e-spec.ts` (new).

---

### Task 1: User schema fields for password-change and supervision

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `User.mustChangePassword: boolean`, `User.supervisorUserId: string | null`, `User.supervisorUser` relation, `User.supervisedClinicians` relation.

- [ ] **Step 1: Add the new fields and self-relation to the User model**

In `backend/prisma/schema.prisma`, inside `model User { ... }`, add these two fields right after `lockedUntil` and before `createdAt`:

```prisma
  mustChangePassword  Boolean    @default(false)
  supervisorUserId    String?
```

Add these two relation lines to the relations block at the bottom of `model User` (alongside `reviewedPatientSessions`):

```prisma
  supervisorUser        User?            @relation("ClinicianSupervisor", fields: [supervisorUserId], references: [id])
  supervisedClinicians   User[]           @relation("ClinicianSupervisor")
```

- [ ] **Step 2: Generate and apply the migration**

Run (from `backend/`):
```bash
npx prisma migrate dev --name add_admin_supervision
```
Expected: a new folder under `backend/prisma/migrations/` containing the SQL, applied to the local dev database without error.

- [ ] **Step 3: Write a schema smoke test**

Create `backend/test/admin-users.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('User schema: mustChangePassword + supervisorUserId', () => {
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

  it('defaults mustChangePassword to false and supervisorUserId to null, and supports assigning a supervisor', async () => {
    const clinician = await prisma.user.create({
      data: {
        fullName: 'Schema Test Clinician',
        mobile: '+966500002000',
        passwordHash: 'x',
        role: 'CLINICIAN',
        status: 'ACTIVE',
      },
    });
    expect(clinician.mustChangePassword).toBe(false);
    expect(clinician.supervisorUserId).toBeNull();

    const supervisor = await prisma.user.create({
      data: {
        fullName: 'Schema Test Supervisor',
        mobile: '+966500002001',
        passwordHash: 'x',
        role: 'SUPERVISOR',
        status: 'ACTIVE',
      },
    });

    const updated = await prisma.user.update({
      where: { id: clinician.id },
      data: { supervisorUserId: supervisor.id },
    });
    expect(updated.supervisorUserId).toBe(supervisor.id);
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:e2e -- admin-users.e2e-spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/test/admin-users.e2e-spec.ts
git commit -m "feat: add mustChangePassword and supervisorUserId fields to User"
```

---

### Task 2: RBAC permission extension for administration

**Files:**
- Modify: `backend/src/common/rbac/permissions.ts`
- Modify: `backend/src/common/rbac/permissions.spec.ts`

**Interfaces:**
- Produces: `Permission.CREATE_STAFF_ACCOUNT`, `Permission.MANAGE_USER_ACCOUNTS`, `Permission.MANAGE_SUPERVISION`, `Permission.VIEW_SUPERVISION`.

- [ ] **Step 1: Write failing permission tests**

Append to `backend/src/common/rbac/permissions.spec.ts`:

```typescript
describe('hasPermission — administration', () => {
  it('allows an ADMIN to create a staff account', () => {
    expect(hasPermission('ADMIN', Permission.CREATE_STAFF_ACCOUNT)).toBe(true);
  });

  it('does not allow a SUPERVISOR to create a staff account', () => {
    expect(hasPermission('SUPERVISOR', Permission.CREATE_STAFF_ACCOUNT)).toBe(false);
  });

  it('allows an ADMIN to manage user accounts', () => {
    expect(hasPermission('ADMIN', Permission.MANAGE_USER_ACCOUNTS)).toBe(true);
  });

  it('does not allow a CLINICIAN to manage user accounts', () => {
    expect(hasPermission('CLINICIAN', Permission.MANAGE_USER_ACCOUNTS)).toBe(false);
  });

  it('allows an ADMIN to manage supervision assignments', () => {
    expect(hasPermission('ADMIN', Permission.MANAGE_SUPERVISION)).toBe(true);
  });

  it('does not allow a SUPERVISOR to manage supervision assignments', () => {
    expect(hasPermission('SUPERVISOR', Permission.MANAGE_SUPERVISION)).toBe(false);
  });

  it('allows a SUPERVISOR to view supervision assignments (ownership enforced elsewhere)', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_SUPERVISION)).toBe(true);
  });

  it('does not allow a PATIENT to view supervision assignments', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_SUPERVISION)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- permissions.spec.ts`
Expected: FAIL — the four new `Permission` members don't exist yet.

- [ ] **Step 3: Extend the Permission enum**

In `backend/src/common/rbac/permissions.ts`, add to the end of the `Permission` enum (after `VIEW_ADMIN_REPORTS = 'VIEW_ADMIN_REPORTS',`):

```typescript
  CREATE_STAFF_ACCOUNT = 'CREATE_STAFF_ACCOUNT',
  MANAGE_USER_ACCOUNTS = 'MANAGE_USER_ACCOUNTS',
  MANAGE_SUPERVISION = 'MANAGE_SUPERVISION',
  VIEW_SUPERVISION = 'VIEW_SUPERVISION',
```

- [ ] **Step 4: Extend ROLE_PERMISSIONS**

Add to the end of `SUPERVISOR`'s array (immediately before its closing `],`):
```typescript
    Permission.VIEW_SUPERVISION,
```

Add to the end of `ADMIN`'s array (immediately before its closing `],`):
```typescript
    Permission.CREATE_STAFF_ACCOUNT,
    Permission.MANAGE_USER_ACCOUNTS,
    Permission.MANAGE_SUPERVISION,
    Permission.VIEW_SUPERVISION,
```

Do not add any of these four permissions to `PATIENT`, `CAREGIVER`, or `CLINICIAN`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- permissions.spec.ts`
Expected: PASS (all tests, including pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/rbac/permissions.ts backend/src/common/rbac/permissions.spec.ts
git commit -m "feat: add RBAC permissions for staff accounts and supervision"
```

---

### Task 3: Auth — mustChangePassword on login + change-password endpoint

**Files:**
- Create: `backend/src/modules/auth/dto/change-password.dto.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `PasswordService.hash`/`compare` (existing, `backend/src/common/security/password.service.ts`), `User.mustChangePassword` (Task 1).
- Produces: `AuthService.login()` returns `{ token, expiresAt, mustChangePassword }`; `AuthService.changePassword(userId, dto)`.

- [ ] **Step 1: Write the DTO**

Create `backend/src/modules/auth/dto/change-password.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
```

- [ ] **Step 2: Write failing e2e tests**

Append to `backend/test/auth.e2e-spec.ts` (a new describe block; the file already has `createTestApp`/`resetDatabase`/`request`/`INestApplication`/`PrismaService` imported and a top-level `app`/`prisma` setup pattern used by its existing describe blocks — follow that same pattern):

```typescript
describe('Auth: mustChangePassword + change-password', () => {
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

  it('returns mustChangePassword: false on login for a normally-registered user', async () => {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Normal Patient',
      mobile: '+966500002100',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500002100', code: registerResponse.body.devOtpCode });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002100', password: 'password123' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.mustChangePassword).toBe(false);
  });

  it('returns mustChangePassword: true on login for a user with the flag set, and clears it via change-password', async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('temp-pass-123', 10);
    const user = await prisma.user.create({
      data: {
        fullName: 'Flagged User',
        mobile: '+966500002101',
        passwordHash,
        role: 'CLINICIAN',
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002101', password: 'temp-pass-123' });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.mustChangePassword).toBe(true);
    const token = loginResponse.body.token;

    const wrongCurrentResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong-password', newPassword: 'new-password-456' });
    expect(wrongCurrentResponse.status).toBe(401);

    const changeResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'temp-pass-123', newPassword: 'new-password-456' });
    expect(changeResponse.status).toBe(200);

    const reloginOldPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002101', password: 'temp-pass-123' });
    expect(reloginOldPassword.status).toBe(401);

    const reloginNewPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002101', password: 'new-password-456' });
    expect(reloginNewPassword.status).toBe(200);
    expect(reloginNewPassword.body.mustChangePassword).toBe(false);

    void user;
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:e2e -- auth.e2e-spec.ts`
Expected: FAIL — `mustChangePassword` is `undefined` in the login response, and `POST /api/v1/auth/change-password` doesn't exist yet (404).

- [ ] **Step 4: Update AuthService.login()**

In `backend/src/modules/auth/auth.service.ts`, change the `login()` method's return type and final return statement:

```typescript
  async login(dto: LoginDto, deviceInfo?: string): Promise<{ token: string; expiresAt: Date; mustChangePassword: boolean }> {
```

(the body stays the same up through `const expiresAt = ...` and the `session.create` call — only the final `return` statement changes)

```typescript
    return { token, expiresAt, mustChangePassword: user.mustChangePassword };
```

- [ ] **Step 5: Add AuthService.changePassword()**

In `backend/src/modules/auth/auth.service.ts`, add this method after `login()` (and import `ChangePasswordDto` at the top alongside the other DTO imports):

```typescript
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const currentMatches = await this.passwordService.compare(dto.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const newPasswordHash = await this.passwordService.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash, mustChangePassword: false },
    });
  }
```

- [ ] **Step 6: Add the controller route**

In `backend/src/modules/auth/auth.controller.ts`, add the import:
```typescript
import { ChangePasswordDto } from './dto/change-password.dto';
```

Add this method inside `AuthController` (after `revokeSession`):

```typescript
  @Post('change-password')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedUser): Promise<{ changed: true }> {
    await this.authService.changePassword(user.id, dto);
    return { changed: true };
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:e2e -- auth.e2e-spec.ts`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 8: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS — the `login()` return-type change is additive (a new field), so no other test asserting on `loginResponse.body.token`/`.expiresAt` should break; confirm this is actually true.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/auth backend/test/auth.e2e-spec.ts
git commit -m "feat: add mustChangePassword flag and change-password endpoint"
```

---

### Task 4: Admin Users — staff account creation

**Files:**
- Create: `backend/src/modules/admin-users/dto/create-staff.dto.ts`
- Create: `backend/src/modules/admin-users/admin-users.service.ts`
- Create: `backend/src/modules/admin-users/admin-users.controller.ts`
- Create: `backend/src/modules/admin-users/admin-users.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/test/admin-users.e2e-spec.ts`

**Interfaces:**
- Consumes: `Permission.CREATE_STAFF_ACCOUNT` (Task 2), `PasswordService.hash` (existing).
- Produces: `AdminUsersService.createStaff(dto)`. `AdminUsersModule` (imported by `AppModule`), extended by Task 5 with more methods/routes on the same files.

- [ ] **Step 1: Write the DTO**

Create `backend/src/modules/admin-users/dto/create-staff.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateStaffSchema = z.object({
  fullName: z.string().min(1).max(100),
  mobile: z.string().regex(/^\+?[0-9]{9,15}$/, 'Invalid mobile number'),
  email: z.email().optional(),
  password: z.string().min(8),
  role: z.enum(['CLINICIAN', 'SUPERVISOR', 'ADMIN']),
});

export class CreateStaffDto extends createZodDto(CreateStaffSchema) {}
```

- [ ] **Step 2: Write failing e2e tests**

Append a new describe block to `backend/test/admin-users.e2e-spec.ts` (after the existing schema-smoke describe block):

```typescript
describe('Admin Users: staff account creation', () => {
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

  async function createAdminToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Admin User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'ADMIN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lets an ADMIN create a CLINICIAN account with mustChangePassword set', async () => {
    const adminToken = await createAdminToken('+966500002200', 'password123');

    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'New Clinician',
        mobile: '+966500002201',
        password: 'initial-pass1',
        role: 'CLINICIAN',
      });

    expect(response.status).toBe(201);
    expect(response.body.role).toBe('CLINICIAN');
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.mustChangePassword).toBe(true);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002201', password: 'initial-pass1' });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.mustChangePassword).toBe(true);
  });

  it('rejects a non-ADMIN creating a staff account', async () => {
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile: '+966500002202',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500002202', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500002202' }, data: { role: 'CLINICIAN' } });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002202', password: 'password123' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${loginResponse.body.token}`)
      .send({ fullName: 'Blocked', mobile: '+966500002203', password: 'password123', role: 'CLINICIAN' });

    expect(response.status).toBe(403);
  });

  it('409s when the mobile number is already registered', async () => {
    const adminToken = await createAdminToken('+966500002204', 'password123');
    await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'First', mobile: '+966500002205', password: 'password123', role: 'CLINICIAN' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Duplicate', mobile: '+966500002205', password: 'password123', role: 'SUPERVISOR' });

    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:e2e -- admin-users.e2e-spec.ts`
Expected: FAIL — `/api/v1/admin/staff` doesn't exist yet (404).

- [ ] **Step 4: Implement the service**

Create `backend/src/modules/admin-users/admin-users.service.ts`:

```typescript
import { ConflictException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';
import { CreateStaffDto } from './dto/create-staff.dto';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async createStaff(dto: CreateStaffDto): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (existing) {
      throw new ConflictException('Mobile number already registered');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    return this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        mobile: dto.mobile,
        email: dto.email,
        passwordHash,
        role: dto.role,
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });
  }
}
```

- [ ] **Step 5: Implement the controller**

Create `backend/src/modules/admin-users/admin-users.controller.ts`:

```typescript
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/admin')
@UseGuards(SessionGuard, PermissionsGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Post('staff')
  @RequirePermission(Permission.CREATE_STAFF_ACCOUNT)
  createStaff(@Body() dto: CreateStaffDto) {
    return this.adminUsersService.createStaff(dto);
  }
}
```

- [ ] **Step 6: Wire the module**

Create `backend/src/modules/admin-users/admin-users.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}
```

- [ ] **Step 7: Register the module in AppModule**

In `backend/src/app.module.ts`, add the import:
```typescript
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
```
And add `AdminUsersModule` to the `imports` array (after `ReportsModule`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test:e2e -- admin-users.e2e-spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/admin-users backend/src/app.module.ts backend/test/admin-users.e2e-spec.ts
git commit -m "feat: add admin staff-account creation"
```

---

### Task 5: Admin Users — list/view/enable-disable

**Files:**
- Create: `backend/src/modules/admin-users/dto/update-user-status.dto.ts`
- Modify: `backend/src/modules/admin-users/admin-users.service.ts`
- Modify: `backend/src/modules/admin-users/admin-users.controller.ts`
- Modify: `backend/test/admin-users.e2e-spec.ts`

**Interfaces:**
- Consumes: `Permission.MANAGE_USER_ACCOUNTS` (Task 2), `AdminUsersService` (Task 4).
- Produces: `AdminUsersService.list(filters)`, `.findById(id)`, `.updateStatus(id, dto)`.

- [ ] **Step 1: Write the DTO**

Create `backend/src/modules/admin-users/dto/update-user-status.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});

export class UpdateUserStatusDto extends createZodDto(UpdateUserStatusSchema) {}
```

- [ ] **Step 2: Write failing e2e tests**

Append a new describe block to `backend/test/admin-users.e2e-spec.ts`:

```typescript
describe('Admin Users: list, view, enable/disable', () => {
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

  async function createAdminToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Admin User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'ADMIN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  it('lets an ADMIN list and filter users by role', async () => {
    const adminToken = await createAdminToken('+966500002300', 'password123');
    await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'A Clinician', mobile: '+966500002301', password: 'password123', role: 'CLINICIAN' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users?role=CLINICIAN')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].mobile).toBe('+966500002301');
  });

  it('lets an ADMIN view a single user by id', async () => {
    const adminToken = await createAdminToken('+966500002302', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'View Me', mobile: '+966500002303', password: 'password123', role: 'SUPERVISOR' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/users/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.fullName).toBe('View Me');
  });

  it('404s when viewing a nonexistent user', async () => {
    const adminToken = await createAdminToken('+966500002304', 'password123');

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('lets an ADMIN disable and re-enable a user account', async () => {
    const adminToken = await createAdminToken('+966500002305', 'password123');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'To Disable', mobile: '+966500002306', password: 'password123', role: 'CLINICIAN' });

    const disableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${createResponse.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DISABLED' });
    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body.status).toBe('DISABLED');

    const loginAttempt = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002306', password: 'password123' });
    expect(loginAttempt.status).toBe(401);

    const enableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${createResponse.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });
    expect(enableResponse.status).toBe(200);
    expect(enableResponse.body.status).toBe('ACTIVE');
  });

  it('rejects a non-ADMIN listing users', async () => {
    const clinicianRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Clinician User',
      mobile: '+966500002307',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500002307', code: clinicianRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500002307' }, data: { role: 'CLINICIAN' } });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002307', password: 'password123' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:e2e -- admin-users.e2e-spec.ts`
Expected: FAIL — `GET /api/v1/admin/users`, `GET /api/v1/admin/users/:id`, `PATCH /api/v1/admin/users/:id/status` don't exist yet (404).

- [ ] **Step 4: Add the service methods**

In `backend/src/modules/admin-users/admin-users.service.ts`, add the import `NotFoundException` (alongside `ConflictException`) and `UpdateUserStatusDto`, then add these methods after `createStaff`:

```typescript
  async list(filters: { role?: string; status?: string }): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        role: filters.role as never,
        status: filters.status as never,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto): Promise<User> {
    await this.findById(id);
    return this.prisma.user.update({ where: { id }, data: { status: dto.status } });
  }
```

- [ ] **Step 5: Add the controller routes**

In `backend/src/modules/admin-users/admin-users.controller.ts`, change the `@nestjs/common` import line to:

```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
```

Add the import:
```typescript
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
```

Add these methods inside `AdminUsersController` (after `createStaff`):

```typescript
  @Get('users')
  @RequirePermission(Permission.MANAGE_USER_ACCOUNTS)
  list(@Query('role') role?: string, @Query('status') status?: string) {
    return this.adminUsersService.list({ role, status });
  }

  @Get('users/:id')
  @RequirePermission(Permission.MANAGE_USER_ACCOUNTS)
  findOne(@Param('id') id: string) {
    return this.adminUsersService.findById(id);
  }

  @Patch('users/:id/status')
  @RequirePermission(Permission.MANAGE_USER_ACCOUNTS)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.adminUsersService.updateStatus(id, dto);
  }
```

Note: route ordering matters here — `@Post('staff')` and the three `users`/`users/:id` routes all live under the same `@Controller('api/v1/admin')` prefix but don't collide with each other since `staff` and `users` are distinct static first segments.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:e2e -- admin-users.e2e-spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/admin-users backend/test/admin-users.e2e-spec.ts
git commit -m "feat: add admin user listing, viewing, and enable/disable"
```

---

### Task 6: Supervision — assign/reassign/unassign

**Files:**
- Create: `backend/src/modules/supervision/dto/assign-supervisor.dto.ts`
- Create: `backend/src/modules/supervision/supervision.service.ts`
- Create: `backend/src/modules/supervision/supervision.controller.ts`
- Create: `backend/src/modules/supervision/supervision.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/supervision.e2e-spec.ts`

**Interfaces:**
- Consumes: `Permission.MANAGE_SUPERVISION` (Task 2), `User.supervisorUserId` (Task 1).
- Produces: `SupervisionService.assignSupervisor(clinicianUserId, dto)`. `SupervisionModule` (imported by `AppModule`), extended by Task 7 with the clinician-list view.

- [ ] **Step 1: Write the DTO**

Create `backend/src/modules/supervision/dto/assign-supervisor.dto.ts`:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AssignSupervisorSchema = z.object({
  supervisorUserId: z.uuid().nullable(),
});

export class AssignSupervisorDto extends createZodDto(AssignSupervisorSchema) {}
```

- [ ] **Step 2: Write failing e2e tests**

Create `backend/test/supervision.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Supervision: assign, reassign, unassign', () => {
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

  async function createAdminToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Admin User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'ADMIN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  async function createStaff(adminToken: string, mobile: string, role: 'CLINICIAN' | 'SUPERVISOR'): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: `Staff ${mobile}`, mobile, password: 'password123', role });
    return response.body.id;
  }

  it('lets an ADMIN assign a supervisor to a clinician', async () => {
    const adminToken = await createAdminToken('+966500002400', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002401', 'CLINICIAN');
    const supervisorId = await createStaff(adminToken, '+966500002402', 'SUPERVISOR');

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: supervisorId });

    expect(response.status).toBe(200);
    expect(response.body.supervisorUserId).toBe(supervisorId);
  });

  it('lets an ADMIN reassign a clinician to a different supervisor', async () => {
    const adminToken = await createAdminToken('+966500002403', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002404', 'CLINICIAN');
    const firstSupervisorId = await createStaff(adminToken, '+966500002405', 'SUPERVISOR');
    const secondSupervisorId = await createStaff(adminToken, '+966500002406', 'SUPERVISOR');
    await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: firstSupervisorId });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: secondSupervisorId });

    expect(response.status).toBe(200);
    expect(response.body.supervisorUserId).toBe(secondSupervisorId);
  });

  it('lets an ADMIN unassign a supervisor by sending null', async () => {
    const adminToken = await createAdminToken('+966500002407', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002408', 'CLINICIAN');
    const supervisorId = await createStaff(adminToken, '+966500002409', 'SUPERVISOR');
    await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: supervisorId });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: null });

    expect(response.status).toBe(200);
    expect(response.body.supervisorUserId).toBeNull();
  });

  it('400s when the target user is not a CLINICIAN', async () => {
    const adminToken = await createAdminToken('+966500002410', 'password123');
    const supervisorId = await createStaff(adminToken, '+966500002411', 'SUPERVISOR');
    const otherSupervisorId = await createStaff(adminToken, '+966500002412', 'SUPERVISOR');

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${supervisorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: otherSupervisorId });

    expect(response.status).toBe(400);
  });

  it('400s when supervisorUserId does not reference a SUPERVISOR', async () => {
    const adminToken = await createAdminToken('+966500002413', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002414', 'CLINICIAN');
    const otherClinicianId = await createStaff(adminToken, '+966500002415', 'CLINICIAN');

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: otherClinicianId });

    expect(response.status).toBe(400);
  });

  it('rejects a non-ADMIN assigning a supervisor', async () => {
    const adminToken = await createAdminToken('+966500002416', 'password123');
    const clinicianId = await createStaff(adminToken, '+966500002417', 'CLINICIAN');
    const supervisorId = await createStaff(adminToken, '+966500002418', 'SUPERVISOR');
    const supervisorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002418', password: 'password123' });

    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianId}`)
      .set('Authorization', `Bearer ${supervisorLogin.body.token}`)
      .send({ supervisorUserId: supervisorId });

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:e2e -- supervision.e2e-spec.ts`
Expected: FAIL — `PUT /api/v1/admin/supervision/:clinicianUserId` doesn't exist yet (404).

- [ ] **Step 4: Implement the service**

Create `backend/src/modules/supervision/supervision.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignSupervisorDto } from './dto/assign-supervisor.dto';

@Injectable()
export class SupervisionService {
  constructor(private readonly prisma: PrismaService) {}

  async assignSupervisor(clinicianUserId: string, dto: AssignSupervisorDto): Promise<User> {
    const clinician = await this.prisma.user.findUnique({ where: { id: clinicianUserId } });
    if (!clinician) {
      throw new NotFoundException('Clinician not found');
    }
    if (clinician.role !== 'CLINICIAN') {
      throw new BadRequestException('Target user is not a CLINICIAN');
    }

    if (dto.supervisorUserId) {
      const supervisor = await this.prisma.user.findUnique({ where: { id: dto.supervisorUserId } });
      if (!supervisor || supervisor.role !== 'SUPERVISOR') {
        throw new BadRequestException('supervisorUserId must reference an existing user with role SUPERVISOR');
      }
    }

    return this.prisma.user.update({
      where: { id: clinicianUserId },
      data: { supervisorUserId: dto.supervisorUserId },
    });
  }
}
```

- [ ] **Step 5: Implement the controller**

Create `backend/src/modules/supervision/supervision.controller.ts`:

```typescript
import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { SupervisionService } from './supervision.service';
import { AssignSupervisorDto } from './dto/assign-supervisor.dto';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/admin/supervision')
@UseGuards(SessionGuard, PermissionsGuard)
export class SupervisionController {
  constructor(private readonly supervisionService: SupervisionService) {}

  @Put(':clinicianUserId')
  @RequirePermission(Permission.MANAGE_SUPERVISION)
  assignSupervisor(@Param('clinicianUserId') clinicianUserId: string, @Body() dto: AssignSupervisorDto) {
    return this.supervisionService.assignSupervisor(clinicianUserId, dto);
  }
}
```

- [ ] **Step 6: Wire the module**

Create `backend/src/modules/supervision/supervision.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SupervisionController } from './supervision.controller';
import { SupervisionService } from './supervision.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SupervisionController],
  providers: [SupervisionService],
  exports: [SupervisionService],
})
export class SupervisionModule {}
```

- [ ] **Step 7: Register the module in AppModule**

In `backend/src/app.module.ts`, add the import:
```typescript
import { SupervisionModule } from './modules/supervision/supervision.module';
```
And add `SupervisionModule` to the `imports` array (after `AdminUsersModule`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test:e2e -- supervision.e2e-spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/supervision backend/src/app.module.ts backend/test/supervision.e2e-spec.ts
git commit -m "feat: add supervisor assignment for clinicians"
```

---

### Task 7: Supervision — view assigned clinicians (ownership-enforced)

**Files:**
- Modify: `backend/src/modules/supervision/supervision.service.ts`
- Modify: `backend/src/modules/supervision/supervision.controller.ts`
- Modify: `backend/test/supervision.e2e-spec.ts`

**Interfaces:**
- Consumes: `Permission.VIEW_SUPERVISION` (Task 2), `SupervisionService.assignSupervisor` (Task 6).
- Produces: `SupervisionService.listClinicians(supervisorUserId, actor)`.

- [ ] **Step 1: Write failing e2e tests**

Append a new describe block to `backend/test/supervision.e2e-spec.ts`:

```typescript
describe('Supervision: view assigned clinicians', () => {
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

  async function createAdminToken(mobile: string, password: string): Promise<string> {
    const registerResponse = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Admin User',
      mobile,
      password,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile, code: registerResponse.body.devOtpCode });
    await prisma.user.update({ where: { mobile }, data: { role: 'ADMIN' } });
    const loginResponse = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile, password });
    return loginResponse.body.token;
  }

  async function createStaffWithLogin(
    adminToken: string,
    mobile: string,
    role: 'CLINICIAN' | 'SUPERVISOR',
  ): Promise<{ id: string; token: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: `Staff ${mobile}`, mobile, password: 'password123', role });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile, password: 'password123' });
    return { id: response.body.id, token: loginResponse.body.token };
  }

  it('lets a SUPERVISOR view their own assigned clinicians', async () => {
    const adminToken = await createAdminToken('+966500002500', 'password123');
    const supervisor = await createStaffWithLogin(adminToken, '+966500002501', 'SUPERVISOR');
    const clinician = await createStaffWithLogin(adminToken, '+966500002502', 'CLINICIAN');
    await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinician.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: supervisor.id });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/supervision/${supervisor.id}/clinicians`)
      .set('Authorization', `Bearer ${supervisor.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(clinician.id);
  });

  it("rejects a different SUPERVISOR viewing another supervisor's clinician list", async () => {
    const adminToken = await createAdminToken('+966500002503', 'password123');
    const supervisor = await createStaffWithLogin(adminToken, '+966500002504', 'SUPERVISOR');
    const otherSupervisor = await createStaffWithLogin(adminToken, '+966500002505', 'SUPERVISOR');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/supervision/${supervisor.id}/clinicians`)
      .set('Authorization', `Bearer ${otherSupervisor.token}`);

    expect(response.status).toBe(403);
  });

  it('lets an ADMIN view any supervisor\'s clinician list', async () => {
    const adminToken = await createAdminToken('+966500002506', 'password123');
    const supervisor = await createStaffWithLogin(adminToken, '+966500002507', 'SUPERVISOR');
    const clinician = await createStaffWithLogin(adminToken, '+966500002508', 'CLINICIAN');
    await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinician.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: supervisor.id });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/supervision/${supervisor.id}/clinicians`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- supervision.e2e-spec.ts`
Expected: FAIL — `GET /api/v1/admin/supervision/:supervisorUserId/clinicians` doesn't exist yet (404).

- [ ] **Step 3: Add the service method**

In `backend/src/modules/supervision/supervision.service.ts`, add the import `ForbiddenException` (alongside `BadRequestException`, `NotFoundException`) and `AuthenticatedUser` from `'../../common/auth/session.guard'`, then add this method after `assignSupervisor`:

```typescript
  async listClinicians(supervisorUserId: string, actor: AuthenticatedUser): Promise<User[]> {
    if (actor.role === 'SUPERVISOR' && actor.id !== supervisorUserId) {
      throw new ForbiddenException('Cannot view another supervisor\'s clinician list');
    }
    return this.prisma.user.findMany({
      where: { supervisorUserId, role: 'CLINICIAN' },
      orderBy: { createdAt: 'asc' },
    });
  }
```

- [ ] **Step 4: Add the controller route**

In `backend/src/modules/supervision/supervision.controller.ts`, change the imports:

```typescript
import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { SupervisionService } from './supervision.service';
import { AssignSupervisorDto } from './dto/assign-supervisor.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
```

Add this method inside `SupervisionController` (after `assignSupervisor`):

```typescript
  @Get(':supervisorUserId/clinicians')
  @RequirePermission(Permission.VIEW_SUPERVISION)
  listClinicians(@Param('supervisorUserId') supervisorUserId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.supervisionService.listClinicians(supervisorUserId, user);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:e2e -- supervision.e2e-spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/supervision backend/test/supervision.e2e-spec.ts
git commit -m "feat: add ownership-scoped clinician list for supervisors"
```

---

### Task 8: Swagger update and full smoke test

**Files:**
- Modify: `backend/src/main.ts`
- Create: `backend/test/admin-supervision-smoke.e2e-spec.ts`

**Interfaces:**
- Consumes: every endpoint added in Tasks 3-7.

- [ ] **Step 1: Update the Swagger description**

In `backend/src/main.ts`, change:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Sessions, Progress, Reports, and Complaints modules')
```

to:

```typescript
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Sessions, Progress, Reports, Complaints, and Administration modules')
```

- [ ] **Step 2: Write the full smoke test**

Create `backend/test/admin-supervision-smoke.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Administration: full smoke test', () => {
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

  it('walks an admin creating a clinician and supervisor, assigning supervision, and the clinician changing their forced password', async () => {
    const adminRegister = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Smoke Admin',
      mobile: '+966500002600',
      password: 'password123',
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ mobile: '+966500002600', code: adminRegister.body.devOtpCode });
    await prisma.user.update({ where: { mobile: '+966500002600' }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002600', password: 'password123' });
    const adminToken = adminLogin.body.token;

    const clinicianCreate = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Smoke Clinician', mobile: '+966500002601', password: 'temp-initial1', role: 'CLINICIAN' });
    expect(clinicianCreate.status).toBe(201);
    expect(clinicianCreate.body.mustChangePassword).toBe(true);

    const supervisorCreate = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Smoke Supervisor', mobile: '+966500002602', password: 'temp-initial2', role: 'SUPERVISOR' });
    expect(supervisorCreate.status).toBe(201);

    const assignResponse = await request(app.getHttpServer())
      .put(`/api/v1/admin/supervision/${clinicianCreate.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supervisorUserId: supervisorCreate.body.id });
    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.supervisorUserId).toBe(supervisorCreate.body.id);

    const supervisorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002602', password: 'temp-initial2' });
    const clinicianListResponse = await request(app.getHttpServer())
      .get(`/api/v1/admin/supervision/${supervisorCreate.body.id}/clinicians`)
      .set('Authorization', `Bearer ${supervisorLogin.body.token}`);
    expect(clinicianListResponse.status).toBe(200);
    expect(clinicianListResponse.body).toHaveLength(1);
    expect(clinicianListResponse.body[0].id).toBe(clinicianCreate.body.id);

    const clinicianLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002601', password: 'temp-initial1' });
    expect(clinicianLogin.body.mustChangePassword).toBe(true);

    const changePasswordResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${clinicianLogin.body.token}`)
      .send({ currentPassword: 'temp-initial1', newPassword: 'permanent-pass1' });
    expect(changePasswordResponse.status).toBe(200);

    const relogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002601', password: 'permanent-pass1' });
    expect(relogin.status).toBe(200);
    expect(relogin.body.mustChangePassword).toBe(false);

    const disableResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${clinicianCreate.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DISABLED' });
    expect(disableResponse.status).toBe(200);

    const blockedLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ mobile: '+966500002601', password: 'permanent-pass1' });
    expect(blockedLogin.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS — every e2e spec file, including all pre-existing ones, passes with 0 failures.

- [ ] **Step 4: Run the unit test suite**

Run: `npm test`
Expected: PASS — every unit spec file passes with 0 failures.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main.ts backend/test/admin-supervision-smoke.e2e-spec.ts
git commit -m "feat: update Swagger description and add Administration smoke test"
```

---

## Self-Review Notes

- **Spec coverage:** Staff account creation (Task 4), forced password change (Task 3), user list/view/enable-disable (Task 5), supervisor assignment with role validation (Task 6), ownership-scoped clinician-list view (Task 7) — all four in-scope items from the design spec are covered. RBAC extension (Task 2) and schema (Task 1) precede their consumers. Swagger + full-suite smoke test (Task 8) closes out the module, matching the pattern of every prior sub-project's final task.
- **Placeholder scan:** No TBD/TODO; every step has runnable code and exact commands. Task 3's Step 2 test uses a slightly unusual inline `PasswordService`/`bcryptjs` call to seed a pre-hashed password directly via Prisma (since there's no API to create a user with an arbitrary `mustChangePassword: true` flag before Task 4 exists) — this is intentional and only needed for that one task's test, since Task 4 onward exercises the same behavior through the real `POST /api/v1/admin/staff` endpoint instead.
- **Type consistency:** `AssignSupervisorDto.supervisorUserId` is `string | null` throughout (DTO, service parameter, Prisma `data` field) — matches `User.supervisorUserId: String?` from Task 1. `CreateStaffDto.role` is restricted to `'CLINICIAN' | 'SUPERVISOR' | 'ADMIN'` (excludes `PATIENT`/`CAREGIVER`, which continue to go through the existing self-registration flow only). `AdminUsersService.list()`'s `filters.role`/`filters.status` are plain optional strings cast at the Prisma call site (`as never`) — needed because `role`/`status` are Prisma enums (`Role`, `UserStatus`) while the controller receives them as untyped query-string values, and an `undefined` filter is what makes the "no filter" case return everything; the cast is narrowly scoped to these two call sites, not a codebase-wide pattern.
