import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { AudioRecorder } from '../../src/components/AudioRecorder';
import { ApiError } from '../../src/api/client';
import { getCurrentCycle, uploadRecording, rerecordDamagedParts, SampleSamplePart } from '../../src/api/treatmentEngine';

export default function SampleRerecordScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [damagedParts, setDamagedParts] = useState<SampleSamplePart[]>([]);
  const [recordings, setRecordings] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const cycle = await getCurrentCycle(id);
      const parts = cycle.speechSample?.parts.filter((p) => p.technicallyDamaged) ?? [];
      setDamagedParts(parts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (patientProfileId) {
      load(patientProfileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientProfileId]);

  async function handleRecorded(partId: string, fileUri: string) {
    if (!patientProfileId) return;
    setError(null);
    try {
      const { url } = await uploadRecording(patientProfileId, fileUri);
      setRecordings((prev) => ({ ...prev, [partId]: url }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }

  async function handleSubmit() {
    if (!patientProfileId) return;
    setSubmitting(true);
    setError(null);
    try {
      const parts = damagedParts.map((part) => ({ id: part.id, recordingUrl: recordings[part.id] }));
      await rerecordDamagedParts(patientProfileId, parts);
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error && damagedParts.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error} />
      </View>
    );
  }

  const allRecorded = damagedParts.every((part) => recordings[part.id]);

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.sampleRerecord.title}</Text>
      <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.sampleRerecord.instructions}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {damagedParts.map((part) => (
        <View key={part.id} style={styles.partRow}>
          <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{part.label}</Text>
          {recordings[part.id] ? (
            <Text style={{ color: tokens.colors.primary }}>{ar.sampleRerecord.recorded}</Text>
          ) : (
            <AudioRecorder onRecorded={(uri) => handleRecorded(part.id, uri)} />
          )}
        </View>
      ))}

      <View style={{ marginTop: 24 }}>
        <Button title={ar.sampleRerecord.submit} onPress={handleSubmit} disabled={!allRecorded} loading={submitting} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  partRow: { marginBottom: 24 },
});
