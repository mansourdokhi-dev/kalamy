# Staff Web Sub-project 5: Admin & Supervision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ADMIN a UI for staff-account management and clinician-supervisor assignment, give SUPERVISOR a UI for their assigned clinicians, and unblock "transfer review responsibility" (deferred in sub-project 3 due to a since-fixed backend gap).

**Architecture:** Two new API modules (`admin-users.ts`, `supervision.ts`) plus an extension to the existing `specialist-review.ts`. A new ADMIN-only `/staff-accounts` page (create + list/filter + enable/disable + supervisor assignment). A new SUPERVISOR-only `/my-clinicians` page (read-only). A SUPERVISOR-facing extension to the existing `SampleReviewSection` for the transfer-review-responsibility action.

**Tech Stack:** Vite + React 19.2 + TypeScript, Mantine 9.4.1 exactly, React Router 7 classic API, Vitest 4 + `@testing-library/react` 16 + jsdom, `apiRequest<T>()` client (no data-fetching library).

## Global Constraints

- Mantine pinned at exactly `9.4.1` across all `@mantine/*` packages — do not run any install that could re-resolve this.
- No new npm dependencies.
- All Arabic copy goes in `staff-web/src/copy/ar.ts`, nowhere else.
- **Reuse existing translated enum maps — do not redefine them**: `ar.reports.roles` (PATIENT/CAREGIVER/CLINICIAN/SUPERVISOR/ADMIN, added in sub-project 4) and `ar.reports.userStatuses` (PENDING_VERIFICATION/ACTIVE/LOCKED/DISABLED, added in sub-project 4's final fix) already cover every enum value this project needs for roles and account statuses. Import/reference them from the existing `ar.reports` namespace; do not create a second `staffAccounts.roles`/`staffAccounts.statuses` map.
- `npm run build` (`tsc -b && vite build`) is the only step that type-checks — run it at every task boundary in addition to `npm test`.
- Follow the existing patterns exactly: the **standalone-page-with-own-route** pattern (`ReviewQueuePage`/`ComplaintsPage`/`AdminReportsPage`) for `/staff-accounts` and `/my-clinicians`; the **always-visible inline form** pattern from `TreatmentPlanSection`'s "new plan" form (not a button-reveal toggle) for the create-staff-account form; the **flip-label status button** pattern from `ProfileSection`'s `toggleStatus` (`ar.patientDetail.disableButton`/`enableButton`) for enable/disable.
- Refetch, never locally patch, after every mutation (lesson from sub-project 3's final review, applied consistently in sub-project 4): after `updateAccountStatus`, `assignSupervisor`, and `transferReviewResponsibility` all succeed, refetch the underlying list/cycle before updating state.
- Every new page gates itself the same all-or-nothing way `AdminReportsPage` does: `if (!user || !canX(user.role)) return null;` before any data fetching — not just a hidden nav link.

---

### Task 1: API modules — `admin-users.ts`, `supervision.ts`, and the `specialist-review.ts` transfer extension

**Files:**
- Create: `staff-web/src/api/admin-users.ts`
- Create: `staff-web/src/api/admin-users.test.ts`
- Create: `staff-web/src/api/supervision.ts`
- Create: `staff-web/src/api/supervision.test.ts`
- Modify: `staff-web/src/api/specialist-review.ts` (add `transferReviewResponsibility`)
- Modify: `staff-web/src/api/specialist-review.test.ts` (add its test)

**Interfaces:**
- Consumes: `apiRequest<T>(path, options)` from `staff-web/src/api/client.ts`.
- Produces (for later tasks): from `admin-users.ts` — `StaffAccountSummary`, `StaffCreatableRole`, `AccountStatus`, `createStaffAccount(input)`, `listStaffAccounts(filter?)`, `updateAccountStatus(id, status)`. From `supervision.ts` — `ClinicianWithSupervisor`, `assignSupervisor(clinicianUserId, supervisorUserId)`, `listMyClinicians(supervisorUserId)`. From `specialist-review.ts` — `TransferReviewInput`, `transferReviewResponsibility(cycleId, input)`.

- [ ] **Step 1: Write `admin-users.ts`**

```typescript
// staff-web/src/api/admin-users.ts
import { apiRequest } from './client';

export type StaffRoleValue = 'PATIENT' | 'CAREGIVER' | 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN';
export type AccountStatusValue = 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
export type StaffCreatableRole = 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'DISABLED';

export interface StaffAccountSummary {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  role: StaffRoleValue;
  status: AccountStatusValue;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface CreateStaffAccountInput {
  fullName: string;
  mobile: string;
  email?: string;
  password: string;
  role: StaffCreatableRole;
}

export function createStaffAccount(input: CreateStaffAccountInput): Promise<StaffAccountSummary> {
  return apiRequest<StaffAccountSummary>('/api/v1/admin/staff', { method: 'POST', body: input, auth: true });
}

export function listStaffAccounts(filter: { role?: string; status?: string } = {}): Promise<StaffAccountSummary[]> {
  const params = new URLSearchParams();
  if (filter.role) params.set('role', filter.role);
  if (filter.status) params.set('status', filter.status);
  const query = params.toString();
  return apiRequest<StaffAccountSummary[]>(`/api/v1/admin/users${query ? `?${query}` : ''}`, { auth: true });
}

export function updateAccountStatus(id: string, status: AccountStatus): Promise<StaffAccountSummary> {
  return apiRequest<StaffAccountSummary>(`/api/v1/admin/users/${id}/status`, { method: 'PATCH', body: { status }, auth: true });
}
```

- [ ] **Step 2: Write `admin-users.test.ts`**

```typescript
// staff-web/src/api/admin-users.test.ts
import { apiRequest } from './client';
import { createStaffAccount, listStaffAccounts, updateAccountStatus } from './admin-users';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('admin-users API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createStaffAccount POSTs to /api/v1/admin/staff with the input body', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'staff-1' });
    await createStaffAccount({ fullName: 'أحمد', mobile: '+966500000001', password: 'password123', role: 'CLINICIAN' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/staff', {
      method: 'POST',
      body: { fullName: 'أحمد', mobile: '+966500000001', password: 'password123', role: 'CLINICIAN' },
      auth: true,
    });
  });

  it('listStaffAccounts fetches with no query params when filter is empty', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listStaffAccounts();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/users', { auth: true });
  });

  it('listStaffAccounts appends role and status as query params', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listStaffAccounts({ role: 'CLINICIAN', status: 'ACTIVE' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/users?role=CLINICIAN&status=ACTIVE', { auth: true });
  });

  it('updateAccountStatus PATCHes the status endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'staff-1', status: 'DISABLED' });
    await updateAccountStatus('staff-1', 'DISABLED');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/users/staff-1/status', {
      method: 'PATCH',
      body: { status: 'DISABLED' },
      auth: true,
    });
  });
});
```

- [ ] **Step 3: Write `supervision.ts`**

```typescript
// staff-web/src/api/supervision.ts
import { apiRequest } from './client';
import type { StaffAccountSummary } from './admin-users';

export interface ClinicianWithSupervisor extends StaffAccountSummary {
  supervisorUserId: string | null;
}

export function assignSupervisor(clinicianUserId: string, supervisorUserId: string | null): Promise<ClinicianWithSupervisor> {
  return apiRequest<ClinicianWithSupervisor>(`/api/v1/admin/supervision/${clinicianUserId}`, {
    method: 'PUT',
    body: { supervisorUserId },
    auth: true,
  });
}

export function listMyClinicians(supervisorUserId: string): Promise<ClinicianWithSupervisor[]> {
  return apiRequest<ClinicianWithSupervisor[]>(`/api/v1/admin/supervision/${supervisorUserId}/clinicians`, { auth: true });
}
```

- [ ] **Step 4: Write `supervision.test.ts`**

```typescript
// staff-web/src/api/supervision.test.ts
import { apiRequest } from './client';
import { assignSupervisor, listMyClinicians } from './supervision';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('supervision API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assignSupervisor PUTs the clinician-scoped endpoint with the supervisor id', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'clinician-1', supervisorUserId: 'supervisor-1' });
    await assignSupervisor('clinician-1', 'supervisor-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/supervision/clinician-1', {
      method: 'PUT',
      body: { supervisorUserId: 'supervisor-1' },
      auth: true,
    });
  });

  it('assignSupervisor sends null to unassign', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'clinician-1', supervisorUserId: null });
    await assignSupervisor('clinician-1', null);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/supervision/clinician-1', {
      method: 'PUT',
      body: { supervisorUserId: null },
      auth: true,
    });
  });

  it('listMyClinicians fetches the supervisor-scoped endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listMyClinicians('supervisor-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/supervision/supervisor-1/clinicians', { auth: true });
  });
});
```

- [ ] **Step 5: Extend `specialist-review.ts` with the transfer function**

Append to the end of the existing `staff-web/src/api/specialist-review.ts` (do not touch any existing exports):

```typescript
export interface TransferReviewInput {
  toUserId: string;
  reason: string;
}

export function transferReviewResponsibility(cycleId: string, input: TransferReviewInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/specialist-review/cycles/${cycleId}/transfer`, {
    method: 'POST',
    auth: true,
    body: input,
  });
}
```

- [ ] **Step 6: Add the corresponding test to the existing `specialist-review.test.ts`**

Read the current file first to match its existing mock setup exactly (it already has `vi.mock('./client', ...)` boilerplate — do not duplicate it), then add one `it(...)` block inside the existing `describe`:

```typescript
  it('transferReviewResponsibility POSTs the transfer endpoint with toUserId and reason', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1', reservedByUserId: 'clinician-2' });
    await transferReviewResponsibility('cycle-1', { toUserId: 'clinician-2', reason: 'إجازة طارئة' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/cycles/cycle-1/transfer', {
      method: 'POST',
      auth: true,
      body: { toUserId: 'clinician-2', reason: 'إجازة طارئة' },
    });
  });
