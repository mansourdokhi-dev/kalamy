import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getCycleHistory, SpeechSample, SpecialistDecision } from '../../src/api/treatmentEngine';

export default function SampleResultScreen() {
  const { tokens } = useTheme();
  const { patientProfileId, loading: profileLoading, notFound: profileNotFound, error: profileError } = usePatientProfile();
  const { cycleId } = useLocalSearchParams<{ cycleId: string }>();

  const [sample, setSample] = useState<SpeechSample | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientProfileId) return;
    setLoading(true);
    setError(null);
    getCycleHistory(patientProfileId)
      .then((cycles) => {
        const match = cycles.find((c) => c.id === cycleId);
        setSample(match?.speechSample ?? null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      })
      .finally(() => setLoading(false));
  }, [patientProfileId, cycleId]);

  function decisionLabel(decision: SpecialistDecision): string {
    if (decision === 'TRANSITION') return ar.sampleResult.decisions.TRANSITION;
    if (decision === 'LEVEL_REPEAT') return ar.sampleResult.decisions.LEVEL_REPEAT;
    return '';
  }

  if (profileNotFound) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={ar.program.noTreatmentPlanYet} />
      </View>
    );
  }

  if (profileError) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={profileError} />
      </View>
    );
  }

  if (profileLoading || loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error || !sample || !sample.decision) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error ?? ar.sampleResult.notFound} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.sampleResult.title}</Text>
      <Text style={[styles.decision, { color: tokens.colors.primary }]}>{decisionLabel(sample.decision)}</Text>

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleResult.clinicianNotesTitle}</Text>
      <Text style={{ color: tokens.colors.text, marginBottom: 16 }}>{sample.reviewNotes ?? ''}</Text>

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.sampleResult.selfReportTitle}</Text>
      <Text style={{ color: tokens.colors.textSecondary }}>{`${sample.selfSeverityCurrent} / ${sample.selfSeverityExpectedNext} / ${sample.camperdownPerformanceRating} / ${sample.clientOpinionScore}`}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  decision: { fontSize: 16, fontWeight: '600', marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
});
