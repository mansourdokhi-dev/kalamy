import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { login } from '../src/api/auth';
import { saveToken } from '../src/storage/session';
import { ApiError } from '../src/api/client';
import { usePatientProfile } from '../src/patient/PatientProfileProvider';

export default function LoginScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { refresh: refreshPatientProfile } = usePatientProfile();

  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ mobile, password });
      await saveToken(result.token);
      // The profile provider is mounted at the root (while logged out), so it
      // holds stale not-found/error state from before this login — re-fetch now
      // that a token exists so /home renders the real profile, not that stale state.
      await refreshPatientProfile();
      router.push('/home');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(ar.login.locked);
      } else {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.login.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <TextField testID="mobile-input" label={ar.login.mobile} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
      <TextField testID="password-input" label={ar.login.password} value={password} onChangeText={setPassword} secureTextEntry />
      <Button title={ar.login.submit} onPress={handleSubmit} loading={submitting} />
      <View style={{ height: 16 }} />
      <Button title={ar.login.forgotPassword} onPress={() => router.push('/forgot-password')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
});