```
(add the `transferReviewResponsibility` import to the existing `import { ... } from './specialist-review'` line at the top of the test file)

- [ ] **Step 7: Run all new/changed tests and the build**

Run: `cd staff-web && npx vitest run src/api/admin-users.test.ts src/api/supervision.test.ts src/api/specialist-review.test.ts`
Expected: 4 + 3 + (existing count + 1) passed, all green.

Run: `cd staff-web && npm run build`
Expected: clean `tsc -b && vite build`.

- [ ] **Step 8: Commit**

```bash
git add staff-web/src/api/admin-users.ts staff-web/src/api/admin-users.test.ts staff-web/src/api/supervision.ts staff-web/src/api/supervision.test.ts staff-web/src/api/specialist-review.ts staff-web/src/api/specialist-review.test.ts
git commit -m "feat: add admin-users and supervision API modules, extend specialist-review with transfer"
```

---

### Task 2: Staff Accounts page (`/staff-accounts`, ADMIN only)

**Files:**
- Create: `staff-web/src/pages/StaffAccountsPage.tsx`
- Create: `staff-web/src/pages/StaffAccountsPage.test.tsx`
- Modify: `staff-web/src/auth/permissions.ts` (add `canManageStaffAccounts`)
- Modify: `staff-web/src/App.tsx` (add `/staff-accounts` route)
- Modify: `staff-web/src/components/AppShell.tsx` (add nav link, gated)
- Modify: `staff-web/src/copy/ar.ts` (add a `staffAccounts` namespace + `shell.staffAccountsLink`)

**Interfaces:**
- Consumes: `createStaffAccount`, `listStaffAccounts`, `updateAccountStatus`, `StaffAccountSummary`, `StaffCreatableRole`, `AccountStatus` from Task 1's `staff-web/src/api/admin-users.ts`; `assignSupervisor` from Task 1's `staff-web/src/api/supervision.ts`; `useAuth()` from `staff-web/src/auth/AuthProvider.tsx`; the existing `ar.reports.roles` and `ar.reports.userStatuses` maps (added in sub-project 4, in `staff-web/src/copy/ar.ts`) — reused, not redefined.
- Produces: `canManageStaffAccounts(role: StaffRole): boolean` in `staff-web/src/auth/permissions.ts`.

- [ ] **Step 1: Add `canManageStaffAccounts` to `staff-web/src/auth/permissions.ts`**

```typescript
export function canManageStaffAccounts(role: StaffRole): boolean {
  return role === 'ADMIN';
}
```

- [ ] **Step 2: Add the `staffAccounts` copy namespace to `staff-web/src/copy/ar.ts`** (place after the `complaints` key added in sub-project 4, before `errors`)

```typescript
  staffAccounts: {
    title: 'حسابات الطاقم',
    newAccountTitle: 'حساب جديد',
    fullNameLabel: 'الاسم الكامل',
    mobileLabel: 'رقم الجوال',
    emailLabel: 'البريد الإلكتروني',
    passwordLabel: 'كلمة المرور',
    roleLabel: 'الدور',
    createButton: 'إنشاء الحساب',
    filterRoleLabel: 'تصفية حسب الدور',
    filterStatusLabel: 'تصفية حسب الحالة',
    filterAll: 'الكل',
    tableName: 'الاسم',
    tableMobile: 'رقم الجوال',
    tableEmail: 'البريد الإلكتروني',
    tableRole: 'الدور',
    tableStatus: 'الحالة',
    tableCreatedAt: 'تاريخ الإنشاء',
    disableButton: 'تعطيل',
    enableButton: 'تفعيل',
    noAccounts: 'لا توجد حسابات',
    assignSupervisorLabel: 'تعيين مشرف',
    noSupervisorOption: 'بدون مشرف',
    choosePlaceholder: 'اختر مشرفًا',
    assignSuccessMessage: 'تم التعيين',
  },
