import { useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Title, Text, Stack, Group, Button, TextInput, Textarea, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canEditClinicalData } from '../auth/permissions';
import { updatePatient, updatePatientStatus, lookupCaregiver, linkGuardian } from '../api/patients';
import { ApiError } from '../api/client';

export function ProfileSection() {
  const { patient, refresh } = usePatientDetail();
  const { user } = useAuth();
  const canEdit = user ? canEditClinicalData(user.role) : false;

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [initialDiagnosis, setInitialDiagnosis] = useState('');
  const [medicalHistory, setMedicalHistory] = useState('');
  const [medications, setMedications] = useState('');
  const [allergies, setAllergies] = useState('');
  const [familyHistory, setFamilyHistory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [guardianMobile, setGuardianMobile] = useState('');
  const [linkingGuardian, setLinkingGuardian] = useState(false);
  const [guardianError, setGuardianError] = useState<string | null>(null);

  if (!patient) {
    return null;
  }

  // Captured as its own const so nested function declarations below retain the
  // non-null narrowing (TS does not carry the `if (!patient) return null` narrowing
  // of `patient` itself into nested function bodies).
  const currentPatient = patient;

  function startEditing() {
    setFullName(currentPatient.fullName);
    setAddress(currentPatient.address ?? '');
    setReferralSource(currentPatient.referralSource ?? '');
    setInitialDiagnosis(currentPatient.clinicalInfo?.initialDiagnosis ?? '');
    setMedicalHistory(currentPatient.clinicalInfo?.medicalHistory ?? '');
    setMedications(currentPatient.clinicalInfo?.medications ?? '');
    setAllergies(currentPatient.clinicalInfo?.allergies ?? '');
    setFamilyHistory(currentPatient.clinicalInfo?.familyHistory ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updatePatient(currentPatient.id, {
        fullName,
        address,
        referralSource,
        clinicalInfo: { initialDiagnosis, medicalHistory, medications, allergies, familyHistory },
      });
      await refresh();
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus() {
    const nextStatus = currentPatient.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await updatePatientStatus(currentPatient.id, nextStatus);
    await refresh();
  }

  async function handleLinkGuardian(event: FormEvent) {
    event.preventDefault();
    setGuardianError(null);
    setLinkingGuardian(true);
    try {
      const found = await lookupCaregiver(guardianMobile);
      await linkGuardian(currentPatient.id, { guardianUserId: found.userId, relationship: 'GUARDIAN' });
      setGuardianMobile('');
      await refresh();
    } catch (err) {
      setGuardianError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setLinkingGuardian(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.patientDetail.profileTitle}</Title>

      {editing ? (
        <form data-testid="profile-edit-form" onSubmit={handleSubmit}>
          <Stack>
            {error ? <Alert color="red">{error}</Alert> : null}
            <TextInput label={ar.patientDetail.fullNameLabel} value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
            <TextInput label={ar.patientDetail.addressLabel} value={address} onChange={(e) => setAddress(e.currentTarget.value)} />
            <TextInput label={ar.patientDetail.referralSourceLabel} value={referralSource} onChange={(e) => setReferralSource(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.initialDiagnosisLabel} value={initialDiagnosis} onChange={(e) => setInitialDiagnosis(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.medicalHistoryLabel} value={medicalHistory} onChange={(e) => setMedicalHistory(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.medicationsLabel} value={medications} onChange={(e) => setMedications(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.allergiesLabel} value={allergies} onChange={(e) => setAllergies(e.currentTarget.value)} />
            <Textarea label={ar.patientDetail.familyHistoryLabel} value={familyHistory} onChange={(e) => setFamilyHistory(e.currentTarget.value)} />
            <Group>
              <Button type="submit" loading={submitting}>{ar.patientDetail.saveButton}</Button>
              <Button variant="subtle" onClick={() => setEditing(false)}>{ar.patientDetail.cancelButton}</Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <Stack gap="xs">
          <Text><b>{ar.patientDetail.fullNameLabel}:</b> {patient.fullName}</Text>
          <Text><b>{ar.patientDetail.nationalIdLabel}:</b> {patient.nationalId}</Text>
          <Text><b>{ar.patientDetail.addressLabel}:</b> {patient.address ?? '—'}</Text>
          <Text><b>{ar.patientDetail.referralSourceLabel}:</b> {patient.referralSource ?? '—'}</Text>
          <Text><b>{ar.patientDetail.initialDiagnosisLabel}:</b> {patient.clinicalInfo?.initialDiagnosis ?? '—'}</Text>
          <Text><b>{ar.patientDetail.medicalHistoryLabel}:</b> {patient.clinicalInfo?.medicalHistory ?? '—'}</Text>
          <Text><b>{ar.patientDetail.medicationsLabel}:</b> {patient.clinicalInfo?.medications ?? '—'}</Text>
          <Text><b>{ar.patientDetail.allergiesLabel}:</b> {patient.clinicalInfo?.allergies ?? '—'}</Text>
          <Text><b>{ar.patientDetail.familyHistoryLabel}:</b> {patient.clinicalInfo?.familyHistory ?? '—'}</Text>
          {canEdit ? (
            <Group mt="sm">
              <Button onClick={startEditing}>{ar.patientDetail.editButton}</Button>
              <Button color={patient.status === 'ACTIVE' ? 'red' : 'green'} variant="outline" onClick={toggleStatus}>
                {patient.status === 'ACTIVE' ? ar.patientDetail.disableButton : ar.patientDetail.enableButton}
              </Button>
            </Group>
          ) : null}
        </Stack>
      )}

      {canEdit ? (
        <>
          <Title order={4} mt="lg" mb="xs">{ar.patientDetail.linkGuardianTitle}</Title>
          <form data-testid="link-guardian-form" onSubmit={handleLinkGuardian}>
            <Group align="flex-end">
              {guardianError ? <Alert color="red">{guardianError}</Alert> : null}
              <TextInput
                label={ar.patientDetail.guardianMobileLabel}
                value={guardianMobile}
                onChange={(e) => setGuardianMobile(e.currentTarget.value)}
              />
              <Button type="submit" loading={linkingGuardian}>{ar.patientDetail.linkGuardianButton}</Button>
            </Group>
          </form>
        </>
      ) : null}
    </Card>
  );
}
