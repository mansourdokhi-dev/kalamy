import { useEffect, useState } from 'react';
import { Container, Title, Table, Text, Badge, Alert, Select } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canManageComplaints } from '../auth/permissions';
import { listComplaints, listMyComplaints, updateComplaintStatus } from '../api/complaints';
import type { Complaint, ComplaintStatus } from '../api/complaints';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

const STATUS_OPTIONS: ComplaintStatus[] = ['OPEN', 'REVIEWED', 'RESOLVED'];

export function ComplaintsPage() {
  const { user } = useAuth();
  const canManage = user ? canManageComplaints(user.role) : false;

  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = canManage
        ? await listComplaints(statusFilter ? { status: statusFilter } : {})
        : await listMyComplaints();
      setComplaints(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, statusFilter]);

  async function handleStatusChange(id: string, status: ComplaintStatus) {
    setUpdatingId(id);
    setError(null);
    try {
      await updateComplaintStatus(id, status);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.complaints.title}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {canManage ? (
        <Select
          data-testid="status-filter-select"
          label={ar.complaints.statusFilterLabel}
          value={statusFilter ?? 'ALL'}
          onChange={(value) => setStatusFilter(value === 'ALL' ? null : (value as ComplaintStatus))}
          data={[
            { value: 'ALL', label: ar.complaints.statusFilterAll },
            ...STATUS_OPTIONS.map((status) => ({ value: status, label: ar.complaints.statuses[status] })),
          ]}
          mb="md"
          w={220}
        />
      ) : null}

      {complaints === null ? null : complaints.length === 0 ? (
        <Text c="dimmed">{ar.complaints.emptyState}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.complaints.typeLabel}</Table.Th>
              <Table.Th>{ar.complaints.subjectLabel}</Table.Th>
              <Table.Th>{ar.complaints.descriptionLabel}</Table.Th>
              <Table.Th>{ar.complaints.createdAtLabel}</Table.Th>
              <Table.Th>{ar.complaints.statusLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {complaints.map((complaint) => (
              <Table.Tr key={complaint.id} data-testid={`complaint-row-${complaint.id}`}>
                <Table.Td>
                  <Badge color={complaint.type === 'COMPLAINT' ? 'red' : 'blue'}>
                    {ar.complaints.types[complaint.type]}
                  </Badge>
                </Table.Td>
                <Table.Td>{complaint.subject}</Table.Td>
                <Table.Td>{complaint.description}</Table.Td>
                <Table.Td>{formatDate(complaint.createdAt)}</Table.Td>
                <Table.Td>
                  {canManage ? (
                    <Select
                      data-testid={`complaint-status-select-${complaint.id}`}
                      value={complaint.status}
                      disabled={updatingId === complaint.id}
                      onChange={(value) => value && handleStatusChange(complaint.id, value as ComplaintStatus)}
                      data={STATUS_OPTIONS.map((status) => ({ value: status, label: ar.complaints.statuses[status] }))}
                      w={160}
                    />
                  ) : (
                    <Badge>{ar.complaints.statuses[complaint.status]}</Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
