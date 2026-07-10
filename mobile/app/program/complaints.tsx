import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { Button } from '../../src/components/Button';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getMyComplaints, Complaint } from '../../src/api/complaints';

function typeLabel(type: Complaint['type']): string {
  return ar.complaints.types[type];
}

function statusLabel(status: Complaint['status']): string {
  return ar.complaints.statuses[status];
}

export default function ComplaintsScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMyComplaints();
      setComplaints(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
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

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.complaints.title}</Text>

      <View style={{ marginBottom: 16 }}>
        <Button title={ar.complaints.submitLinkLabel} onPress={() => router.push('/program/complaint-submit')} />
      </View>

      {complaints.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary }}>{ar.complaints.noComplaintsYet}</Text>
      ) : (
        complaints.map((complaint) => (
          <View key={complaint.id} style={[styles.card, { borderColor: tokens.colors.border }]}>
            <Text style={{ color: tokens.colors.text }}>
              {ar.complaints.typeLabel}: <Text>{typeLabel(complaint.type)}</Text>
            </Text>
            <Text style={{ color: tokens.colors.text }}>{complaint.subject}</Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.complaints.statusLabel}: <Text>{statusLabel(complaint.status)}</Text>
            </Text>
            <Text style={{ color: tokens.colors.textSecondary }}>{complaint.createdAt}</Text>
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
