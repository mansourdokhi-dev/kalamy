import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Title, Text, Stack, Group, Button, Select, TextInput, NumberInput, Table, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canEditClinicalData } from '../auth/permissions';
import { listAssessments } from '../api/assessments';
import type { Assessment } from '../api/assessments';
import {
  listTreatmentPlans,
  createTreatmentPlan,
  transitionPhase,
  linkExercise,
  listPlanExercises,
  unlinkExercise,
} from '../api/treatment-plans';
import type { TreatmentPlan, TreatmentPhase, PlanExercise } from '../api/treatment-plans';
import { listExercises } from '../api/exercises';
import type { Exercise } from '../api/exercises';
import { ApiError } from '../api/client';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ar-SA');
}

const PHASES: TreatmentPhase[] = ['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5'];

export function TreatmentPlanSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();
  const canEdit = user ? canEditClinicalData(user.role) : false;

  const [activePlan, setActivePlan] = useState<TreatmentPlan | null | undefined>(undefined);
  const [pastPlans, setPastPlans] = useState<TreatmentPlan[]>([]);
  const [planExercises, setPlanExercises] = useState<PlanExercise[]>([]);
  const [approvedAssessments, setApprovedAssessments] = useState<Assessment[]>([]);
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [goals, setGoals] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [creatingPlan, setCreatingPlan] = useState(false);

  const [toPhase, setToPhase] = useState<TreatmentPhase>('PHASE_1');
  const [rationale, setRationale] = useState('');
  const [transitioning, setTransitioning] = useState(false);

  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [frequencyPerWeek, setFrequencyPerWeek] = useState<number | ''>('');
  const [sequence, setSequence] = useState<number | ''>('');
  const [linkingExercise, setLinkingExercise] = useState(false);

  async function loadAll() {
    if (!patient) return;
    setError(null);
    try {
      const [all, assessments, exerciseCatalog] = await Promise.all([
        listTreatmentPlans(patient.id),
        listAssessments(patient.id),
        listExercises(),
      ]);
      const active = all.find((plan) => plan.status === 'ACTIVE') ?? null;
      setActivePlan(active);
      setPastPlans(all.filter((plan) => plan.status !== 'ACTIVE'));
      setApprovedAssessments(assessments.filter((a) => a.status === 'APPROVED'));
      setCatalog(exerciseCatalog);
      if (active) {
        const nextPhaseIndex = Math.min(PHASES.indexOf(active.phase) + 1, PHASES.length - 1);
        setToPhase(PHASES[nextPhaseIndex]);
        const exercises = await listPlanExercises(patient.id, active.id);
        setPlanExercises(exercises);
      } else {
        setPlanExercises([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  async function handleCreatePlan(event: FormEvent) {
    event.preventDefault();
    if (!patient || !assessmentId || !goals || !reviewDate) return;
    setCreatingPlan(true);
    setError(null);
    try {
      await createTreatmentPlan(patient.id, { assessmentId, goals, reviewDate });
      setGoals('');
      setReviewDate('');
      setAssessmentId(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setCreatingPlan(false);
    }
  }

  async function handleTransitionPhase(event: FormEvent) {
    event.preventDefault();
    if (!patient || !activePlan) return;
    setTransitioning(true);
    setError(null);
    try {
      await transitionPhase(patient.id, activePlan.id, { toPhase, rationale: rationale || undefined });
      setRationale('');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setTransitioning(false);
    }
  }

  async function handleLinkExercise(event: FormEvent) {
    event.preventDefault();
    if (!patient || !activePlan || !exerciseId || frequencyPerWeek === '' || sequence === '') return;
    setLinkingExercise(true);
    setError(null);
    try {
      await linkExercise(patient.id, activePlan.id, { exerciseId, frequencyPerWeek, sequence });
      setExerciseId(null);
      setFrequencyPerWeek('');
      setSequence('');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setLinkingExercise(false);
    }
  }

  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  async function handleUnlink(targetExerciseId: string) {
    if (!patient || !activePlan) return;
    setUnlinkingId(targetExerciseId);
    setError(null);
    try {
      await unlinkExercise(patient.id, activePlan.id, targetExerciseId);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setUnlinkingId(null);
    }
  }

  if (!patient) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.patientDetail.treatmentPlanTitle}</Title>

      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {activePlan === undefined ? null : activePlan ? (
        <Stack gap="xs" mb="md">
          <Text><b>{ar.patientDetail.goalsLabel}:</b> {activePlan.goals}</Text>
          <Text><b>{ar.patientDetail.phaseLabel}:</b> {ar.patientDetail.phases[activePlan.phase]}</Text>
          <Text><b>{ar.patientDetail.reviewDateLabel}:</b> {formatDate(activePlan.reviewDate)}</Text>

          <Text fw={600} mt="sm">{ar.patientDetail.linkedExercisesTitle}</Text>
          {planExercises.length === 0 ? (
            <Text c="dimmed">{ar.patientDetail.noLinkedExercises}</Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{ar.patientDetail.exerciseTitleLabel}</Table.Th>
                  <Table.Th>{ar.patientDetail.frequencyLabel}</Table.Th>
                  <Table.Th>{ar.patientDetail.sequenceLabel}</Table.Th>
                  {canEdit ? <Table.Th /> : null}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {planExercises.map((pe) => (
                  <Table.Tr key={pe.id}>
                    <Table.Td>{pe.exercise.title}</Table.Td>
                    <Table.Td>{pe.frequencyPerWeek}</Table.Td>
                    <Table.Td>{pe.sequence}</Table.Td>
                    {canEdit ? (
                      <Table.Td>
                        <Button
                          size="xs"
                          color="red"
                          variant="subtle"
                          loading={unlinkingId === pe.exerciseId}
                          onClick={() => handleUnlink(pe.exerciseId)}
                        >
                          {ar.patientDetail.removeExerciseButton}
                        </Button>
                      </Table.Td>
                    ) : null}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          {canEdit ? (
            <form data-testid="link-exercise-form" onSubmit={handleLinkExercise}>
              <Group align="flex-end" mt="sm">
                <Select
                  label={ar.patientDetail.exerciseTitleLabel}
                  data={catalog.map((ex) => ({ value: ex.id, label: ex.title }))}
                  value={exerciseId}
                  onChange={setExerciseId}
                />
                <NumberInput label={ar.patientDetail.frequencyLabel} value={frequencyPerWeek} onChange={(v) => setFrequencyPerWeek(typeof v === 'number' ? v : '')} min={1} max={21} />
                <NumberInput label={ar.patientDetail.sequenceLabel} value={sequence} onChange={(v) => setSequence(typeof v === 'number' ? v : '')} min={1} />
                <Button type="submit" loading={linkingExercise}>{ar.patientDetail.addExerciseButton}</Button>
              </Group>
            </form>
          ) : null}

          {canEdit ? (
            <form data-testid="phase-transition-form" onSubmit={handleTransitionPhase}>
              <Group align="flex-end" mt="md">
                <Select
                  label={ar.patientDetail.transitionToPhaseLabel}
                  data={PHASES.map((phase) => ({ value: phase, label: ar.patientDetail.phases[phase] }))}
                  value={toPhase}
                  onChange={(value) => setToPhase((value as TreatmentPhase) ?? 'PHASE_1')}
                />
                <TextInput label={ar.patientDetail.rationaleLabel} value={rationale} onChange={(e) => setRationale(e.currentTarget.value)} />
                <Button type="submit" loading={transitioning}>{ar.patientDetail.transitionButton}</Button>
              </Group>
            </form>
          ) : null}
        </Stack>
      ) : (
        <Text c="dimmed" mb="md">{ar.patientDetail.noActivePlan}</Text>
      )}

      {canEdit ? (
        <form data-testid="new-plan-form" onSubmit={handleCreatePlan}>
          <Title order={4} mb="xs">{ar.patientDetail.newPlanTitle}</Title>
          <Group align="flex-end">
            <Select
              label={ar.patientDetail.assessmentLabel}
              data={approvedAssessments.map((a) => ({ value: a.id, label: `${ar.patientDetail.assessmentTypes[a.type]} — ${formatDate(a.createdAt)}` }))}
              value={assessmentId}
              onChange={setAssessmentId}
            />
            <TextInput label={ar.patientDetail.goalsLabel} value={goals} onChange={(e) => setGoals(e.currentTarget.value)} />
            <TextInput type="date" label={ar.patientDetail.reviewDateLabel} value={reviewDate} onChange={(e) => setReviewDate(e.currentTarget.value)} />
            <Button type="submit" loading={creatingPlan}>{ar.patientDetail.createPlanButton}</Button>
          </Group>
        </form>
      ) : null}

      {pastPlans.length > 0 ? (
        <Stack mt="lg">
          <Text fw={600}>{ar.patientDetail.pastPlansTitle}</Text>
          {pastPlans.map((plan) => (
            <Text key={plan.id} c="dimmed">
              {ar.patientDetail.phases[plan.phase]} — {formatDate(plan.createdAt)}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Card>
  );
}
