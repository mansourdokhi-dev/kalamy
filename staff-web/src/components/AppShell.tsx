import type { ReactNode } from 'react';
import { AppShell as MantineAppShell, Group, Text, Button, NavLink } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';

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
                <Text size="sm" c="dimmed">
                  —
                </Text>
                <Text size="sm">{ar.shell.roles[user.role]}</Text>
              </Group>
            ) : null}
            <Button variant="subtle" onClick={handleLogout}>{ar.shell.logoutButton}</Button>
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="md">
        <NavLink component={Link} to="/patients" label={ar.shell.patientsLink} />
      </MantineAppShell.Navbar>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  );
}
