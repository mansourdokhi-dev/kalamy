import { useEffect, useState } from 'react';
import { Card, Title, Text, Stack, Group, Select, NumberInput, Textarea, Button, Alert, MultiSelect } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canReviewSample } from '../auth/permissions';
import { getCurrentCycle } from '../api/cycles';
import type { TrainingCycle, SpecialistDecision } from '../api/cycles';
import { reviewSample } from '../api/specialist-review';
import { ApiError } from '../api/client';

const REVIEW_RELEVANT_STATUSES = new Set([
  'WAITING_FOR_SPECIALIST',
  'UNDER_REVIEW',
  'DIRECT_INTERVENTION_REQUIRED',
  'WAITING_FINAL_DECISION_AFTER_INTERVENTION',
  'TECHNICAL_PARTIAL_RERECORD',
]);

// Mirrors the backend's own `reviewableStatuses` guard in `review()`
// (`specialist-review.service.ts`) exactly: a decision can only ever be
// submitted from these two statuses. `DIRECT_INTERVENTION_REQUIRED` and
// `TECHNICAL_PARTIAL_RERECORD` are in REVIEW_RELEVANT_STATUSES above (so the
// section still shows the read-only sample detail) but NOT here, so the
// decision form itself doesn't render for them — submitting from either
// would 409 on the backend.
const DECISION_SUBMITTABLE_STATUSES = new Set(['UNDER_REVIEW', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION']);

export function SampleReviewSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();

  const [cycle, setCycle] = useState<TrainingCycle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [decision, setDecision] = useState<SpecialistDecision>('TRANSITION');
  const [clinicianOpinionScore, setClinicianOpinionScore] = useState<number | ''>('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [damagedPartIds, setDamagedPartIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient) return;
    getCurrentCycle(patient.id)
      .then(setCycle)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  if (!patient || !user || !canReviewSample(user.role)) {
    return null;
  }
  if (!cycle || !REVIEW_RELEVANT_STATUSES.has(cycle.status) || !cycle.speechSample) {
    return null;
  }

  const sample = cycle.speechSample;
  const isReservationHolder = sample.reservedByUserId === user.id;

  async function handleSubmitDecision() {
    if (!patient) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (decision === 'TECHNICAL_RERECORD') {
        await reviewSample(patient.id, { decision: 'TECHNICAL_RERECORD', damagedPartIds, reviewNotes: reviewNotes || undefined });
      } else {
        await reviewSample(patient.id, {
          decision,
          clinicianOpinionScore: clinicianOpinionScore === '' ? 0 : clinicianOpinionScore,
          reviewNotes,
        });
      }
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.sampleReview.title}</Title>
      {loadError ? <Alert color="red" mb="sm">{loadError}</Alert> : null}

      <Stack gap="xs" mb="md">
        <Text fw={600}>{ar.sampleReview.selfReportTitle}</Text>
        <Text>{ar.sampleReview.selfSeverityCurrentLabel}: {sample.selfSeverityCurrent ?? '—'}</Text>
        <Text>{ar.sampleReview.selfSeverityExpectedNextLabel}: {sample.selfSeverityExpectedNext ?? '—'}</Text>
        <Text>{ar.sampleReview.camperdownPerformanceLabel}: {sample.camperdownPerformanceRating ?? '—'}</Text>
        <Text>{ar.sampleReview.clientOpinionLabel}: {sample.clientOpinionScore ?? '—'}</Text>
      </Stack>

      {!isReservationHolder ? (
        <Alert color="yellow">{ar.sampleReview.reservedByOtherLabel}</Alert>
      ) : (
        <Stack gap="md">
          {submitError ? <Alert color="red">{submitError}</Alert> : null}
          {DECISION_SUBMITTABLE_STATUSES.has(cycle.status) ? (
            <>
              <Text fw={600}>{ar.sampleReview.decisionTitle}</Text>
              <Select
                label={ar.sampleReview.decisionLabel}
                data={[
                  { value: 'TRANSITION', label: ar.sampleReview.decisions.TRANSITION },
                  { value: 'LEVEL_REPEAT', label: ar.sampleReview.decisions.LEVEL_REPEAT },
                  { value: 'TECHNICAL_RERECORD', label: ar.sampleReview.decisions.TECHNICAL_RERECORD },
                ]}
                value={decision}
                onChange={(value) => setDecision((value as SpecialistDecision) ?? 'TRANSITION')}
              />
              {decision === 'TECHNICAL_RERECORD' ? (
                <MultiSelect
                  label={ar.sampleReview.damagedPartsLabel}
                  data={sample.parts.map((part) => ({ value: part.id, label: part.label }))}
                  value={damagedPartIds}
                  onChange={setDamagedPartIds}
                />
              ) : (
                <NumberInput
                  label={ar.sampleReview.clinicianOpinionScoreLabel}
                  value={clinicianOpinionScore}
                  onChange={(v) => setClinicianOpinionScore(typeof v === 'number' ? v : '')}
                  min={1}
                  max={9}
                />
              )}
              <Textarea
                label={ar.sampleReview.reviewNotesLabel}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.currentTarget.value)}
              />
              <Group>
                <Button onClick={handleSubmitDecision} loading={submitting}>{ar.sampleReview.submitDecisionButton}</Button>
              </Group>
            </>
          ) : null}
        </Stack>
      )}
    </Card>
  );
}
