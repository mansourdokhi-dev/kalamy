import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { AudioRecorder } from '../../src/components/AudioRecorder';
import { AudioPlayer } from '../../src/components/AudioPlayer';
import { ApiError } from '../../src/api/client';
import {
  getCurrentCycle,
  getActiveLevelVersion,
  openSampleSession,
  listAttempts,
  recordAttempt,
  deleteAttempt,
  uploadRecording,
  submitSample,
  SampleAttempt,
  LevelVersion,
} from '../../src/api/treatmentEngine';

const MAX_ATTEMPTS = 10;

interface SamplePartTemplate {
  partType: string;
  label: string;
  order: number;
  required: boolean;
}

function ScoreStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const { tokens } = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: tokens.colors.text, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Button title="-" onPress={() => onChange(Math.max(1, value - 1))} />
        <Text style={{ color: tokens.colors.text, fontSize: 16, fontWeight: '600' }}>{value}</Text>
        <Button title="+" onPress={() => onChange(Math.min(9, value + 1))} />
      </View>
    </View>
  );
}

export default function SampleRecordingScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levelVersion, setLevelVersion] = useState<LevelVersion | null>(null);
  const [attempts, setAttempts] = useState<SampleAttempt[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [selfSeverityCurrent, setSelfSeverityCurrent] = useState(5);
  const [selfSeverityExpectedNext, setSelfSeverityExpectedNext] = useState(5);
  const [camperdownPerformanceRating, setCamperdownPerformanceRating] = useState(5);
  const [clientOpinionScore, setClientOpinionScore] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const cycle = await getCurrentCycle(id);
      if (cycle.status === 'SAMPLE_ELIGIBLE') {
        await openSampleSession(id);
      }
      const [version, attemptsResult] = await Promise.all([getActiveLevelVersion(cycle.levelId), listAttempts(id)]);
      setLevelVersion(version);
      setAttempts(attemptsResult);
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

  async function handleRecorded(fileUri: string) {
    if (!patientProfileId) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadRecording(patientProfileId, fileUri);
      await recordAttempt(patientProfileId, url);
      const attemptsResult = await listAttempts(patientProfileId);
      setAttempts(attemptsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(attemptId: string) {
    if (!patientProfileId) return;
    try {
      await deleteAttempt(patientProfileId, attemptId);
      const attemptsResult = await listAttempts(patientProfileId);
      setAttempts(attemptsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }

  async function handleSubmit() {
    if (!patientProfileId || !levelVersion) return;
    setSubmitting(true);
    setError(null);
    try {
      const requiredParts: SamplePartTemplate[] = JSON.parse(levelVersion.samplePartTemplateJson);
      const parts = requiredParts.map((part) => ({
        partType: part.partType,
        label: part.label,
        order: part.order,
        sourceAttemptId: assignments[part.order],
      }));
      await submitSample(patientProfileId, {
        parts,
        selfSeverityCurrent,
        selfSeverityExpectedNext,
        camperdownPerformanceRating,
        clientOpinionScore,
      });
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

  if (!levelVersion) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error ?? 'حدث خطأ غير متوقع'} />
      </View>
    );
  }

  const requiredParts: SamplePartTemplate[] = JSON.parse(levelVersion.samplePartTemplateJson);
  const atMaxAttempts = attempts.length >= MAX_ATTEMPTS;
  const allPartsAssigned = requiredParts.every((part) => assignments[part.order]);

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.sampleRecording.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {step === 1 ? (
        <View>
          <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleRecording.requiredPartsTitle}</Text>
          {requiredParts.map((part) => (
            <Text key={part.order} style={{ color: tokens.colors.textSecondary, marginBottom: 4 }}>
              {part.label}
            </Text>
          ))}

          <Text style={[styles.sectionTitle, { color: tokens.colors.text, marginTop: 16 }]}>{ar.sampleRecording.attemptsTitle}</Text>
          {attempts.map((attempt) => (
            <View key={attempt.id} style={styles.attemptRow}>
              <Text style={{ color: tokens.colors.text }}>{`${ar.sampleRecording.attemptLabel} ${attempt.attemptNumber}`}</Text>
              <AudioPlayer uri={attempt.recordingUrl} />
              <Button title={ar.sampleRecording.deleteAttempt} onPress={() => handleDelete(attempt.id)} />
            </View>
          ))}

          {atMaxAttempts ? (
            <Text style={{ color: tokens.colors.textSecondary, marginVertical: 8 }}>{ar.sampleRecording.maxAttemptsReached}</Text>
          ) : uploading ? (
            <Text style={{ color: tokens.colors.textSecondary, marginVertical: 8 }}>{ar.sampleRecording.uploading}</Text>
          ) : (
            <AudioRecorder onRecorded={handleRecorded} />
          )}

          <View style={{ marginTop: 24 }}>
            <Button title={ar.sampleRecording.next} onPress={() => setStep(2)} disabled={attempts.length === 0} />
          </View>
        </View>
      ) : null}

      {step === 2 ? (
        <View>
          <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleRecording.assignPartsTitle}</Text>
          {requiredParts.map((part) => (
            <View key={part.order} style={{ marginBottom: 16 }}>
              <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{part.label}</Text>
              {attempts.map((attempt) => {
                const selected = assignments[part.order] === attempt.id;
                return (
                  <Pressable
                    key={attempt.id}
                    onPress={() => setAssignments((prev) => ({ ...prev, [part.order]: attempt.id }))}
                    style={[styles.attemptChoiceRow, { borderColor: selected ? tokens.colors.primary : tokens.colors.border }]}
                  >
                    <Text style={{ color: selected ? tokens.colors.primary : tokens.colors.text }}>
                      {`${ar.sampleRecording.attemptLabel} ${attempt.attemptNumber}`}
                    </Text>
                    <AudioPlayer uri={attempt.recordingUrl} />
                  </Pressable>
                );
              })}
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <Button title={ar.sampleRecording.back} onPress={() => setStep(1)} />
            <Button title={ar.sampleRecording.next} onPress={() => setStep(3)} disabled={!allPartsAssigned} />
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View>
          <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleRecording.selfReportTitle}</Text>
          <ScoreStepper label={ar.sampleRecording.selfSeverityCurrentLabel} value={selfSeverityCurrent} onChange={setSelfSeverityCurrent} />
          <ScoreStepper label={ar.sampleRecording.selfSeverityExpectedNextLabel} value={selfSeverityExpectedNext} onChange={setSelfSeverityExpectedNext} />
          <ScoreStepper label={ar.sampleRecording.camperdownPerformanceLabel} value={camperdownPerformanceRating} onChange={setCamperdownPerformanceRating} />
          <ScoreStepper label={ar.sampleRecording.clientOpinionLabel} value={clientOpinionScore} onChange={setClientOpinionScore} />
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <Button title={ar.sampleRecording.back} onPress={() => setStep(2)} />
            <Button title={ar.sampleRecording.submit} onPress={handleSubmit} loading={submitting} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  attemptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 8 },
  attemptChoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
});
