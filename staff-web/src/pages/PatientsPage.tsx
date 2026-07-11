import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Title, TextInput, Button, Table, Alert, Group, Text } from '@mantine/core';
import { ar } from '../copy/ar';
import { searchPatients } from '../api/patients';
import type { PatientSearchResult } from '../api/patients';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function PatientsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSearching(true);
    try {
      const found = await searchPatients(query);
      setResults(found);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSearching(false);
    }
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.patients.title}</Title>
      <form data-testid="patient-search-form" onSubmit={handleSubmit}>
        <Group mb="md">
          <TextInput
            placeholder={ar.patients.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button type="submit" loading={searching}>{ar.patients.searchButton}</Button>
        </Group>
      </form>

      {error ? <Alert color="red" mb="md">{error}</Alert> : null}

      {results === null ? (
        <Text c="dimmed">{ar.patients.emptyState}</Text>
      ) : results.length === 0 ? (
        <Text c="dimmed">{ar.patients.noResults}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.patients.tableName}</Table.Th>
              <Table.Th>{ar.patients.tableNationalId}</Table.Th>
              <Table.Th>{ar.patients.tableGender}</Table.Th>
              <Table.Th>{ar.patients.tableDateOfBirth}</Table.Th>
              <Table.Th>{ar.patients.tableStatus}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {results.map((patient) => (
              <Table.Tr
                key={patient.id}
                onClick={() => navigate(`/patients/${patient.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <Table.Td>{patient.fullName}</Table.Td>
                <Table.Td>{patient.nationalId}</Table.Td>
                <Table.Td>{ar.patients.genders[patient.gender]}</Table.Td>
                <Table.Td>{formatDate(patient.dateOfBirth)}</Table.Td>
                <Table.Td>{ar.patients.statuses[patient.status]}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
