import { useEffect, useState } from 'react';
import { Card, Title, Text, Table, Alert, Stack, Button, Group } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { getAssessmentResultsReport, getMedicalReport } from '../api/reports';
import type { AssessmentResultsReportRow, MedicalReport } from '../api/reports';
import { ApiError } from '../api/client';
import { printMedicalReport } from './medicalReportPrint';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function ReportsSection() {
  const { patient } = usePatientDetail();

  const [assessmentResults, setAssessmentResults] = useState<AssessmentResultsReportRow[] | null>(null);
  const [medicalReport, setMedicalReport] = useState<MedicalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient) return;
    setError(null);
    Promise.all([getAssessmentResultsReport(patient.id), getMedicalReport(patient.id)])
      .then(([resultsResponse, medicalResponse]) => {
        setAssessmentResults(resultsResponse);
        setMedicalReport(medicalResponse);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  if (!patient) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.reports.patientSectionTitle}</Title>
      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      <Text fw={600} mb="xs">{ar.reports.assessmentResultsTitle}</Text>
      {assessmentResults === null ? null : assessmentResults.length === 0 ? (
        <Text c="dimmed" mb="md">{ar.reports.noAssessmentResults}</Text>
      ) : (
        <Table mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.reports.assessmentTypeLabel}</Table.Th>
              <Table.Th>{ar.reports.assessmentStatusLabel}</Table.Th>
              <Table.Th>{ar.reports.ssi4TotalLabel}</Table.Th>
              <Table.Th>{ar.reports.severityCategoryLabel}</Table.Th>
              <Table.Th>{ar.reports.approvedAtLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {assessmentResults.map((row) => (
              <Table.Tr key={row.id} data-testid={`assessment-result-row-${row.id}`}>
                <Table.Td>{ar.patientDetail.assessmentTypes[row.type] ?? row.type}</Table.Td>
                <Table.Td>{ar.patientDetail.assessmentStatuses[row.status] ?? row.status}</Table.Td>
                <Table.Td>{row.ssi4Total ?? '—'}</Table.Td>
                <Table.Td>
                  {row.severityCategory ? (ar.patientDetail.severityCategories[row.severityCategory] ?? row.severityCategory) : '—'}
                </Table.Td>
                <Table.Td>{row.approvedAt ? formatDate(row.approvedAt) : '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Group justify="space-between" mb="xs">
        <Text fw={600}>{ar.reports.medicalReportTitle}</Text>
        {medicalReport ? (
          <Button
            size="xs"
            variant="light"
            data-testid="export-medical-pdf"
            onClick={() => printMedicalReport(medicalReport)}
          >
            {ar.reports.exportMedicalPdfButton}
          </Button>
        ) : null}
      </Group>
      {medicalReport === null ? null : (
        <Stack gap="xs">
          {medicalReport.clinicalInfo ? (
            <Stack gap={4}>
              <Text>{ar.reports.referralReasonLabel}: {medicalReport.clinicalInfo.referralReason ?? '—'}</Text>
              <Text>{ar.reports.initialDiagnosisLabel}: {medicalReport.clinicalInfo.initialDiagnosis ?? '—'}</Text>
              <Text>{ar.reports.medicalHistoryLabel}: {medicalReport.clinicalInfo.medicalHistory ?? '—'}</Text>
              <Text>{ar.reports.medicationsLabel}: {medicalReport.clinicalInfo.medications ?? '—'}</Text>
              <Text>{ar.reports.allergiesLabel}: {medicalReport.clinicalInfo.allergies ?? '—'}</Text>
              <Text>{ar.reports.familyHistoryLabel}: {medicalReport.clinicalInfo.familyHistory ?? '—'}</Text>
            </Stack>
          ) : (
            <Text c="dimmed">{ar.reports.noClinicalInfo}</Text>
          )}

          <Text fw={600}>{ar.reports.latestAssessmentTitle}</Text>
          {medicalReport.latestApprovedAssessment ? (
            <Text data-testid="latest-assessment-summary">
              {ar.patientDetail.assessmentTypes[medicalReport.latestApprovedAssessment.type] ?? medicalReport.latestApprovedAssessment.type}
              {' — '}
              {medicalReport.latestApprovedAssessment.severityCategory
                ? (ar.patientDetail.severityCategories[medicalReport.latestApprovedAssessment.severityCategory] ?? medicalReport.latestApprovedAssessment.severityCategory)
                : '—'}
              {' — '}
              {formatDate(medicalReport.latestApprovedAssessment.approvedAt)}
            </Text>
          ) : (
            <Text c="dimmed">{ar.reports.noLatestAssessment}</Text>
          )}

          <Text fw={600}>{ar.reports.activePlanTitle}</Text>
          {medicalReport.activeTreatmentPlan ? (
            <Text data-testid="active-plan-summary">
              {ar.patientDetail.phases[medicalReport.activeTreatmentPlan.phase] ?? medicalReport.activeTreatmentPlan.phase}
              {' — '}
              {medicalReport.activeTreatmentPlan.goals}
              {medicalReport.activeTreatmentPlan.reviewDate ? ` — ${formatDate(medicalReport.activeTreatmentPlan.reviewDate)}` : ''}
            </Text>
          ) : (
            <Text c="dimmed">{ar.reports.noActivePlanForReport}</Text>
          )}
        </Stack>
      )}
    </Card>
  );
}
