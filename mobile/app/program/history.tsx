import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getCycleHistory, getLevels, TrainingCycleWithSample, Level, SpecialistDecision } from '../../src/api/treatmentEngine';

export default function HistoryScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId, loading: profileLoading, notFound: profileNotFound, error: profileError } = usePatientProfile();

  const [cycles, setCycles] = useState<TrainingCycleWithSample[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientProfileId) return;
    setLoading(true);
    setError(null);
    Promise.all([getCycleHistory(patientProfileId), getLevels()])
      .then(([cycleResult, levelResult]) => {
        setCycles(cycleResult);
        setLevels(levelResult);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      })
      .finally(() => setLoading(false));
  }, [patientProfileId]);

  function levelName(levelId: string): string {
    return levels.find((l) => l.id === levelId)?.name ?? levelId;
  }

  function decisionLabel(decision: SpecialistDecision): string {
    if (decision === 'TRANSITION') return ar.history.decisions.TRANSITION;
    if (decision === 'LEVEL_REPEAT') return ar.history.decisions.LEVEL_REPEAT;
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

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.history.title}</Text>
      {cycles.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary }}>{ar.history.empty}</Text>
      ) : (
        cycles.map((cycle) => (
          <View key={cycle.id} style={[styles.row, { borderColor: tokens.colors.border }]}>
            <Text style={{ color: tokens.colors.text, fontWeight: '600' }}>{levelName(cycle.levelId)}</Text>
            <Text style={{ color: tokens.colors.textSecondary }}>{cycle.status}</Text>
            <Text style={{ color: tokens.colors.textSecondary }}>#{cycle.cycleNumber}</Text>
            {cycle.speechSample?.decision ? (
              <Pressable
                onPress={() => router.push({ pathname: '/program/sample-result', params: { cycleId: cycle.id } })}
              >
                <Text style={{ color: tokens.colors.primary }}>
                  {ar.history.decisionLinePrefix} {decisionLabel(cycle.speechSample.decision)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  row: { borderBottomWidth: 1, paddingVertical: 12, gap: 4 },
});
