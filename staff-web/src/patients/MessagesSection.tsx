import { useEffect, useState } from 'react';
import { Card, Title, Text, Stack, Group, Textarea, Button, Alert } from '@mantine/core';
import { ar } from '../copy/ar';
import { usePatientDetail } from './PatientDetailContext';
import { useAuth } from '../auth/AuthProvider';
import { canMessagePatient } from '../auth/permissions';
import { listMessages, sendMessage } from '../api/messages';
import type { PatientMessage } from '../api/messages';
import { ApiError } from '../api/client';

export function MessagesSection() {
  const { patient } = usePatientDetail();
  const { user } = useAuth();

  const [messages, setMessages] = useState<PatientMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!patient || !user || !canMessagePatient(user.role)) return;
    setLoadError(null);
    listMessages(patient.id)
      .then(setMessages)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ar.errors.unexpected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id, user?.role]);

  if (!patient || !user || !canMessagePatient(user.role)) {
    return null;
  }

  async function handleSend() {
    if (!patient || draft.trim().length === 0) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(patient.id, draft.trim());
      setDraft('');
      setMessages(await listMessages(patient.id));
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={3} mb="sm">{ar.messages.sectionTitle}</Title>
      {loadError ? <Alert color="red" mb="sm">{loadError}</Alert> : null}

      {messages !== null && messages.length === 0 ? (
        <Text c="dimmed">{ar.messages.empty}</Text>
      ) : (
        <Stack gap={4} mb="md">
          {(messages ?? []).map((message) => {
            const mine = message.senderUserId === user.id;
            return (
              <div key={message.id} data-testid={`message-${message.id}`} style={{ textAlign: mine ? 'start' : 'end' }}>
                <Text size="xs" c="dimmed">{mine ? ar.messages.fromMe : ar.messages.fromPatient}</Text>
                <Text>{message.body}</Text>
                {mine && message.readAt ? <Text size="xs" c="dimmed">{ar.messages.readLabel}</Text> : null}
              </div>
            );
          })}
        </Stack>
      )}

      <Stack gap="xs">
        {sendError ? <Alert color="red">{sendError}</Alert> : null}
        <Textarea
          data-testid="message-input"
          label={ar.messages.inputLabel}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
        />
        <Group>
          <Button onClick={handleSend} loading={sending} disabled={draft.trim().length === 0}>
            {ar.messages.sendButton}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
