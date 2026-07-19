import { useEffect, useState } from 'react';
import { Card, Title, Text, Stack, Divider, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canViewQuestionnaires } from '../auth/permissions';
import { listResponses } from '../api/questionnaires';
import type { QuestionnaireResponse } from '../api/questionnaires';
import { ApiError } from '../api/client';

export function QuestionnaireResponsesSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();

  const [responses, setResponses] = useState<QuestionnaireResponse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient || !user || !canViewQuestionnaires(user.role)) return;
    setLoadError(null);
    listResponses(patient.id)
      .then(setResponses)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id, user?.role]);

  if (!patient || !user || !canViewQuestionnaires(user.role)) {
    return null;
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.questionnaires.responsesTitle}</Title>
      {loadError ? <Alert color="red" mb="sm">{loadError}</Alert> : null}

      {responses !== null && responses.length === 0 ? (
        <Text c="dimmed">{ar.questionnaires.noResponses}</Text>
      ) : (
        <Stack>
          {(responses ?? []).map((response) => {
            const questionText = new Map(response.template.questions.map((q) => [q.id, q.text]));
            return (
              <Card key={response.id} withBorder padding="sm" data-testid={`response-${response.id}`}>
                <Text fw={600}>{response.template.title}</Text>
                <Text size="xs" c="dimmed">
                  {ar.questionnaires.submittedAtLabel}: {new Date(response.submittedAt).toLocaleString('ar-SA')}
                </Text>
                <Divider my="xs" />
                <Stack gap={4}>
                  {response.answers.map((answer) => (
                    <div key={answer.id}>
                      <Text size="sm" fw={500}>{questionText.get(answer.questionId) ?? answer.questionId}</Text>
                      <Text size="sm">{answer.value}</Text>
                    </div>
                  ))}
                </Stack>
              </Card>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}