```

Also add the nav-link label to the existing `shell` namespace (alongside `complaintsLink`/`adminReportsLink`):
```typescript
    staffAccountsLink: 'حسابات الطاقم',
```

- [ ] **Step 3: Write `StaffAccountsPage.tsx`**

```typescript
// staff-web/src/pages/StaffAccountsPage.tsx
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Container, Title, Table, Text, Alert, Select, TextInput, Button, Group, Badge } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canManageStaffAccounts } from '../auth/permissions';
import { createStaffAccount, listStaffAccounts, updateAccountStatus } from '../api/admin-users';
import type { StaffAccountSummary, StaffCreatableRole, AccountStatus } from '../api/admin-users';
import { assignSupervisor } from '../api/supervision';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

const CREATABLE_ROLES: StaffCreatableRole[] = ['CLINICIAN', 'SUPERVISOR', 'ADMIN'];

export function StaffAccountsPage() {
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<StaffAccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffCreatableRole>('CLINICIAN');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignConfirmation, setAssignConfirmation] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await listStaffAccounts({
        role: roleFilter ?? undefined,
        status: statusFilter ?? undefined,
      });
      setAccounts(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    }
  }

  useEffect(() => {
    if (!user || !canManageStaffAccounts(user.role)) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, roleFilter, statusFilter]);

  if (!user || !canManageStaffAccounts(user.role)) {
    return null;
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createStaffAccount({ fullName, mobile, email: email || undefined, password, role });
      setFullName('');
      setMobile('');
      setEmail('');
      setPassword('');
      setRole('CLINICIAN');
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleStatus(account: StaffAccountSummary) {
    setTogglingId(account.id);
    setError(null);
    try {
      const nextStatus: AccountStatus = account.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
      await updateAccountStatus(account.id, nextStatus);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleAssignSupervisor(clinicianId: string, supervisorUserId: string | null) {
    setAssigningId(clinicianId);
    setAssignConfirmation(null);
    setError(null);
    try {
      await assignSupervisor(clinicianId, supervisorUserId);
      setAssignConfirmation(clinicianId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setAssigningId(null);
    }
  }

  const supervisors = (accounts ?? []).filter((a) => a.role === 'SUPERVISOR');

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.staffAccounts.title}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      <form data-testid="new-staff-account-form" onSubmit={handleCreate}>
        <Title order={4} mb="xs">{ar.staffAccounts.newAccountTitle}</Title>
        {createError ? <Alert color="red" mb="sm">{createError}</Alert> : null}
        <Group align="flex-end" mb="lg">
          <TextInput label={ar.staffAccounts.fullNameLabel} value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
          <TextInput label={ar.staffAccounts.mobileLabel} value={mobile} onChange={(e) => setMobile(e.currentTarget.value)} />
          <TextInput label={ar.staffAccounts.emailLabel} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <TextInput type="password" label={ar.staffAccounts.passwordLabel} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Select
            label={ar.staffAccounts.roleLabel}
            data={CREATABLE_ROLES.map((r) => ({ value: r, label: ar.reports.roles[r] }))}
            value={role}
            onChange={(value) => setRole((value as StaffCreatableRole) ?? 'CLINICIAN')}
          />
          <Button type="submit" loading={creating}>{ar.staffAccounts.createButton}</Button>
        </Group>
      </form>

      <Group mb="md">
        <Select
          data-testid="role-filter-select"
          label={ar.staffAccounts.filterRoleLabel}
          value={roleFilter ?? 'ALL'}
          onChange={(value) => setRoleFilter(value === 'ALL' ? null : value)}
          data={[
            { value: 'ALL', label: ar.staffAccounts.filterAll },
            ...CREATABLE_ROLES.map((r) => ({ value: r, label: ar.reports.roles[r] })),
          ]}
          w={200}
        />
        <Select
          data-testid="status-filter-select"
          label={ar.staffAccounts.filterStatusLabel}
          value={statusFilter ?? 'ALL'}
          onChange={(value) => setStatusFilter(value === 'ALL' ? null : value)}
          data={[
            { value: 'ALL', label: ar.staffAccounts.filterAll },
            ...Object.entries(ar.reports.userStatuses).map(([value, label]) => ({ value, label })),
          ]}
          w={200}
        />
      </Group>

      {accounts === null ? null : accounts.length === 0 ? (
        <Text c="dimmed">{ar.staffAccounts.noAccounts}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.staffAccounts.tableName}</Table.Th>
              <Table.Th>{ar.staffAccounts.tableMobile}</Table.Th>
              <Table.Th>{ar.staffAccounts.tableEmail}</Table.Th>
              <Table.Th>{ar.staffAccounts.tableRole}</Table.Th>
              <Table.Th>{ar.staffAccounts.tableStatus}</Table.Th>
              <Table.Th>{ar.staffAccounts.tableCreatedAt}</Table.Th>
              <Table.Th />
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {accounts.map((account) => (
              <Table.Tr key={account.id} data-testid={`staff-account-row-${account.id}`}>
                <Table.Td>{account.fullName}</Table.Td>
                <Table.Td>{account.mobile}</Table.Td>
                <Table.Td>{account.email ?? '—'}</Table.Td>
                <Table.Td>{ar.reports.roles[account.role] ?? account.role}</Table.Td>
                <Table.Td><Badge>{ar.reports.userStatuses[account.status] ?? account.status}</Badge></Table.Td>
                <Table.Td>{formatDate(account.createdAt)}</Table.Td>
                <Table.Td>
                  <Button
                    size="xs"
                    variant="outline"
                    color={account.status === 'ACTIVE' ? 'red' : 'green'}
                    loading={togglingId === account.id}
                    onClick={() => handleToggleStatus(account)}
                  >
                    {account.status === 'ACTIVE' ? ar.staffAccounts.disableButton : ar.staffAccounts.enableButton}
                  </Button>
                </Table.Td>
                <Table.Td>
                  {account.role === 'CLINICIAN' ? (
                    <Group gap="xs">
                      <Select
                        data-testid={`assign-supervisor-select-${account.id}`}
                        placeholder={ar.staffAccounts.choosePlaceholder}
                        disabled={assigningId === account.id}
                        onChange={(value) => handleAssignSupervisor(account.id, value === 'NONE' ? null : value)}
                        data={[
                          { value: 'NONE', label: ar.staffAccounts.noSupervisorOption },
                          ...supervisors.map((s) => ({ value: s.id, label: s.fullName })),
                        ]}
                        w={180}
                      />
                      {assignConfirmation === account.id ? <Text c="green" size="sm">{ar.staffAccounts.assignSuccessMessage}</Text> : null}
                    </Group>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
```

- [ ] **Step 4: Write `StaffAccountsPage.test.tsx`**

```typescript
// staff-web/src/pages/StaffAccountsPage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { StaffAccountsPage } from './StaffAccountsPage';
import { AuthProvider } from '../auth/AuthProvider';
import { createStaffAccount, listStaffAccounts, updateAccountStatus } from '../api/admin-users';
import { assignSupervisor } from '../api/supervision';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/admin-users');
vi.mock('../api/supervision');
vi.mock('../api/auth');
vi.mock('../storage/session');

const clinicianRow = {
  id: 'clinician-1',
  fullName: 'أخصائي تجريبي',
  mobile: '+966500000001',
  email: null,
  role: 'CLINICIAN' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: false,
  createdAt: '2026-07-10T00:00:00.000Z',
};

const supervisorRow = {
  id: 'supervisor-1',
  fullName: 'مشرف تجريبي',
  mobile: '+966500000002',
  email: null,
  role: 'SUPERVISOR' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: false,
  createdAt: '2026-07-09T00:00:00.000Z',
};

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'ADMIN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });

  return render(
    <MantineProvider>
      <AuthProvider>
        <StaffAccountsPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StaffAccountsPage', () => {
  it('renders nothing for a CLINICIAN', async () => {
    const { container } = renderPage('CLINICIAN');
    await waitFor(() => {
      expect(container.textContent).not.toContain('حسابات الطاقم');
    });
    expect(listStaffAccounts).not.toHaveBeenCalled();
  });

  it('renders nothing for a SUPERVISOR', async () => {
    const { container } = renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(container.textContent).not.toContain('حسابات الطاقم');
    });
  });

  it('ADMIN sees the account list and empty state when there are none', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('ADMIN');
    await waitFor(() => {
      expect(screen.getByText('لا توجد حسابات')).toBeTruthy();
    });
  });

  it('creates a new staff account and refetches the list', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValue([clinicianRow]);
    (createStaffAccount as ReturnType<typeof vi.fn>).mockResolvedValue(clinicianRow);
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('new-staff-account-form')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('الاسم الكامل'), { target: { value: 'أخصائي تجريبي' } });
    fireEvent.change(screen.getByLabelText('رقم الجوال'), { target: { value: '+966500000001' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByTestId('new-staff-account-form'));

    await waitFor(() => {
      expect(createStaffAccount).toHaveBeenCalledWith({
        fullName: 'أخصائي تجريبي',
        mobile: '+966500000001',
        email: undefined,
        password: 'password123',
        role: 'CLINICIAN',
      });
      expect(listStaffAccounts).toHaveBeenCalledTimes(2);
    });
  });

  it('toggles an active account to disabled and refetches', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([clinicianRow])
      .mockResolvedValue([{ ...clinicianRow, status: 'DISABLED' }]);
    (updateAccountStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...clinicianRow, status: 'DISABLED' });
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('staff-account-row-clinician-1')).toBeTruthy());
    fireEvent.click(screen.getByText('تعطيل'));

    await waitFor(() => {
      expect(updateAccountStatus).toHaveBeenCalledWith('clinician-1', 'DISABLED');
      expect(listStaffAccounts).toHaveBeenCalledTimes(2);
    });
  });

  it('assigns a supervisor to a CLINICIAN row and shows a confirmation', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([clinicianRow, supervisorRow]);
    (assignSupervisor as ReturnType<typeof vi.fn>).mockResolvedValue({ ...clinicianRow, supervisorUserId: 'supervisor-1' });
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('assign-supervisor-select-clinician-1')).toBeTruthy());
    // data-testid lands directly on the Mantine Select's <input role="combobox">
    // itself, not a wrapper (traced against Mantine 9.4.1 source and confirmed in
    // sub-project 4's review) — click the testid'd element directly, not
    // within(...).getByRole('combobox'), which would find no descendant.
    fireEvent.click(screen.getByTestId('assign-supervisor-select-clinician-1'));
    fireEvent.click(await screen.findByText('مشرف تجريبي'));

    await waitFor(() => {
      expect(assignSupervisor).toHaveBeenCalledWith('clinician-1', 'supervisor-1');
      expect(screen.getByText('تم التعيين')).toBeTruthy();
    });
  });

  it('does not show the supervisor-assignment control for non-CLINICIAN rows', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([supervisorRow]);
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('staff-account-row-supervisor-1')).toBeTruthy());
    expect(screen.queryByTestId('assign-supervisor-select-supervisor-1')).toBeNull();
  });
});
```

- [ ] **Step 5: Wire the `/staff-accounts` route into `App.tsx`**

```typescript
import { StaffAccountsPage } from './pages/StaffAccountsPage';
```

```typescript
          <Route
            path="/staff-accounts"
            element={
              <RequireAuth>
                <AppShell>
                  <StaffAccountsPage />
                </AppShell>
              </RequireAuth>
            }
          />
