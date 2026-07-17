import { useEffect, useState } from 'react';
import { Card, Title, Text, Stack, Group, Select, TextInput, Textarea, Button, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canManageConsultation } from '../auth/permissions';
import { listConsultations, updateConsultation } from '../api/consultations';
import type { Consultation, UpdateConsultationInput } from '../api/consultations';
import { ApiError } from '../api/client';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'CANCELLED']);

type EditableStatus = NonNullable<UpdateConsultationInput['status']>;

function typeLabel(type: Consultation['type']): string {
  return ar.consultation.types[type];
}

function statusLabel(status: Consultation['status']): string {
  return ar.consultation.statuses[status];
}

export function ConsultationSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();

  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [status, setStatus] = useState<EditableStatus | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [externalMeetingLink, setExternalMeetingLink] = useState('');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient) return;
    setLoadError(null);
    listConsultations(patient.id)
      .then(setConsultations)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  if (!patient || !user || !canManageConsultation(user.role)) {
    return null;
  }

  const active = consultations?.find((c) => !TERMINAL_STATUSES.has(c.status)) ?? null;

  async function handleSave() {
    if (!patient || !active || !status) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input: Parameters<typeof updateConsultation>[1] = { status };
      if (scheduledAt) input.scheduledAt = new Date(scheduledAt).toISOString();
      if (externalMeetingLink) input.externalMeetingLink = externalMeetingLink;
      if (outcomeNotes) input.outcomeNotes = outcomeNotes;
      await updateConsultation(active.id, input);
      const fresh = await listConsultations(patient.id);
      setConsultations(fresh);
      setScheduledAt('');
      setExternalMeetingLink('');
      setOutcomeNotes('');
      setStatus(null);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.consultation.sectionTitle}</Title>
      {loadError ? <Alert color="red" mb="sm">{loadError}</Alert> : null}

      {consultations !== null && consultations.length === 0 ? (
        <Text c="dimmed">{ar.consultation.noConsultations}</Text>
      ) : (
        (consultations ?? []).map((consultation) => (
          <Stack key={consultation.id} gap={4} mb="md">
            <Text>{ar.consultation.typeLabel}: {typeLabel(consultation.type)}</Text>
            <Text>{ar.consultation.statusLabel}: {statusLabel(consultation.status)}</Text>
            {consultation.reasonNote ? <Text>{consultation.reasonNote}</Text> : null}
            {consultation.scheduledAt ? <Text>{ar.consultation.scheduledAtLabel}: {consultation.scheduledAt}</Text> : null}
            {consultation.externalMeetingLink ? <Text>{ar.consultation.meetingLinkLabel}: {consultation.externalMeetingLink}</Text> : null}
            {consultation.outcomeNotes ? <Text>{ar.consultation.outcomeNotesLabel}: {consultation.outcomeNotes}</Text> : null}
          </Stack>
        ))
      )}

      {active ? (
        <Stack gap="xs">
          {saveError ? <Alert color="red">{saveError}</Alert> : null}
          <Select
            data-testid="consultation-status-select"
            label={ar.consultation.statusSelectLabel}
            data={[
              { value: 'SCHEDULING', label: ar.consultation.statuses.SCHEDULING },
              { value: 'SCHEDULED', label: ar.consultation.statuses.SCHEDULED },
              { value: 'COMPLETED', label: ar.consultation.statuses.COMPLETED },
              { value: 'CANCELLED', label: ar.consultation.statuses.CANCELLED },
            ]}
            value={status}
            onChange={(value) => setStatus((value as EditableStatus) ?? null)}
          />
          <TextInput
            data-testid="consultation-scheduled-input"
            type="datetime-local"
            label={ar.consultation.scheduledAtLabel}
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.currentTarget.value)}
          />
          <TextInput
            data-testid="consultation-link-input"
            label={ar.consultation.meetingLinkLabel}
            value={externalMeetingLink}
            onChange={(e) => setExternalMeetingLink(e.currentTarget.value)}
          />
          <Textarea
            data-testid="consultation-outcome-input"
            label={ar.consultation.outcomeNotesLabel}
            value={outcomeNotes}
            onChange={(e) => setOutcomeNotes(e.currentTarget.value)}
          />
          <Group>
            <Button onClick={handleSave} loading={saving} disabled={!status}>{ar.consultation.saveButton}</Button>
          </Group>
        </Stack>
      ) : null}
    </Card>
  );
}
