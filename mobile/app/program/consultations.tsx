import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { getMyConsultations, Consultation } from '../../src/api/consultations';

function typeLabel(type: Consultation['type']): string {
  return ar.consultations.types[type];
}

function statusLabel(status: Consultation['status']): string {
  return ar.consultations.statuses[status];
}

export default function ConsultationsScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consultations, setConsultations] = useState<Consultation[]>([]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMyConsultations(id);
      setConsultations(result);
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

  if (loading) {
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

  const hasUsedOrActiveConsultation = consultations.some((c) => c.status !== 'CANCELLED');

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.consultations.title}</Text>

      {hasUsedOrActiveConsultation ? null : (
        <View style={{ marginBottom: 16 }}>
          <Button title={ar.consultations.requestButton} onPress={() => router.push('/program/consultation-request')} />
        </View>
      )}

      {consultations.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary }}>{ar.consultations.noConsultationYet}</Text>
      ) : (
        consultations.map((consultation) => (
          <View key={consultation.id} style={[styles.card, { borderColor: tokens.colors.border }]}>
            <Text style={{ color: tokens.colors.text }}>
              {ar.consultations.typeLabel}: <Text>{typeLabel(consultation.type)}</Text>
            </Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.consultations.statusLabel}: <Text>{statusLabel(consultation.status)}</Text>
            </Text>
            {consultation.reasonNote ? (
              <Text style={{ color: tokens.colors.text }}>{consultation.reasonNote}</Text>
            ) : null}
            {consultation.scheduledAt ? (
              <Text style={{ color: tokens.colors.text }}>
                {ar.consultations.scheduledAtLabel}: <Text>{consultation.scheduledAt}</Text>
              </Text>
            ) : null}
            {consultation.externalMeetingLink ? (
              <Text style={{ color: tokens.colors.text }}>
                {ar.consultations.meetingLinkLabel}: <Text>{consultation.externalMeetingLink}</Text>
              </Text>
            ) : null}
            {consultation.outcomeNotes ? (
              <Text style={{ color: tokens.colors.text }}>
                {ar.consultations.outcomeNotesLabel}: <Text>{consultation.outcomeNotes}</Text>
              </Text>
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
  card: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8, gap: 2 },
});
