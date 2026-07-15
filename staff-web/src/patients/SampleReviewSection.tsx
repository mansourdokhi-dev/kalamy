import { useEffect, useRef, useState } from 'react';
import { Card, Title, Text, Stack, Group, Select, NumberInput, Textarea, Button, Alert, MultiSelect } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canReviewSample } from '../auth/permissions';
import { getCurrentCycle } from '../api/cycles';
import type { TrainingCycle, SpecialistDecision, InterventionType } from '../api/cycles';
import { reviewSample, requestIntervention, completeIntervention } from '../api/specialist-review';
import { fetchSampleMediaBlob } from '../api/sample-media';
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

  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [loadingPartId, setLoadingPartId] = useState<string | null>(null);

  const [interventionType, setInterventionType] = useState<InterventionType>('VIDEO_MEETING');
  const [reasonNote, setReasonNote] = useState('');
  const [requestingIntervention, setRequestingIntervention] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [completingIntervention, setCompletingIntervention] = useState(false);
  const [interventionError, setInterventionError] = useState<string | null>(null);

  const mediaUrlsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    mediaUrlsRef.current = mediaUrls;
  }, [mediaUrls]);

  useEffect(() => {
    if (!patient) return;
    getCurrentCycle(patient.id)
      .then(setCycle)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // Revoke any blob URLs created for the previous patient/part set, both when
    // switching patients and on unmount, per the design doc's "on unmount/part-change" rule.
    return () => {
      Object.values(mediaUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      mediaUrlsRef.current = {};
      setMediaUrls({});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  if (!patient || !user || !canReviewSample(user.role)) {
    return null;
  }
  if (!cycle || !REVIEW_RELEVANT_STATUSES.has(cycle.status) || !cycle.speechSample) {
    return null;
  }

  const sample = cycle.speechSample;
  const cycleId = cycle.id;
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
      const fresh = await getCurrentCycle(patient.id);
      setCycle(fresh);
      setReviewNotes('');
      setDamagedPartIds([]);
      setClinicianOpinionScore('');
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePlayPart(partId: string) {
    if (!patient) return;
    setLoadingPartId(partId);
    setMediaError(null);
    try {
      const url = await fetchSampleMediaBlob(patient.id, partId);
      setMediaUrls((prev) => ({ ...prev, [partId]: url }));
    } catch (err) {
      setMediaError(err instanceof ApiError ? err.message : ar.sampleReview.mediaError);
    } finally {
      setLoadingPartId(null);
    }
  }

  async function handleRequestIntervention() {
    if (!patient) return;
    setRequestingIntervention(true);
    setInterventionError(null);
    try {
      await requestIntervention(cycleId, { interventionType, reasonNote });
      const fresh = await getCurrentCycle(patient.id);
      setCycle(fresh);
    } catch (err) {
      setInterventionError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setRequestingIntervention(false);
    }
  }

  async function handleCompleteIntervention() {
    if (!patient) return;
    setCompletingIntervention(true);
    setInterventionError(null);
    try {
      await completeIntervention(cycleId, { outcomeNotes });
      const fresh = await getCurrentCycle(patient.id);
      setCycle(fresh);
    } catch (err) {
      setInterventionError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setCompletingIntervention(false);
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

      <Stack gap="xs" mb="md">
        <Text fw={600}>{ar.sampleReview.partsTitle}</Text>
        {mediaError ? <Alert color="red">{mediaError}</Alert> : null}
        {sample.parts.map((part) => (
          <Group key={part.id}>
            <Text>{part.label}</Text>
            {mediaUrls[part.id] ? (
              part.mimeType?.startsWith('audio/') ? (
                <audio controls src={mediaUrls[part.id]} />
              ) : (
                <video controls width={240} src={mediaUrls[part.id]} />
              )
            ) : (
              <Button
                variant="light"
                size="xs"
                loading={loadingPartId === part.id}
                onClick={() => handlePlayPart(part.id)}
              >
                {ar.sampleReview.playButton}
              </Button>
            )}
          </Group>
        ))}
      </Stack>

      {isReservationHolder ? (
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
          {interventionError ? <Alert color="red">{interventionError}</Alert> : null}
          {cycle.status === 'UNDER_REVIEW' ? (
            <Stack gap="xs">
              <Text fw={600}>{ar.sampleReview.interventionTitle}</Text>
              <Select
                label={ar.sampleReview.interventionTypeLabel}
                data={[
                  { value: 'VIDEO_MEETING', label: ar.sampleReview.interventionTypes.VIDEO_MEETING },
                  { value: 'VOICE_CONSULTATION', label: ar.sampleReview.interventionTypes.VOICE_CONSULTATION },
                  { value: 'TARGETED_MESSAGE', label: ar.sampleReview.interventionTypes.TARGETED_MESSAGE },
                  { value: 'CLINICAL_ACTION', label: ar.sampleReview.interventionTypes.CLINICAL_ACTION },
                ]}
                value={interventionType}
                onChange={(value) => setInterventionType((value as InterventionType) ?? 'VIDEO_MEETING')}
              />
              <Textarea
                label={ar.sampleReview.interventionReasonLabel}
                value={reasonNote}
                onChange={(e) => setReasonNote(e.currentTarget.value)}
              />
              <Group>
                <Button variant="light" onClick={handleRequestIntervention} loading={requestingIntervention}>
                  {ar.sampleReview.requestInterventionButton}
                </Button>
              </Group>
            </Stack>
          ) : null}
          {cycle.status === 'DIRECT_INTERVENTION_REQUIRED' ? (
            <Stack gap="xs">
              <Textarea
                label={ar.sampleReview.interventionOutcomeLabel}
                value={outcomeNotes}
                onChange={(e) => setOutcomeNotes(e.currentTarget.value)}
              />
              <Group>
                <Button variant="light" onClick={handleCompleteIntervention} loading={completingIntervention}>
                  {ar.sampleReview.completeInterventionButton}
                </Button>
              </Group>
            </Stack>
          ) : null}
        </Stack>
      ) : sample.reservedByUserId ? (
        <Alert color="yellow">{ar.sampleReview.reservedByOtherLabel}</Alert>
      ) : (
        <Alert color="gray">{ar.sampleReview.notYetReservedLabel}</Alert>
      )}
    </Card>
  );
}
