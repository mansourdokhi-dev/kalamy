import { useEffect, useState } from 'react';
import { Container, Title, Tabs, Table, Text, Alert, SimpleGrid, Card, TextInput, Stack, Group } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canViewAdminReports } from '../auth/permissions';
import {
  getOperationalStatusReport,
  getRegisteredUsersReport,
  getServiceModificationsReport,
  getStaffPerformanceReport,
  getComplaintsReport,
  getKpiDashboard,
} from '../api/reports';
import type {
  OperationalStatusReport,
  RegisteredUserSummary,
  ServiceModificationLogEntry,
  StaffPerformanceSummary,
  KpiDashboard,
} from '../api/reports';
import type { Complaint } from '../api/complaints';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : ar.errors.unexpected;
}

function KpiDashboardTab() {
  const [kpi, setKpi] = useState<KpiDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getKpiDashboard().then(setKpi).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!kpi) return null;

  const headline: Array<{ key: string; label: string; value: number }> = [
    { key: 'totalPatients', label: ar.reports.kpi.totalPatients, value: kpi.totalPatients },
    { key: 'activeCases', label: ar.reports.kpi.activeCases, value: kpi.activeCases },
    { key: 'inactiveCases', label: ar.reports.kpi.inactiveCases, value: kpi.inactiveCases },
    { key: 'approvedDiagnosesCount', label: ar.reports.kpi.approvedDiagnosesCount, value: kpi.approvedDiagnosesCount },
    { key: 'levelTransitions', label: ar.reports.kpi.levelTransitions, value: kpi.levelTransitions },
    { key: 'newRegistrationsLast30Days', label: ar.reports.kpi.newRegistrationsLast30Days, value: kpi.newRegistrationsLast30Days },
    { key: 'totalRegisteredUsers', label: ar.reports.kpi.totalRegisteredUsers, value: kpi.totalRegisteredUsers },
  ];

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {headline.map((item) => (
          <Card withBorder key={item.key} data-testid={`kpi-${item.key}`}>
            <Text size="xl" fw={700}>{item.value}</Text>
            <Text size="sm" c="dimmed">{item.label}</Text>
          </Card>
        ))}
      </SimpleGrid>

      <div>
        <Text fw={600} mb="xs">{ar.reports.kpi.severityTitle}</Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          {Object.entries(kpi.assessmentsBySeverity).map(([key, count]) => (
            <Card withBorder key={key} data-testid={`kpi-severity-${key}`}>
              <Text size="lg" fw={700}>{count}</Text>
              <Text size="sm" c="dimmed">{ar.patientDetail.severityCategories[key] ?? key}</Text>
            </Card>
          ))}
        </SimpleGrid>
      </div>

      <div>
        <Text fw={600} mb="xs">{ar.reports.kpi.consultationsTitle}</Text>
        <SimpleGrid cols={{ base: 2, sm: 5 }}>
          {Object.entries(kpi.consultationsByStatus).map(([key, count]) => (
            <Card withBorder key={key} data-testid={`kpi-consultation-${key}`}>
              <Text size="lg" fw={700}>{count}</Text>
              <Text size="sm" c="dimmed">{ar.consultation.statuses[key as keyof typeof ar.consultation.statuses] ?? key}</Text>
            </Card>
          ))}
        </SimpleGrid>
      </div>

      <Text c="dimmed" size="sm">{ar.reports.kpi.revenueNote}</Text>
    </Stack>
  );
}

