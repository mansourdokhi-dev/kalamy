import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { registerPatient, registerCaregiver } from '../../src/api/auth';
import { ApiError } from '../../src/api/client';

const MOBILE_REGEX = /^\+?[0-9]{9,15}$/;

export default function RegisterFormScreen() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role: 'PATIENT' | 'CAREGIVER' }>();
  const { tokens } = useTheme();

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!fullName.trim()) errors.fullName = ar.registerForm.nameRequired;
    if (!MOBILE_REGEX.test(mobile)) errors.mobile = ar.registerForm.mobileInvalid;
    if (password.length < 8) errors.password = ar.registerForm.passwordTooShort;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const register = role === 'CAREGIVER' ? registerCaregiver : registerPatient;
      const result = await register({ fullName, mobile, email: email || undefined, password });
      router.push({
        pathname: '/register/verify',
        params: result.devOtpCode ? { mobile, devOtpCode: result.devOtpCode } : { mobile },
      });
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.registerForm.title}</Text>
      {submitError ? <ErrorBanner message={submitError} /> : null}
      <TextField testID="fullName-input" label={ar.registerForm.fullName} value={fullName} onChangeText={setFullName} error={fieldErrors.fullName} />
      <TextField testID="mobile-input" label={ar.registerForm.mobile} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" error={fieldErrors.mobile} />
      <TextField testID="email-input" label={ar.registerForm.email} value={email} onChangeText={setEmail} keyboardType="email-address" />
      <TextField testID="password-input" label={ar.registerForm.password} value={password} onChangeText={setPassword} secureTextEntry error={fieldErrors.password} />
      <Button title={ar.registerForm.submit} onPress={handleSubmit} loading={submitting} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
});
