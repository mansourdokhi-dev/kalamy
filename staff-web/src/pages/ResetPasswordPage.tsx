import { useState } from 'react';
import { Container, Title, TextInput, PasswordInput, Button, Alert, Stack } from '@mantine/core';
import { useNavigate, useLocation } from 'react-router-dom';
import { ar } from '../copy/ar';
import { resetPassword } from '../api/auth';
import { ApiError } from '../api/client';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = (location.state as { mobile?: string } | null)?.mobile ?? '';
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ mobile, code, newPassword });
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} my={80}>
      <Title order={2} ta="center" mb="lg">{ar.resetPassword.title}</Title>
      <form onSubmit={handleSubmit}>
        <Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <TextInput label={ar.resetPassword.codeLabel} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
          <PasswordInput label={ar.resetPassword.newPasswordLabel} value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
          <Button type="submit" loading={submitting} fullWidth>{ar.resetPassword.submitButton}</Button>
        </Stack>
      </form>
    </Container>
  );
}
