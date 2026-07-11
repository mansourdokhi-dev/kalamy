import { useState } from 'react';
import { Container, Title, TextInput, PasswordInput, Button, Alert, Anchor, Stack } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(mobile, password);
      navigate('/patients');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} my={80}>
      <Title order={2} ta="center" mb="lg">{ar.login.title}</Title>
      <form onSubmit={handleSubmit}>
        <Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <TextInput label={ar.login.mobileLabel} value={mobile} onChange={(e) => setMobile(e.currentTarget.value)} />
          <PasswordInput label={ar.login.passwordLabel} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Button type="submit" loading={submitting} fullWidth>{ar.login.submitButton}</Button>
          <Anchor component={Link} to="/forgot-password" ta="center" size="sm">
            {ar.login.forgotPasswordLink}
          </Anchor>
        </Stack>
      </form>
    </Container>
  );
}