function OperationalStatusTab() {
  const [report, setReport] = useState<OperationalStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOperationalStatusReport().then(setReport).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!report) return null;

  const groups: Array<{ title: string; data: Record<string, number>; labels: Record<string, string> }> = [
    { title: ar.reports.usersByRoleTitle, data: report.usersByRole, labels: ar.reports.roles },
    { title: ar.reports.patientProfilesByStatusTitle, data: report.patientProfilesByStatus, labels: ar.patients.statuses },
    { title: ar.reports.treatmentPlansByStatusTitle, data: report.treatmentPlansByStatus, labels: ar.reports.planStatuses },
    { title: ar.reports.trainingCyclesByStatusTitle, data: report.trainingCyclesByStatus, labels: ar.reports.cycleStatuses },
  ];

  return (
    <Stack gap="md">
      {groups.map((group) => {
        const nonZeroEntries = Object.entries(group.data).filter(([, count]) => count > 0);
        return (
          <div key={group.title}>
            <Text fw={600} mb="xs">{group.title}</Text>
            {nonZeroEntries.length === 0 ? (
              <Text c="dimmed">{ar.reports.noData}</Text>
            ) : (
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                {nonZeroEntries.map(([key, count]) => (
                  <Card withBorder key={key} data-testid={`stat-${key}`}>
                    <Text size="sm" c="dimmed">{group.labels[key] ?? key}</Text>
                    <Text fw={700} size="lg">{count}</Text>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </div>
        );
      })}
    </Stack>
  );
}

function RegisteredUsersTab() {
  const [rows, setRows] = useState<RegisteredUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRegisteredUsersReport().then(setRows).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (rows === null) return null;
  if (rows.length === 0) return <Text c="dimmed">{ar.reports.noRegisteredUsers}</Text>;

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{ar.reports.fullNameLabel}</Table.Th>
          <Table.Th>{ar.reports.mobileLabel}</Table.Th>
          <Table.Th>{ar.reports.roleLabel}</Table.Th>
          <Table.Th>{ar.reports.statusLabel}</Table.Th>
          <Table.Th>{ar.reports.caseProgressLabel}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.id} data-testid={`registered-user-row-${row.id}`}>
            <Table.Td>{row.fullName}</Table.Td>
            <Table.Td>{row.mobile}</Table.Td>
            <Table.Td>{ar.reports.roles[row.role] ?? row.role}</Table.Td>
            <Table.Td>{ar.reports.userStatuses[row.status] ?? row.status}</Table.Td>
            <Table.Td>{row.caseProgressSummary ?? '—'}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ServiceModificationsTab() {
  const [rows, setRows] = useState<ServiceModificationLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    getServiceModificationsReport({ from: from || undefined, to: to || undefined })
      .then(setRows)
      .catch((err) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  return (
    <Stack gap="md">
      <Group>
        <TextInput
          data-testid="service-modifications-from"
          type="date"
          label={ar.reports.fromDateLabel}
          value={from}
          onChange={(event) => setFrom(event.currentTarget.value)}
        />
        <TextInput
          data-testid="service-modifications-to"
          type="date"
          label={ar.reports.toDateLabel}
          value={to}
          onChange={(event) => setTo(event.currentTarget.value)}
        />
      </Group>
      {error ? <Alert color="red">{error}</Alert> : null}
      {rows === null ? null : rows.length === 0 ? (
        <Text c="dimmed">{ar.reports.noServiceModifications}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.reports.actionLabel}</Table.Th>
              <Table.Th>{ar.reports.entityLabel}</Table.Th>
              <Table.Th>{ar.reports.actorLabel}</Table.Th>
              <Table.Th>{ar.reports.dateLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.id} data-testid={`service-modification-row-${row.id}`}>
                <Table.Td>{row.action}</Table.Td>
                <Table.Td>{row.entity}</Table.Td>
                <Table.Td>{row.actorFullName ?? '—'}</Table.Td>
                <Table.Td>{formatDate(row.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function StaffPerformanceTab() {
  const [rows, setRows] = useState<StaffPerformanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStaffPerformanceReport().then(setRows).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (rows === null) return null;
  if (rows.length === 0) return <Text c="dimmed">{ar.reports.noStaffPerformance}</Text>;

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{ar.reports.fullNameLabel}</Table.Th>
          <Table.Th>{ar.reports.roleLabel}</Table.Th>
          <Table.Th>{ar.reports.patientsHandledLabel}</Table.Th>
          <Table.Th>{ar.reports.reviewsApprovedLabel}</Table.Th>
          <Table.Th>{ar.reports.reviewsRepeatRequiredLabel}</Table.Th>
          <Table.Th>{ar.reports.complaintsAgainstLabel}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.clinicianUserId} data-testid={`staff-performance-row-${row.clinicianUserId}`}>
            <Table.Td>{row.fullName}</Table.Td>
            <Table.Td>{ar.reports.roles[row.role] ?? row.role}</Table.Td>
            <Table.Td>{row.patientsHandled}</Table.Td>
            <Table.Td>{row.reviewsApproved}</Table.Td>
            <Table.Td>{row.reviewsRepeatRequired}</Table.Td>
            <Table.Td>{row.complaintsAgainst}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ComplaintsReportTab() {
  const [rows, setRows] = useState<Complaint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getComplaintsReport().then(setRows).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (rows === null) return null;
  if (rows.length === 0) return <Text c="dimmed">{ar.complaints.emptyState}</Text>;

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{ar.complaints.typeLabel}</Table.Th>
          <Table.Th>{ar.complaints.subjectLabel}</Table.Th>
          <Table.Th>{ar.complaints.statusLabel}</Table.Th>
          <Table.Th>{ar.complaints.createdAtLabel}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.id} data-testid={`complaints-report-row-${row.id}`}>
            <Table.Td>{ar.complaints.types[row.type]}</Table.Td>
            <Table.Td>{row.subject}</Table.Td>
            <Table.Td>{ar.complaints.statuses[row.status]}</Table.Td>
            <Table.Td>{formatDate(row.createdAt)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function AdminReportsPage() {
  const { user } = useAuth();

  if (!user || !canViewAdminReports(user.role)) {
    return null;
  }

  return (
    <Container size="lg">
      <Title order={2} mb="md">{ar.reports.adminReportsTitle}</Title>
      <Tabs defaultValue="kpiDashboard" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="kpiDashboard" data-testid="tab-kpiDashboard">{ar.reports.tabs.kpiDashboard}</Tabs.Tab>
          <Tabs.Tab value="operationalStatus" data-testid="tab-operationalStatus">{ar.reports.tabs.operationalStatus}</Tabs.Tab>
          <Tabs.Tab value="registeredUsers" data-testid="tab-registeredUsers">{ar.reports.tabs.registeredUsers}</Tabs.Tab>
          <Tabs.Tab value="serviceModifications" data-testid="tab-serviceModifications">{ar.reports.tabs.serviceModifications}</Tabs.Tab>
          <Tabs.Tab value="staffPerformance" data-testid="tab-staffPerformance">{ar.reports.tabs.staffPerformance}</Tabs.Tab>
          <Tabs.Tab value="complaintsReport" data-testid="tab-complaintsReport">{ar.reports.tabs.complaintsReport}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="kpiDashboard" pt="md"><KpiDashboardTab /></Tabs.Panel>
        <Tabs.Panel value="operationalStatus" pt="md"><OperationalStatusTab /></Tabs.Panel>
        <Tabs.Panel value="registeredUsers" pt="md"><RegisteredUsersTab /></Tabs.Panel>
        <Tabs.Panel value="serviceModifications" pt="md"><ServiceModificationsTab /></Tabs.Panel>
        <Tabs.Panel value="staffPerformance" pt="md"><StaffPerformanceTab /></Tabs.Panel>
        <Tabs.Panel value="complaintsReport" pt="md"><ComplaintsReportTab /></Tabs.Panel>
      </Tabs>
    </Container>
  );
}
