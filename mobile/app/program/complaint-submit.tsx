import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { submitComplaint, ComplaintType } from '../../src/api/complaints';
import { ApiError } from '../../src/api/client';

export default function ComplaintSubmitScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  const [type, setType] = useState<ComplaintType>('COMPLAINT');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitComplaint({ type, subject, description });
      router.back();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.complaints.submitScreenTitle}</Text>
      {submitError ? <ErrorBanner message={submitError} /> : null}

      <View style={styles.typeRow}>
        <Pressable
          testID="type-complaint"
          onPress={() => setType('COMPLAINT')}
          style={[
            styles.typeOption,
            { borderColor: tokens.colors.border, borderRadius: tokens.radius.sm },
            type === 'COMPLAINT' ? { backgroundColor: tokens.colors.primary } : null,
          ]}
        >
          <Text style={{ color: type === 'COMPLAINT' ? tokens.colors.onPrimary : tokens.colors.text }}>
            {ar.complaints.types.COMPLAINT}
          </Text>
        </Pressable>
        <Pressable
          testID="type-suggestion"
          onPress={() => setType('SUGGESTION')}
          style={[
            styles.typeOption,
            { borderColor: tokens.colors.border, borderRadius: tokens.radius.sm },
            type === 'SUGGESTION' ? { backgroundColor: tokens.colors.primary } : null,
          ]}
        >
          <Text style={{ color: type === 'SUGGESTION' ? tokens.colors.onPrimary : tokens.colors.text }}>
            {ar.complaints.types.SUGGESTION}
          </Text>
        </Pressable>
      </View>

      <TextField testID="subject-input" label={ar.complaints.subjectLabel} value={subject} onChangeText={setSubject} />
      <TextField
        testID="description-input"
        label={ar.complaints.descriptionLabel}
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Button title={ar.complaints.submitButtonLabel} onPress={handleSubmit} disabled={!canSubmit} loading={submitting} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  typeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  typeOption: { flex: 1, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
});
