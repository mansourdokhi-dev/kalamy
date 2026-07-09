import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getCurrentCycle, getActiveLevelVersion, watchHumanModel, LevelVersion } from '../../src/api/treatmentEngine';

export default function LevelContentScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [levelVersion, setLevelVersion] = useState<LevelVersion | null>(null);
  const [watchedAt, setWatchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const cycle = await getCurrentCycle(id);
      setWatchedAt(cycle.humanModelWatchedAt);
      const version = await getActiveLevelVersion(cycle.levelId);
      setLevelVersion(version);
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
  }, [patientProfileId, load]);

  async function handleMarkWatched() {
    if (!patientProfileId) return;
    setSubmitting(true);
    try {
      await watchHumanModel(patientProfileId);
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

  if (error || !levelVersion) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error ?? 'حدث خطأ غير متوقع'} />
      </View>
    );
  }

  const trainingList: string[] = JSON.parse(levelVersion.trainingListJson);

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.levelContent.title}</Text>
      <Text style={{ color: tokens.colors.text, marginBottom: 16 }}>{levelVersion.behavioralTechnique}</Text>

      {levelVersion.cognitiveVideo1Question ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 8 }}>
          {ar.levelContent.reflectionPrompt}: {levelVersion.cognitiveVideo1Question}
        </Text>
      ) : null}
      {levelVersion.cognitiveVideo2Question ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>
          {ar.levelContent.reflectionPrompt}: {levelVersion.cognitiveVideo2Question}
        </Text>
      ) : null}

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.levelContent.trainingListTitle}</Text>
      {trainingList.map((item, index) => (
        <Text key={index} style={{ color: tokens.colors.text, marginBottom: 4 }}>
          {item}
        </Text>
      ))}

      {!watchedAt ? (
        <View style={{ marginTop: 24 }}>
          <Button title={ar.levelContent.markWatched} onPress={handleMarkWatched} loading={submitting} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 8 },
});
