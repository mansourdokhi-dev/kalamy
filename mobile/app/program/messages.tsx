import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { getMyPatientProfile } from '../../src/api/patients';
import { getMessages, sendMessage, PatientMessage } from '../../src/api/messages';

export default function MessagesScreen() {
  const { tokens } = useTheme();
  const { patientProfileId, loading: profileLoading, notFound: profileNotFound, error: profileError } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<PatientMessage[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [thread, profile] = await Promise.all([getMessages(id), getMyPatientProfile()]);
      setMessages(thread);
      setMyUserId(profile.userId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleSend() {
    if (!patientProfileId || draft.trim().length === 0) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(patientProfileId, draft.trim());
      setDraft('');
      await load(patientProfileId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSending(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (patientProfileId) {
        load(patientProfileId);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [patientProfileId]),
  );

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

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.messages.title}</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {messages.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.messages.empty}</Text>
      ) : (
        messages.map((message) => {
          const mine = myUserId !== null && message.senderUserId === myUserId;
          return (
            <View
              key={message.id}
              style={[
                styles.bubble,
                {
                  borderColor: tokens.colors.border,
                  backgroundColor: mine ? tokens.colors.surface : tokens.colors.background,
                  alignSelf: mine ? 'flex-start' : 'flex-end',
                },
              ]}
            >
              <Text style={{ color: tokens.colors.textSecondary, fontSize: 12, marginBottom: 2 }}>
                {mine ? ar.messages.fromMe : ar.messages.fromCareTeam}
              </Text>
              <Text style={{ color: tokens.colors.text }}>{message.body}</Text>
              {mine && message.readAt ? (
                <Text style={{ color: tokens.colors.textSecondary, fontSize: 11, marginTop: 2 }}>{ar.messages.readLabel}</Text>
              ) : null}
            </View>
          );
        })
      )}

      <View style={{ marginTop: 16 }}>
        <TextField
          testID="message-input"
          label={ar.messages.inputLabel}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Button title={ar.messages.sendButton} onPress={handleSend} loading={sending} disabled={draft.trim().length === 0} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  bubble: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8, maxWidth: '85%' },
});
