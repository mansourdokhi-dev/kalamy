import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { resetPassword } from '../src/api/auth';
import { ApiError } from '../src/api/client';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { mobile } = useLocalSearchParams<{ mobile: string }>();
  const { tokens } = useTheme();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ mobile, code, newPassword });
      router.push('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.resetPassword.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <TextField testID="code-input" label={ar.resetPassword.code} value={code} onChangeText={setCode} keyboardType="number-pad" />
      <TextField testID="new-password-input" label={ar.resetPassword.newPassword} value={newPassword} onChangeText={setNewPassword} secureTextEntry />
      <Button title={ar.resetPassword.submit} onPress={handleSubmit} loading={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
});
