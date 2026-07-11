import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Title, Table, Button, Group, Select, Stack, Textarea, NumberInput, Alert, Text, Badge } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canEditClinicalData } from '../auth/permissions';
import {
  listAssessments,
  createAssessment,
  updateAssessment,
  approveAssessment,
  getBaselineComparison,
} from '../api/assessments';
import type { Assessment, AssessmentType, SeverityCategory, BaselineComparison } from '../api/assessments';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

export function AssessmentsSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();
  const canEdit = user ? canEditClinicalData(user.role) : false;

  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = assessments?.find((a) => a.id === selectedId) ?? null;
  const [newType, setNewType] = useState<AssessmentType>('INITIAL');
  const [creating, setCreating] = useState(false);

  const [medicalHistory, setMedicalHistory] = useState('');
  const [difficultSituations, setDifficultSituations] = useState('');
  const [anxietyLevel, setAnxietyLevel] = useState('');
  const [initialGoals, setInitialGoals] = useState('');
  const [clinicianNotes, setClinicianNotes] = useState('');
  const [ssi4Frequency, setSsi4Frequency] = useState<number | ''>('');
  const [ssi4Duration, setSsi4Duration] = useState<number | ''>('');
  const [ssi4PhysicalConcomitants, setSsi4PhysicalConcomitants] = useState<number | ''>('');
  const [ssi4Total, setSsi4Total] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [severityCategory, setSeverityCategory] = useState<SeverityCategory>('MILD');
  const [approving, setApproving] = useState(false);
  const [baseline, setBaseline] = useState<BaselineComparison | null>(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);

  async function refreshList() {
    if (!patient) return;
    const found = await listAssessments(patient.id);
    setAssessments(found);
  }

  useEffect(() => {
    if (!patient) return;
    setError(null);
    listAssessments(patient.id)
      .then(setAssessments)
      .catch((err) => setError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  function selectAssessment(assessment: Assessment) {
    setSelectedId(assessment.id);
    setBaseline(null);
    setBaselineError(null);
    setMedicalHistory(assessment.medicalHistory ?? '');
    setDifficultSituations(assessment.difficultSituations ?? '');
    setAnxietyLevel(assessment.anxietyLevel ?? '');
    setInitialGoals(assessment.initialGoals ?? '');
    setClinicianNotes(assessment.clinicianNotes ?? '');
    setSsi4Frequency(assessment.ssi4Frequency ?? '');
    setSsi4Duration(assessment.ssi4Duration ?? '');
    setSsi4PhysicalConcomitants(assessment.ssi4PhysicalConcomitants ?? '');
    setSsi4Total(assessment.ssi4Total ?? '');
    setSeverityCategory(assessment.severityCategory ?? 'MILD');
  }

  async function handleCreate() {
    if (!patient) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createAssessment(patient.id, newType);
      await refreshList();
      selectAssessment(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setCreating(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!patient || !selected) return;
    setSaveError(null);
    setSaving(true);
    try {
      await updateAssessment(patient.id, selected.id, {
        medicalHistory,
        difficultSituations,
        anxietyLevel,
        initialGoals,
        clinicianNotes,
        ssi4Frequency: ssi4Frequency === '' ? undefined : ssi4Frequency,
        ssi4Duration: ssi4Duration === '' ? undefined : ssi4Duration,
        ssi4PhysicalConcomitants: ssi4PhysicalConcomitants === '' ? undefined : ssi4PhysicalConcomitants,
        ssi4Total: ssi4Total === '' ? undefined : ssi4Total,
      });
      await refreshList();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (!patient || !selected) return;
    setApproving(true);
    setSaveError(null);
    try {
      const approved = await approveAssessment(patient.id, selected.id, severityCategory);
      await refreshList();
      selectAssessment(approved);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setApproving(false);
    }
  }

  async function handleShowBaseline() {
    if (!patient || !selected) return;
    setBaselineError(null);
    setLoadingBaseline(true);
    try {
      const comparison = await getBaselineComparison(patient.id, selected.id);
      setBaseline(comparison);
    } catch (err) {
      setBaselineError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setLoadingBaseline(false);
    }
  }

  if (!patient) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.patientDetail.assessmentsTitle}</Title>

      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {assessments === null ? null : assessments.length === 0 ? (
        <Text c="dimmed" mb="sm">{ar.patientDetail.noAssessments}</Text>
      ) : (
        <Table mb="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ar.patientDetail.assessmentTypeLabel}</Table.Th>
              <Table.Th>{ar.patientDetail.assessmentStatusLabel}</Table.Th>
              <Table.Th>{ar.patientDetail.assessmentDateLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {assessments.map((assessment) => (
              <Table.Tr
                key={assessment.id}
                data-testid={`assessment-row-${assessment.id}`}
                onClick={() => selectAssessment(assessment)}
                style={{ cursor: 'pointer' }}
              >
                <Table.Td>{ar.patientDetail.assessmentTypes[assessment.type]}</Table.Td>
                <Table.Td>
                  <Badge color={assessment.status === 'APPROVED' ? 'green' : 'yellow'}>
                    {ar.patientDetail.assessmentStatuses[assessment.status]}
                  </Badge>
                </Table.Td>
                <Table.Td>{formatDate(assessment.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {canEdit ? (
        <Group mb="md">
          <Select
            data={[
              { value: 'INITIAL', label: ar.patientDetail.assessmentTypes.INITIAL },
              { value: 'PERIODIC', label: ar.patientDetail.assessmentTypes.PERIODIC },
              { value: 'FINAL', label: ar.patientDetail.assessmentTypes.FINAL },
            ]}
            value={newType}
            onChange={(value) => setNewType((value as AssessmentType) ?? 'INITIAL')}
          />
          <Button onClick={handleCreate} loading={creating}>{ar.patientDetail.newAssessmentButton}</Button>
        </Group>
      ) : null}

      {selected ? (
        <Card withBorder>
          {saveError ? <Alert color="red" mb="sm">{saveError}</Alert> : null}
          {selected.status === 'DRAFT' && canEdit ? (
            <form data-testid="assessment-intake-form" onSubmit={handleSave}>
              <Stack>
                <Textarea label={ar.patientDetail.medicalHistoryLabel} value={medicalHistory} onChange={(e) => setMedicalHistory(e.currentTarget.value)} />
                <Textarea label={ar.patientDetail.difficultSituationsLabel} value={difficultSituations} onChange={(e) => setDifficultSituations(e.currentTarget.value)} />
                <Textarea label={ar.patientDetail.anxietyLevelLabel} value={anxietyLevel} onChange={(e) => setAnxietyLevel(e.currentTarget.value)} />
                <Textarea label={ar.patientDetail.initialGoalsLabel} value={initialGoals} onChange={(e) => setInitialGoals(e.currentTarget.value)} />
                <Textarea label={ar.patientDetail.clinicianNotesLabel} value={clinicianNotes} onChange={(e) => setClinicianNotes(e.currentTarget.value)} />
                <NumberInput label={ar.patientDetail.ssi4FrequencyLabel} value={ssi4Frequency} onChange={(v) => setSsi4Frequency(typeof v === 'number' ? v : '')} min={0} />
                <NumberInput label={ar.patientDetail.ssi4DurationLabel} value={ssi4Duration} onChange={(v) => setSsi4Duration(typeof v === 'number' ? v : '')} min={0} />
                <NumberInput label={ar.patientDetail.ssi4PhysicalConcomitantsLabel} value={ssi4PhysicalConcomitants} onChange={(v) => setSsi4PhysicalConcomitants(typeof v === 'number' ? v : '')} min={0} />
                <NumberInput label={ar.patientDetail.ssi4TotalLabel} value={ssi4Total} onChange={(v) => setSsi4Total(typeof v === 'number' ? v : '')} min={0} />
                <Group>
                  <Button type="submit" loading={saving}>{ar.patientDetail.saveButton}</Button>
                </Group>
              </Stack>
            </form>
          ) : (
            <Stack gap="xs">
              <Text><b>{ar.patientDetail.medicalHistoryLabel}:</b> {selected.medicalHistory ?? '—'}</Text>
              <Text><b>{ar.patientDetail.difficultSituationsLabel}:</b> {selected.difficultSituations ?? '—'}</Text>
              <Text><b>{ar.patientDetail.anxietyLevelLabel}:</b> {selected.anxietyLevel ?? '—'}</Text>
              <Text><b>{ar.patientDetail.initialGoalsLabel}:</b> {selected.initialGoals ?? '—'}</Text>
              <Text><b>{ar.patientDetail.ssi4TotalLabel}:</b> {selected.ssi4Total ?? '—'}</Text>
              {selected.severityCategory ? (
                <Text><b>{ar.patientDetail.severityCategoryLabel}:</b> {ar.patientDetail.severityCategories[selected.severityCategory]}</Text>
              ) : null}
            </Stack>
          )}

          {selected.status === 'DRAFT' && canEdit ? (
            <Group mt="md">
              <Select
                data={[
                  { value: 'MILD', label: ar.patientDetail.severityCategories.MILD },
                  { value: 'MODERATE', label: ar.patientDetail.severityCategories.MODERATE },
                  { value: 'SEVERE', label: ar.patientDetail.severityCategories.SEVERE },
                  { value: 'VERY_SEVERE', label: ar.patientDetail.severityCategories.VERY_SEVERE },
                ]}
                value={severityCategory}
                onChange={(value) => setSeverityCategory((value as SeverityCategory) ?? 'MILD')}
              />
              <Button color="green" onClick={handleApprove} loading={approving}>{ar.patientDetail.approveButton}</Button>
            </Group>
          ) : null}

          {selected.status === 'APPROVED' ? (
            <Group mt="md">
              <Button variant="light" onClick={handleShowBaseline} loading={loadingBaseline}>{ar.patientDetail.baselineComparisonButton}</Button>
            </Group>
          ) : null}

          {baselineError ? <Alert color="red" mt="sm">{baselineError}</Alert> : null}

          {baseline ? (
            <Stack gap={4} mt="sm">
              <Text fw={600}>{ar.patientDetail.baselineComparisonTitle}</Text>
              {baseline.delta ? (
                <>
                  <Text>{ar.patientDetail.ssi4FrequencyLabel}: {baseline.delta.ssi4FrequencyDelta}</Text>
                  <Text>{ar.patientDetail.ssi4DurationLabel}: {baseline.delta.ssi4DurationDelta}</Text>
                  <Text>{ar.patientDetail.ssi4PhysicalConcomitantsLabel}: {baseline.delta.ssi4PhysicalConcomitantsDelta}</Text>
                  <Text>{ar.patientDetail.ssi4TotalLabel}: {baseline.delta.ssi4TotalDelta}</Text>
                </>
              ) : (
                <Text c="dimmed">{ar.patientDetail.noBaselineYet}</Text>
              )}
            </Stack>
          ) : null}
        </Card>
      ) : null}
    </Card>
  );
}