```

- [ ] **Step 6: Add the gated nav link in `AppShell.tsx`**

```typescript
import { canReviewSample, canViewAdminReports, canManageStaffAccounts } from '../auth/permissions';
```

```typescript
        {user && canManageStaffAccounts(user.role) ? (
          <NavLink component={Link} to="/staff-accounts" label={ar.shell.staffAccountsLink} />
        ) : null}
```
(add this after the existing `canViewAdminReports`-gated block)

- [ ] **Step 7: Run tests and build**

Run: `cd staff-web && npx vitest run src/pages/StaffAccountsPage.test.tsx`
Expected: 6 passed.

Run: `cd staff-web && npm test -- --run`
Expected: all tests pass, no regressions.

Run: `cd staff-web && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add staff-web/src/pages/StaffAccountsPage.tsx staff-web/src/pages/StaffAccountsPage.test.tsx staff-web/src/auth/permissions.ts staff-web/src/App.tsx staff-web/src/components/AppShell.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add the staff accounts page with create/list/status-toggle/supervisor-assignment"
```

---

### Task 3: My Clinicians page (`/my-clinicians`, SUPERVISOR only)

**Files:**
- Create: `staff-web/src/pages/MyCliniciansPage.tsx`
- Create: `staff-web/src/pages/MyCliniciansPage.test.tsx`
- Modify: `staff-web/src/auth/permissions.ts` (add `canViewMyClinicians`)
- Modify: `staff-web/src/App.tsx` (add `/my-clinicians` route)
- Modify: `staff-web/src/components/AppShell.tsx` (add nav link, gated)
- Modify: `staff-web/src/copy/ar.ts` (add a `myClinicians` namespace + `shell.myCliniciansLink`)

**Interfaces:**
- Consumes: `listMyClinicians(supervisorUserId)` from Task 1's `staff-web/src/api/supervision.ts`; `useAuth()` (provides `user.id`, the logged-in supervisor's own id — this page never takes a route param).
- Produces: `canViewMyClinicians(role: StaffRole): boolean` in `staff-web/src/auth/permissions.ts`.

- [ ] **Step 1: Add `canViewMyClinicians` to `staff-web/src/auth/permissions.ts`**

```typescript
export function canViewMyClinicians(role: StaffRole): boolean {
  return role === 'SUPERVISOR';
}
```

- [ ] **Step 2: Add the `myClinicians` copy namespace to `staff-web/src/copy/ar.ts`** (place after the `staffAccounts` key from Task 2, before `errors`)

```typescript
  myClinicians: {
    title: 'الأخصائيون الخاضعون لإشرافي',
    emptyState: 'لا يوجد أخصائيون معينون لك حاليًا',
    tableName: 'الاسم',
    tableMobile: 'رقم الجوال',
    tableStatus: 'الحالة',
  },
