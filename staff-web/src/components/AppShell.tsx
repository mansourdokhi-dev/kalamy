import type { ReactNode } from 'react';
import { AppShell as MantineAppShell, Group, Text, Button, NavLink } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canReviewSample, canViewAdminReports, canManageStaffAccounts, canViewMyClinicians, canManageQuestionnaires } from '../auth/permissions';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <MantineAppShell header={{ height: 60 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={600}>كلامي</Text>
          <Group>
            {user ? (
              <Group gap={4}>
                <Text size="sm">{user.fullName}</Text>
                <Text size="sm">—</Text>
                <Text size="sm">{ar.shell.roles[user.role]}</Text>
              </Group>
            ) : null}
            <Button variant="subtle" onClick={handleLogout}>{ar.shell.logoutButton}</Button>
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="md">
        <NavLink component={Link} to="/patients" label={ar.shell.patientsLink} />
        <NavLink component={Link} to="/complaints" label={ar.shell.complaintsLink} />
        {user && canViewAdminReports(user.role) ? (
          <NavLink component={Link} to="/admin-reports" label={ar.shell.adminReportsLink} />
        ) : null}
        {user && canManageStaffAccounts(user.role) ? (
          <NavLink component={Link} to="/staff-accounts" label={ar.shell.staffAccountsLink} />
        ) : null}
        {user && canReviewSample(user.role) ? (
          <NavLink component={Link} to="/review-queue" label={ar.shell.reviewQueueLink} />
        ) : null}
        {user && canViewMyClinicians(user.role) ? (
          <NavLink component={Link} to="/my-clinicians" label={ar.shell.myCliniciansLink} />
        ) : null}
        {user && canManageQuestionnaires(user.role) ? (
          <NavLink component={Link} to="/questionnaires" label={ar.shell.questionnairesLink} />
        ) : null}
      </MantineAppShell.Navbar>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  );
}
