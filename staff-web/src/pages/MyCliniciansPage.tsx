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
