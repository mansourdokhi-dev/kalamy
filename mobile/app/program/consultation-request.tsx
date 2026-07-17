import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { requestConsultation, ConsultationType } from '../../src/api/consultations';
import { ApiError } from '../../src/api/client';

export default function ConsultationRequestScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [type, setType] = useState<ConsultationType>('VOICE');
  const [reasonNote, setReasonNote] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = reasonNote.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit || !patientProfileId) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await requestConsultation(patientProfileId, { type, reasonNote });
      router.back();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.consultations.title}</Text>
      {submitError ? <ErrorBanner message={submitError} /> : null}

      <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{ar.consultations.typeSelectLabel}</Text>
      <View style={styles.typeRow}>
        <Pressable
          testID="type-voice"
          onPress={() => setType('VOICE')}
          style={[
            styles.typeOption,
            { borderColor: tokens.colors.border, borderRadius: tokens.radius.sm },
            type === 'VOICE' ? { backgroundColor: tokens.colors.primary } : null,
          ]}
        >
          <Text style={{ color: type === 'VOICE' ? tokens.colors.onPrimary : tokens.colors.text }}>
            {ar.consultations.types.VOICE}
          </Text>
        </Pressable>
        <Pressable
          testID="type-video"
          onPress={() => setType('VIDEO')}
          style={[
            styles.typeOption,
            { borderColor: tokens.colors.border, borderRadius: tokens.radius.sm },
            type === 'VIDEO' ? { backgroundColor: tokens.colors.primary } : null,
          ]}
        >
          <Text style={{ color: type === 'VIDEO' ? tokens.colors.onPrimary : tokens.colors.text }}>
            {ar.consultations.types.VIDEO}
          </Text>
        </Pressable>
      </View>

      <TextField
        testID="reason-input"
        label={ar.consultations.reasonInputLabel}
        value={reasonNote}
        onChangeText={setReasonNote}
        multiline
      />

      <Button title={ar.consultations.submitButtonLabel} onPress={handleSubmit} disabled={!canSubmit} loading={submitting} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  typeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  typeOption: { flex: 1, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
});
