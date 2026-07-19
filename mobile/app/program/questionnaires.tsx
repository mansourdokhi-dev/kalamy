import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import {
  getActiveQuestionnaires,
  submitQuestionnaire,
  QuestionnaireTemplate,
  QuestionnaireQuestion,
} from '../../src/api/questionnaires';

// Answers are keyed "<questionId>"; multi-choice keeps an array, everything else a string.
type AnswerMap = Record<string, string | string[]>;

export default function QuestionnairesScreen() {
  const { tokens } = useTheme();
  const { patientProfileId, loading: profileLoading, notFound: profileNotFound, error: profileError } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<QuestionnaireTemplate[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await getActiveQuestionnaires());
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

  function setAnswer(questionId: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function toggleMulti(questionId: string, option: string) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : [];
      const next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
      return { ...prev, [questionId]: next };
    });
  }

  async function handleSubmit(template: QuestionnaireTemplate) {
    if (!patientProfileId) return;
    setSubmittingId(template.id);
    setError(null);
    try {
      const payload = template.questions
        .map((q) => {
          const raw = answers[q.id];
          const value = Array.isArray(raw) ? raw.join(', ') : (raw ?? '');
          return { questionId: q.id, value };
        })
        .filter((a) => a.value.length > 0);
      await submitQuestionnaire(patientProfileId, template.id, payload);
      setSubmittedIds((prev) => [...prev, template.id]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmittingId(null);
    }
  }

  function renderQuestion(question: QuestionnaireQuestion) {
    const value = answers[question.id];
    if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTI_CHOICE') {
      const selected = Array.isArray(value) ? value : value ? [value] : [];
      return (
        <View style={{ gap: 6 }}>
          {question.options.map((option) => {
            const isSelected = selected.includes(option);
            return (
              <Pressable
                key={option}
                testID={`option-${question.id}-${option}`}
                onPress={() =>
                  question.type === 'MULTI_CHOICE' ? toggleMulti(question.id, option) : setAnswer(question.id, option)
                }
                style={[
                  styles.option,
                  { borderColor: isSelected ? tokens.colors.primary : tokens.colors.border, backgroundColor: isSelected ? tokens.colors.surface : 'transparent' },
                ]}
              >
                <Text style={{ color: tokens.colors.text }}>{isSelected ? '● ' : '○ '}{option}</Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    return (
      <TextField
        testID={`answer-${question.id}`}
        label=""
        value={typeof value === 'string' ? value : ''}
        onChangeText={(text) => setAnswer(question.id, text)}
        keyboardType={question.type === 'SCALE' ? 'numeric' : 'default'}
      />
    );
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

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.questionnaires.title}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {templates.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary }}>{ar.questionnaires.empty}</Text>
      ) : (
        templates.map((template) => (
          <View key={template.id} style={[styles.card, { borderColor: tokens.colors.border }]}>
            <Text style={[styles.templateTitle, { color: tokens.colors.text }]}>{template.title}</Text>
            {template.description ? (
              <Text style={{ color: tokens.colors.textSecondary, marginBottom: 8 }}>{template.description}</Text>
            ) : null}

            {submittedIds.includes(template.id) ? (
              <Text style={{ color: tokens.colors.primary }}>{ar.questionnaires.submittedMessage}</Text>
            ) : (
              <View style={{ gap: 12 }}>
                {template.questions.map((question) => (
                  <View key={question.id} style={{ gap: 4 }}>
                    <Text style={{ color: tokens.colors.text, fontWeight: '600' }}>
                      {question.text}{question.required ? ` ${ar.questionnaires.requiredMark}` : ''}
                    </Text>
                    {renderQuestion(question)}
                  </View>
                ))}
                <Button
                  title={ar.questionnaires.submitButton}
                  onPress={() => handleSubmit(template)}
                  loading={submittingId === template.id}
                />
              </View>
            )}
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
  card: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 12, gap: 4 },
  templateTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  option: { borderWidth: 1, borderRadius: 6, padding: 10 },
});
