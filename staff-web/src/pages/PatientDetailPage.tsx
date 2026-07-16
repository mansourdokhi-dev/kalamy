import { useParams } from 'react-router-dom';
import { Container, Title, Badge, Group, Loader, Alert, Stack } from '@mantine/core';
import { ar } from '../copy/ar';
import { PatientDetailProvider, usePatientDetail } from '../patients/PatientDetailContext';
import { ProfileSection } from '../patients/ProfileSection';
import { AssessmentsSection } from '../patients/AssessmentsSection';
import { TreatmentPlanSection } from '../patients/TreatmentPlanSection';
import { ReportsSection } from '../patients/ReportsSection';
import { SampleReviewSection } from '../patients/SampleReviewSection';
import { ProgressSection } from '../patients/ProgressSection';

function PatientDetailContent() {
  const { patient, loading, error } = usePatientDetail();

  if (loading) {
    return <Loader />;
  }
  if (error || !patient) {
    return <Alert color="red">{error ?? ar.patientDetail.loadError}</Alert>;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{patient.fullName}</Title>
        <Badge color={patient.status === 'ACTIVE' ? 'green' : 'gray'}>
          {ar.patients.statuses[patient.status]}
        </Badge>
      </Group>
      <ProfileSection />
      <AssessmentsSection />
      <TreatmentPlanSection />
      <ReportsSection />
      <SampleReviewSection />
      <ProgressSection />
    </Stack>
  );
}

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return null;
  }
  return (
    <Container size="lg">
      <PatientDetailProvider patientId={id}>
        <PatientDetailContent />
      </PatientDetailProvider>
    </Container>
  );
}
