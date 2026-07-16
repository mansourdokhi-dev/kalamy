import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { OtpInput } from '../../src/components/OtpInput';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { verifyOtp, parseOtpFailureReason } from '../../src/api/auth';

export default function VerifyScreen() {
  const router = useRouter();
  const { mobile, devOtpCode } = useLocalSearchParams<{ mobile: string; devOtpCode?: string }>();
  const { tokens } = useTheme();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await verifyOtp({ mobile, code });
      router.push('/login');
    } catch (err) {
      const reason = parseOtpFailureReason(err);
      setError(reason ? ar.verify.reasons[reason] : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.verify.title}</Text>
      <Text style={[styles.subtitle, { color: tokens.colors.textSecondary }]}>{ar.verify.subtitle}</Text>
      {__DEV__ && devOtpCode ? (
        <View style={styles.devModeRow}>
          <Text style={[styles.devMode, { color: tokens.colors.textSecondary }]}>{ar.verify.devModeLabel}</Text>
          <Text style={[styles.devMode, { color: tokens.colors.textSecondary }]}>{devOtpCode}</Text>
        </View>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      <OtpInput length={6} value={code} onChange={setCode} />
      <View style={{ height: 24 }} />
      <Button title={ar.verify.submit} onPress={handleSubmit} loading={submitting} disabled={code.length !== 6} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  devModeRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  devMode: { fontSize: 14, fontWeight: '600' },
});
