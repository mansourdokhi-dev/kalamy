import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { forgotPassword } from '../src/api/auth';
import { ApiError } from '../src/api/client';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword({ mobile });
      router.push({ pathname: '/reset-password', params: { mobile } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.forgotPassword.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <TextField testID="mobile-input" label={ar.forgotPassword.mobile} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
      <Button title={ar.forgotPassword.submit} onPress={handleSubmit} loading={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
});
