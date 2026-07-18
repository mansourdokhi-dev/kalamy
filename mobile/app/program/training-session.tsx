import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import {
  getCurrentCycle,
  getLevels,
  getActiveLevelVersion,
  startOrResumeTrainingSession,
  recordTrainingProgress,
  getTrainingProgress,
  TrainingCycle,
  Level,
  LevelVersion,
  TrainingSession,
  TrainingProgressSummary,
} from '../../src/api/treatmentEngine';

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const PROGRESS_STEP = 10;

function hoursRemainingUntilSampleEligibility(firstTrainingEventAt: string | null): number | null {
  if (!firstTrainingEventAt) return 72;
  const elapsedMs = Date.now() - new Date(firstTrainingEventAt).getTime();
  const remainingMs = SEVENTY_TWO_HOURS_MS - elapsedMs;
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / (60 * 60 * 1000));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
}

export default function TrainingSessionScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId, loading: profileLoading, notFound: profileNotFound, error: profileError } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<TrainingCycle | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelVersion, setLevelVersion] = useState<LevelVersion | null>(null);
  const [progress, setProgress] = useState<TrainingProgressSummary | null>(null);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const currentCycle = await getCurrentCycle(id);
      setCycle(currentCycle);
      const [levelsResult, versionResult, progressResult] = await Promise.all([
        getLevels(),
        getActiveLevelVersion(currentCycle.levelId),
        getTrainingProgress(id),
      ]);
      setLevels(levelsResult);
      setLevelVersion(versionResult);
      setProgress(progressResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (patientProfileId) {
        load(patientProfileId);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [patientProfileId]),
  );

  async function handleStartOrResume() {
    if (!patientProfileId) return;
    setSubmitting(true);
    try {
      const result = await startOrResumeTrainingSession(patientProfileId);
      setSession(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddUnits() {
    if (!patientProfileId || !session) return;
    setSubmitting(true);
    try {
      const cumulative = session.unitsCompleted + PROGRESS_STEP;
      const result = await recordTrainingProgress(patientProfileId, cumulative);
      setSession(result);
      if (result.status === 'COMPLETED') {
        const refreshedProgress = await getTrainingProgress(patientProfileId);
        setProgress(refreshedProgress);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
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

  if (session?.status === 'COMPLETED') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.trainingSession.completedTitle}</Text>
        <View style={{ marginTop: 24 }}>
          <Button title={ar.trainingSession.backToHome} onPress={() => router.push('/home')} />
        </View>
      </View>
    );
  }

  if (error || !cycle || !progress) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error ?? 'حدث خطأ غير متوقع'} />
      </View>
    );
  }

  const levelName = levels.find((l) => l.id === cycle.levelId)?.name ?? '';
  const hoursRemaining = hoursRemainingUntilSampleEligibility(cycle.firstTrainingEventAt);
  const trainingList: string[] = levelVersion ? JSON.parse(levelVersion.trainingListJson) : [];

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.trainingSession.title}</Text>
      {levelName ? <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{levelName}</Text> : null}
      {hoursRemaining !== null ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 8 }}>
          {hoursRemaining} {ar.trainingSession.hoursRemainingLabel}
        </Text>
      ) : null}
      <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>
        {ar.trainingSession.dailyTargetLabel}: {progress.completedToday} / {progress.targetPerDay}
      </Text>

      {progress.intervalActive && progress.nextAvailableAt ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>
          {ar.trainingSession.intervalActiveLabel} {formatTime(progress.nextAvailableAt)}
        </Text>
      ) : session ? (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>
            {session.unitsCompleted} / 100 {ar.trainingSession.unitsProgressLabel}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: tokens.colors.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: tokens.colors.primary, width: `${Math.min(session.unitsCompleted, 100)}%` },
              ]}
            />
          </View>
          <View style={{ marginTop: 12 }}>
            <Button title={ar.trainingSession.addUnits} onPress={handleAddUnits} loading={submitting} />
          </View>
        </View>
      ) : (
        <View style={{ marginBottom: 16 }}>
          <Button title={ar.trainingSession.startOrResume} onPress={handleStartOrResume} loading={submitting} />
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.trainingSession.trainingListTitle}</Text>
      {trainingList.map((item, index) => (
        <Text key={index} style={{ color: tokens.colors.text, marginBottom: 4 }}>
          {item}
        </Text>
      ))}

      <View style={{ marginTop: 24 }}>
        <Button title={ar.trainingSession.viewLevelContent} onPress={() => router.push('/program/level-content')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  progressTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: 10 },
});
