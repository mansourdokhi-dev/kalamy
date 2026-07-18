import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { useAuth } from '../src/auth/AuthProvider';
import { usePatientProfile } from '../src/patient/PatientProfileProvider';
import { Button } from '../src/components/Button';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { ApiError } from '../src/api/client';
import {
  getProgress,
  getCurrentCycle,
  getCycleHistory,
  getActiveTreatmentPlan,
  startCycle,
  ProgressDashboard,
  TrainingCycle,
  TrainingCycleWithSample,
  TreatmentPlan,
} from '../src/api/treatmentEngine';

const STATES_NEEDING_SAMPLE_RECORDING = new Set(['SAMPLE_ELIGIBLE', 'SAMPLE_PREPARATION']);
const STATES_WAITING_ON_SPECIALIST = new Set(['WAITING_FOR_SPECIALIST', 'UNDER_REVIEW']);

function mostRecentDecidedCycle(history: TrainingCycleWithSample[]): TrainingCycleWithSample | null {
  const decided = history
    .filter((c) => c.closedAt && c.speechSample?.decision)
    .sort((a, b) => new Date(b.closedAt as string).getTime() - new Date(a.closedAt as string).getTime());
  return decided[0] ?? null;
}

export default function HomeScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { logout } = useAuth();
  const { patientProfileId, loading: profileLoading, notFound: profileNotFound, error: profileError } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressDashboard | null>(null);
  const [cycle, setCycle] = useState<TrainingCycle | null>(null);
  const [cycleNotFound, setCycleNotFound] = useState(false);
  const [activeTreatmentPlan, setActiveTreatmentPlan] = useState<TreatmentPlan | null>(null);
  const [noActivePlan, setNoActivePlan] = useState(false);
  const [recentDecisionCycle, setRecentDecisionCycle] = useState<TrainingCycleWithSample | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const [progressResult, historyResult] = await Promise.all([getProgress(id), getCycleHistory(id)]);
        setProgress(progressResult);
        setRecentDecisionCycle(mostRecentDecidedCycle(historyResult));

        try {
          const currentCycle = await getCurrentCycle(id);
          setCycle(currentCycle);
          setCycleNotFound(false);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            setCycle(null);
            setCycleNotFound(true);
            try {
              const plan = await getActiveTreatmentPlan(id);
              setActiveTreatmentPlan(plan);
              setNoActivePlan(false);
            } catch (planErr) {
              if (planErr instanceof ApiError && planErr.status === 404) {
                setActiveTreatmentPlan(null);
                setNoActivePlan(true);
              } else {
                throw planErr;
              }
            }
          } else {
            throw err;
          }
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      if (patientProfileId) {
        load(patientProfileId);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [patientProfileId]),
  );

  async function handleStartProgram() {
    if (!patientProfileId || !activeTreatmentPlan) return;
    setSubmitting(true);
    try {
      await startCycle(patientProfileId, activeTreatmentPlan.id);
      await load(patientProfileId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/');
  }

  function renderPrimaryAction() {
    if (cycleNotFound) {
      if (activeTreatmentPlan) {
        return <Button title={ar.program.startProgram} onPress={handleStartProgram} loading={submitting} />;
      }
      if (noActivePlan) {
        return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.noTreatmentPlanYet}</Text>;
      }
      return null;
    }

    if (!cycle) return null;

    if (cycle.status === 'ACTIVE_LEVEL_TRAINING') {
      if (!cycle.humanModelWatchedAt) {
        return <Button title={ar.program.watchLevelContent} onPress={() => router.push('/program/level-content')} />;
      }
      return <Button title={ar.program.logTraining} onPress={() => router.push('/program/training-session')} />;
    }
    if (STATES_NEEDING_SAMPLE_RECORDING.has(cycle.status)) {
      return <Button title={ar.program.recordSample} onPress={() => router.push('/program/sample-recording')} />;
    }
    if (cycle.status === 'TECHNICAL_PARTIAL_RERECORD') {
      return <Button title={ar.program.rerecordParts} onPress={() => router.push('/program/sample-rerecord')} />;
    }
    if (STATES_WAITING_ON_SPECIALIST.has(cycle.status)) {
      return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.waitingForSpecialist}</Text>;
    }
    if (cycle.status === 'CLOSED_DUE_TO_INACTIVITY') {
      return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.pausedForInactivity}</Text>;
    }
    return <Text style={{ color: tokens.colors.textSecondary }}>{ar.program.genericWaiting}</Text>;
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
      {progress ? (
        <Text style={[styles.levelName, { color: tokens.colors.text }]}>
          {progress.currentLevelName ?? ''}
        </Text>
      ) : null}

      {recentDecisionCycle ? (
        <View style={{ marginBottom: 16 }}>
          <Button
            title={ar.program.therapistMessageBanner}
            onPress={() =>
              router.push({ pathname: '/program/sample-result', params: { cycleId: recentDecisionCycle.id } })
            }
          />
        </View>
      ) : null}

      <View style={{ marginBottom: 24 }}>{renderPrimaryAction()}</View>

      <View style={styles.linksRow}>
        <Button title={ar.program.viewLevelContent} onPress={() => router.push('/program/level-content')} />
        <Button title={ar.program.viewHistory} onPress={() => router.push('/program/history')} />
        <Button title={ar.program.viewReports} onPress={() => router.push('/program/reports')} />
        <Button title={ar.program.viewComplaints} onPress={() => router.push('/program/complaints')} />
        <Button title={ar.program.viewNotifications} onPress={() => router.push('/program/notifications')} />
        <Button title={ar.program.viewConsultations} onPress={() => router.push('/program/consultations')} />
      </View>

      <View style={{ marginTop: 24 }}>
        <Button title={ar.program.logout} onPress={handleLogout} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  levelName: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 16 },
  linksRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
