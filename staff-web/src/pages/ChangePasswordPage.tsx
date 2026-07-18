import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Title, Text, PasswordInput, Button, Alert, Stack } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { changePassword } from '../api/auth';
import { ApiError } from '../api/client';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      await refreshUser();
      navigate('/patients');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} my={80}>
      <Title order={2} ta="center" mb="xs">{ar.changePassword.title}</Title>
      <Text ta="center" c="dimmed" mb="lg">{ar.changePassword.description}</Text>
      <form onSubmit={handleSubmit}>
        <Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <PasswordInput label={ar.changePassword.currentPasswordLabel} value={currentPassword} onChange={(e) => setCurrentPassword(e.currentTarget.value)} />
          <PasswordInput label={ar.changePassword.newPasswordLabel} value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
          <Button type="submit" loading={submitting} fullWidth>{ar.changePassword.submitButton}</Button>
        </Stack>
      </form>
    </Container>
  );
}
