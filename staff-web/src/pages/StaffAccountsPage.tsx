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
      setAccounts(result.filter((account) => account.role === 'CLINICIAN' || account.role === 'SUPERVISOR' || account.role === 'ADMIN'));
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
