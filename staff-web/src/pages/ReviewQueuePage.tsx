import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Title, Table, Button, Text, Badge, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { listAvailableSamples, reserveSample } from '../api/specialist-review';
import type { AvailableSampleRow } from '../api/specialist-review';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function ReviewQueuePage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AvailableSampleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reservingId, setReservingId] = useState<string | null>(null);

  useEffect(() => {
    listAvailableSamples()
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
  }, []);

  async function handleReserve(row: AvailableSampleRow) {
    setReservingId(row.id);
    setError(null);
    try {
      await reserveSample(row.id);
      navigate(`/patients/${row.patientProfileId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setReservingId(null);
    }
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.reviewQueue.title}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}
      {rows === null ? null : rows.length === 0 ? (
        <Text c="dimmed">{ar.reviewQueue.emptyState}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.reviewQueue.patientNameLabel}</Table.Th>
              <Table.Th>{ar.reviewQueue.submittedAtLabel}</Table.Th>
              <Table.Th />
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.id} data-testid={`queue-row-${row.id}`}>
                <Table.Td>{row.patientProfile.fullName}</Table.Td>
                <Table.Td>{row.speechSample?.submittedAt ? formatDate(row.speechSample.submittedAt) : '—'}</Table.Td>
                <Table.Td>
                  {row.speechSample?.escalatedAt ? <Badge color="red">{ar.reviewQueue.escalatedLabel}</Badge> : null}
                </Table.Td>
                <Table.Td>
                  <Button
                    data-testid={`reserve-button-${row.id}`}
                    loading={reservingId === row.id}
                    onClick={() => handleReserve(row)}
                  >
                    {ar.reviewQueue.reserveButton}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