```

Also add the nav-link label to the existing `shell` namespace:
```typescript
    myCliniciansLink: 'أخصائيوّ إشرافي',
```

- [ ] **Step 3: Write `MyCliniciansPage.tsx`**

```typescript
// staff-web/src/pages/MyCliniciansPage.tsx
import { useEffect, useState } from 'react';
import { Container, Title, Table, Text, Alert, Badge } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canViewMyClinicians } from '../auth/permissions';
import { listMyClinicians } from '../api/supervision';
import type { ClinicianWithSupervisor } from '../api/supervision';
import { ApiError } from '../api/client';

export function MyCliniciansPage() {
  const { user } = useAuth();

  const [clinicians, setClinicians] = useState<ClinicianWithSupervisor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !canViewMyClinicians(user.role)) return;
    listMyClinicians(user.id)
      .then(setClinicians)
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
  }, [user]);

  if (!user || !canViewMyClinicians(user.role)) {
    return null;
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.myClinicians.title}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {clinicians === null ? null : clinicians.length === 0 ? (
        <Text c="dimmed">{ar.myClinicians.emptyState}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.myClinicians.tableName}</Table.Th>
              <Table.Th>{ar.myClinicians.tableMobile}</Table.Th>
              <Table.Th>{ar.myClinicians.tableStatus}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {clinicians.map((clinician) => (
              <Table.Tr key={clinician.id} data-testid={`clinician-row-${clinician.id}`}>
                <Table.Td>{clinician.fullName}</Table.Td>
                <Table.Td>{clinician.mobile}</Table.Td>
                <Table.Td><Badge>{ar.reports.userStatuses[clinician.status] ?? clinician.status}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
```

- [ ] **Step 4: Write `MyCliniciansPage.test.tsx`**

```typescript
// staff-web/src/pages/MyCliniciansPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MyCliniciansPage } from './MyCliniciansPage';
import { AuthProvider } from '../auth/AuthProvider';
import { listMyClinicians } from '../api/supervision';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/supervision');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'SUPERVISOR') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'supervisor-1',
    fullName: 'Staff Supervisor',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });

  return render(
    <MantineProvider>
      <AuthProvider>
        <MyCliniciansPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MyCliniciansPage', () => {
  it('renders nothing for a CLINICIAN', async () => {
    const { container } = renderPage('CLINICIAN');
    await waitFor(() => {
      expect(container.textContent).not.toContain('الأخصائيون الخاضعون لإشرافي');
    });
    expect(listMyClinicians).not.toHaveBeenCalled();
  });

  it('renders nothing for an ADMIN', async () => {
    const { container } = renderPage('ADMIN');
    await waitFor(() => {
      expect(container.textContent).not.toContain('الأخصائيون الخاضعون لإشرافي');
    });
  });

  it('fetches using the logged-in supervisor\'s own id', async () => {
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(listMyClinicians).toHaveBeenCalledWith('supervisor-1');
    });
  });

  it('shows the empty state when there are no assigned clinicians', async () => {
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByText('لا يوجد أخصائيون معينون لك حاليًا')).toBeTruthy();
    });
  });

  it('renders a clinician row', async () => {
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'clinician-1', fullName: 'أخصائي تجريبي', mobile: '+966500000001', email: null, role: 'CLINICIAN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-07-10T00:00:00.000Z', supervisorUserId: 'supervisor-1' },
    ]);
    renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByTestId('clinician-row-clinician-1')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 5: Wire the `/my-clinicians` route into `App.tsx`**

