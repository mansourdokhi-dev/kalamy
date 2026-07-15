import { useEffect, useState } from 'react';
import { Card, Title, Text, Stack, Table, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { getProgressDashboard, getPassedLevels } from '../api/progress';
import type { ProgressDashboard, PassedLevelSummary } from '../api/progress';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function ProgressSection() {
  const { patient } = usePatientDetail();

  const [dashboard, setDashboard] = useState<ProgressDashboard | null>(null);
  const [passedLevels, setPassedLevels] = useState<PassedLevelSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient) return;
    setError(null);
    Promise.all([getProgressDashboard(patient.id), getPassedLevels(patient.id)])
      .then(([dashboardResult, passedResult]) => {
        setDashboard(dashboardResult);
        setPassedLevels(passedResult);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  if (!patient) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.progress.title}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {dashboard ? (
        <Stack gap="xs" mb="md">
          <Text>{ar.progress.currentLevelLabel}: <Text span>{dashboard.currentLevelName ?? '—'}</Text></Text>
          <Text>{ar.progress.levelsCompletedLabel}: {dashboard.levelsCompleted}</Text>
          <Text>{ar.progress.totalTrainingEventsLabel}: {dashboard.totalTrainingEvents}</Text>
          <Text>{ar.progress.daysInProgramLabel}: {dashboard.daysInProgram}</Text>
          <Text>
            {ar.progress.repeatedLevelsLabel}: {dashboard.repeatedLevelOrders.length > 0 ? dashboard.repeatedLevelOrders.join('، ') : ar.progress.noRepeatedLevels}
          </Text>
        </Stack>
      ) : null}

      <Text fw={600} mb="xs">{ar.progress.passedLevelsTitle}</Text>
      {passedLevels === null ? null : passedLevels.length === 0 ? (
        <Text c="dimmed">{ar.progress.noPassedLevels}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.progress.levelNameLabel}</Table.Th>
              <Table.Th>{ar.progress.levelOrderLabel}</Table.Th>
              <Table.Th>{ar.progress.passedAtLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {passedLevels.map((level) => (
              <Table.Tr key={level.levelId}>
                <Table.Td>{level.levelName}</Table.Td>
                <Table.Td>{level.order}</Table.Td>
                <Table.Td>{level.passedAt ? formatDate(level.passedAt) : ar.progress.notPassedYet}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}
