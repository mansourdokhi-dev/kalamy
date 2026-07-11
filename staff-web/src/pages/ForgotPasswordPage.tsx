import { useState } from 'react';
import { Container, Title, TextInput, Button, Alert, Stack } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { forgotPassword } from '../api/auth';
import { ApiError } from '../api/client';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword({ mobile });
      navigate('/reset-password', { state: { mobile } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} my={80}>
      <Title order={2} ta="center" mb="lg">{ar.forgotPassword.title}</Title>
      <form onSubmit={handleSubmit}>
        <Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <TextInput label={ar.forgotPassword.mobileLabel} value={mobile} onChange={(e) => setMobile(e.currentTarget.value)} />
          <Button type="submit" loading={submitting} fullWidth>{ar.forgotPassword.submitButton}</Button>
        </Stack>
      </form>
    </Container>
  );
}