```typescript
import { MyCliniciansPage } from './pages/MyCliniciansPage';
```

```typescript
          <Route
            path="/my-clinicians"
            element={
              <RequireAuth>
                <AppShell>
                  <MyCliniciansPage />
                </AppShell>
              </RequireAuth>
            }
          />
```

- [ ] **Step 6: Add the gated nav link in `AppShell.tsx`**

```typescript
import { canReviewSample, canViewAdminReports, canManageStaffAccounts, canViewMyClinicians } from '../auth/permissions';
```

```typescript
        {user && canViewMyClinicians(user.role) ? (
          <NavLink component={Link} to="/my-clinicians" label={ar.shell.myCliniciansLink} />
        ) : null}
```

- [ ] **Step 7: Run tests and build**

Run: `cd staff-web && npx vitest run src/pages/MyCliniciansPage.test.tsx`
Expected: 5 passed.

Run: `cd staff-web && npm test -- --run`
Expected: all tests pass, no regressions.

Run: `cd staff-web && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add staff-web/src/pages/MyCliniciansPage.tsx staff-web/src/pages/MyCliniciansPage.test.tsx staff-web/src/auth/permissions.ts staff-web/src/App.tsx staff-web/src/components/AppShell.tsx staff-web/src/copy/ar.ts
git commit -m "feat: add the my-clinicians page for supervisors"
```

---

### Task 4: Transfer review responsibility extension to `SampleReviewSection`

**Files:**
- Modify: `staff-web/src/patients/SampleReviewSection.tsx`
- Modify: `staff-web/src/patients/SampleReviewSection.test.tsx`
- Modify: `staff-web/src/auth/permissions.ts` (add `canTransferReview`)
- Modify: `staff-web/src/copy/ar.ts` (add transfer keys to the existing `sampleReview` namespace)

**Interfaces:**
- Consumes: `transferReviewResponsibility(cycleId, input)` from Task 1's extended `staff-web/src/api/specialist-review.ts`; `listMyClinicians(supervisorUserId)` from Task 1's `staff-web/src/api/supervision.ts`.
- Produces: `canTransferReview(role: StaffRole): boolean` in `staff-web/src/auth/permissions.ts`.

**Context — read `staff-web/src/patients/SampleReviewSection.tsx` in full before starting.** This is a targeted extension of an existing, working component — every existing line of behavior must be preserved exactly; only the specific insertions described below are new.

- [ ] **Step 1: Add `canTransferReview` to `staff-web/src/auth/permissions.ts`**

```typescript
export function canTransferReview(role: StaffRole): boolean {
  return role === 'SUPERVISOR';
}
```

- [ ] **Step 2: Add transfer-related keys to the existing `sampleReview` namespace in `staff-web/src/copy/ar.ts`** (insert alongside the other `sampleReview` keys, e.g. after `submitDecisionButton`)

```typescript
    transferTitle: 'نقل مسؤولية المراجعة',
    transferToLabel: 'نقل إلى',
    transferReasonLabel: 'سبب النقل',
    transferButton: 'تنفيذ النقل',
    noClinicians: 'لا يوجد أخصائيون تحت إشرافك',
```

- [ ] **Step 3: Modify `SampleReviewSection.tsx`**

Make these five precise changes to the existing file — do not restructure anything else:

**3a.** Update the imports at the top:
```typescript
import { canReviewSample, canTransferReview } from '../auth/permissions';
import { getCurrentCycle } from '../api/cycles';
import type { TrainingCycle, SpecialistDecision, InterventionType } from '../api/cycles';
import { reviewSample, requestIntervention, completeIntervention, transferReviewResponsibility } from '../api/specialist-review';
import { listMyClinicians } from '../api/supervision';
import type { ClinicianWithSupervisor } from '../api/supervision';
```
(this replaces the two existing import lines for `../auth/permissions` and `../api/specialist-review`, and adds the two new ones for `../api/supervision`)

**3b.** Add a module-level constant right after the existing `DECISION_SUBMITTABLE_STATUSES` constant:
```typescript
// Mirrors the backend's own status guard in `transferResponsibility()`
// (`specialist-review.service.ts`) exactly.
const TRANSFER_ELIGIBLE_STATUSES = new Set(['UNDER_REVIEW', 'DIRECT_INTERVENTION_REQUIRED', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION']);
```

**3c.** Add new state, inside the component, alongside the existing intervention-related `useState` calls (after `interventionError`):
```typescript
  const [clinicians, setClinicians] = useState<ClinicianWithSupervisor[] | null>(null);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [transferReason, setTransferReason] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
```

**3d.** Add a new `useEffect` right after the existing `getCurrentCycle`-fetching `useEffect` (still before the early-return `if` statements — hooks must stay unconditional):
```typescript
  useEffect(() => {
    if (!user || !canTransferReview(user.role)) return;
    listMyClinicians(user.id)
      .then(setClinicians)
      .catch((err) => setTransferError(err instanceof ApiError ? err.message : ar.errors.unexpected));
  }, [user]);
```

**3e.** Widen the first early-return guard from:
```typescript
  if (!patient || !user || !canReviewSample(user.role)) {
    return null;
  }
```
to:
```typescript
  if (!patient || !user || !(canReviewSample(user.role) || canTransferReview(user.role))) {
    return null;
  }
```
(the second early-return guard, `if (!cycle || !REVIEW_RELEVANT_STATUSES.has(cycle.status) || !cycle.speechSample)`, stays exactly as-is — all three transfer-eligible statuses are already members of `REVIEW_RELEVANT_STATUSES`)

**3f.** Add a `handleTransfer` function alongside the other handler functions (after `handleCompleteIntervention`):
```typescript
  async function handleTransfer() {
    if (!patient || !toUserId) return;
    setTransferring(true);
    setTransferError(null);
    try {
      await transferReviewResponsibility(cycleId, { toUserId, reason: transferReason });
      const fresh = await getCurrentCycle(patient.id);
      setCycle(fresh);
      setTransferReason('');
      setToUserId(null);
    } catch (err) {
      setTransferError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setTransferring(false);
    }
  }
```

**3g.** Insert a new branch into the final ternary, so it reads (only the middle branch is new — the `isReservationHolder` branch's contents and the final `reservedByOtherLabel`/`notYetReservedLabel` branches are unchanged):
```typescript
      {isReservationHolder ? (
        <Stack gap="md">
          {/* ...existing decision/intervention JSX, completely unchanged... */}
        </Stack>
      ) : canTransferReview(user.role) && TRANSFER_ELIGIBLE_STATUSES.has(cycle.status) ? (
        <Stack gap="xs">
          {transferError ? <Alert color="red">{transferError}</Alert> : null}
          <Text fw={600}>{ar.sampleReview.transferTitle}</Text>
          {clinicians && clinicians.length === 0 ? (
            <Text c="dimmed">{ar.sampleReview.noClinicians}</Text>
          ) : (
            <>
              <Select
                data-testid="transfer-target-select"
                label={ar.sampleReview.transferToLabel}
                data={(clinicians ?? []).map((c) => ({ value: c.id, label: c.fullName }))}
                value={toUserId}
                onChange={setToUserId}
              />
              <Textarea
                label={ar.sampleReview.transferReasonLabel}
                value={transferReason}
                onChange={(e) => setTransferReason(e.currentTarget.value)}
              />
              <Group>
                <Button onClick={handleTransfer} loading={transferring} disabled={!toUserId}>
                  {ar.sampleReview.transferButton}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      ) : sample.reservedByUserId ? (
        <Alert color="yellow">{ar.sampleReview.reservedByOtherLabel}</Alert>
      ) : (
        <Alert color="gray">{ar.sampleReview.notYetReservedLabel}</Alert>
      )}
```

- [ ] **Step 4: Update `SampleReviewSection.test.tsx`**

The existing test `'renders nothing for a SUPERVISOR'` (using `baseCycle`, whose `status: 'UNDER_REVIEW'` is now transfer-eligible) is now **factually wrong** — a SUPERVISOR must see the transfer block for this exact cycle. Read the current test file first, then:

1. **Replace** that test with two tests that capture the real, narrower rule:

```typescript
  it('renders nothing for a SUPERVISOR when the cycle is not transfer-eligible', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle, status: 'WAITING_FOR_SPECIALIST' });
    const { container } = renderSection('SUPERVISOR');
    await waitFor(() => {
      expect(container.textContent).not.toContain('مراجعة العينة');
    });
  });

  it('shows the transfer form for a SUPERVISOR when the cycle is transfer-eligible', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'clinician-2', fullName: 'أخصائي آخر', mobile: '+966500000009', email: null, role: 'CLINICIAN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-07-01T00:00:00.000Z', supervisorUserId: 'staff-1' },
    ]);
    renderSection('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByText('نقل مسؤولية المراجعة')).toBeTruthy();
    });
    expect(screen.queryByText('إرسال القرار')).toBeNull();
  });
```

2. Add the new mocks and import at the top of the file:
```typescript
import { listMyClinicians } from '../api/supervision';
```
```typescript
vi.mock('../api/supervision');
```

3. Add one more test for the actual transfer submission:
```typescript
  it('submits a transfer with the selected clinician and reason', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'clinician-2', fullName: 'أخصائي آخر', mobile: '+966500000009', email: null, role: 'CLINICIAN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-07-01T00:00:00.000Z', supervisorUserId: 'staff-1' },
    ]);
    (transferReviewResponsibility as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle.speechSample, reservedByUserId: 'clinician-2' });
    renderSection('SUPERVISOR');

    await waitFor(() => expect(screen.getByTestId('transfer-target-select')).toBeTruthy());
    // Same lesson as StaffAccountsPage.test.tsx: data-testid lands on the Select's
    // own <input role="combobox">, so click it directly rather than scoping
    // within(...).getByRole('combobox'), which finds no descendant.
    fireEvent.click(screen.getByTestId('transfer-target-select'));
    fireEvent.click(await screen.findByText('أخصائي آخر'));
    fireEvent.change(screen.getByLabelText('سبب النقل'), { target: { value: 'إجازة طارئة' } });
    fireEvent.click(screen.getByText('تنفيذ النقل'));

    await waitFor(() => {
      expect(transferReviewResponsibility).toHaveBeenCalledWith('cycle-1', { toUserId: 'clinician-2', reason: 'إجازة طارئة' });
    });
  });
```
(add `transferReviewResponsibility` to the existing `import { reviewSample, requestIntervention, completeIntervention } from '../api/specialist-review';` line)

**Note on the "does not show the supervisor-assignment control" style check**: unlike Task 2's page, this component's existing `isReservationHolder`-gated block already excludes SUPERVISOR implicitly (a SUPERVISOR's `user.id` never equals a CLINICIAN's `reservedByUserId`), so no separate exclusion test is needed here — the two tests above already cover both the "not transfer-eligible" and "transfer-eligible" cases exhaustively for SUPERVISOR.

- [ ] **Step 5: Run tests and build**

Run: `cd staff-web && npx vitest run src/patients/SampleReviewSection.test.tsx`
Expected: all passed (the original suite's test count minus 1 removed plus 3 added).

Run: `cd staff-web && npm test -- --run`
Expected: all tests pass, no regressions.

Run: `cd staff-web && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add staff-web/src/patients/SampleReviewSection.tsx staff-web/src/patients/SampleReviewSection.test.tsx staff-web/src/auth/permissions.ts staff-web/src/copy/ar.ts
git commit -m "feat: add transfer-review-responsibility control to SampleReviewSection for supervisors"
```

---

## Post-plan: final whole-branch review and browser verification

After all 4 tasks are complete and individually reviewed, dispatch a final whole-branch code review, fix any findings, then do a real browser click-through (login as ADMIN — create a staff account, toggle status, assign a supervisor; login as SUPERVISOR — view My Clinicians, and exercise the transfer-review control on a patient with a cycle in a transfer-eligible status) before merging to `master`, per the established pattern from every prior staff-web sub-project.
