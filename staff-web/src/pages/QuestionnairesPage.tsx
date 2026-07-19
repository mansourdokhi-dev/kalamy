import { useEffect, useState } from 'react';
import { Container, Card, Title, Text, Stack, Group, TextInput, Textarea, Select, Checkbox, Button, Badge, Alert, Divider } from '@mantine/core';
import { ar } from '../copy/ar';
import { useAuth } from '../auth/AuthProvider';
import { canManageQuestionnaires } from '../auth/permissions';
import { listTemplates, createTemplate, setTemplateActive } from '../api/questionnaires';
import type { QuestionnaireTemplate, QuestionType, NewQuestion } from '../api/questionnaires';
import { ApiError } from '../api/client';

interface DraftQuestion {
  text: string;
  type: QuestionType;
  optionsText: string;
  required: boolean;
}

const emptyQuestion: DraftQuestion = { text: '', type: 'TEXT', optionsText: '', required: true };

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: 'TEXT', label: ar.questionnaires.types.TEXT },
  { value: 'SINGLE_CHOICE', label: ar.questionnaires.types.SINGLE_CHOICE },
  { value: 'MULTI_CHOICE', label: ar.questionnaires.types.MULTI_CHOICE },
  { value: 'SCALE', label: ar.questionnaires.types.SCALE },
];

export function QuestionnairesPage() {
  const { user } = useAuth();
  const canManage = user ? canManageQuestionnaires(user.role) : false;

  const [templates, setTemplates] = useState<QuestionnaireTemplate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([{ ...emptyQuestion }]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function refresh() {
    setLoadError(null);
    listTemplates()
      .then(setTemplates)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ar.errors.unexpected));
  }

  useEffect(() => {
    refresh();
  }, []);

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  async function handleCreate() {
    if (title.trim().length === 0 || questions.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: NewQuestion[] = questions.map((q) => ({
        text: q.text.trim(),
        type: q.type,
        required: q.required,
        options:
          q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE'
            ? q.optionsText.split(',').map((o) => o.trim()).filter((o) => o.length > 0)
            : undefined,
      }));
      await createTemplate({ title: title.trim(), description: description.trim() || undefined, questions: payload });
      setTitle('');
      setDescription('');
      setQuestions([{ ...emptyQuestion }]);
      refresh();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : ar.errors.unexpected);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(template: QuestionnaireTemplate) {
    await setTemplateActive(template.id, !template.isActive);
    refresh();
  }

  if (!user || !canManage) {
    return (
      <Container>
        <Alert color="red">{ar.errors.unexpected}</Alert>
      </Container>
    );
  }

  return (
    <Container size="md">
      <Title order={2} mb="md">{ar.questionnaires.pageTitle}</Title>
      {loadError ? <Alert color="red" mb="sm">{loadError}</Alert> : null}

      <Card withBorder mb="lg">
        <Title order={3} mb="sm">{ar.questionnaires.createTitle}</Title>
        <Stack gap="sm">
          {saveError ? <Alert color="red">{saveError}</Alert> : null}
          <TextInput data-testid="template-title" label={ar.questionnaires.titleLabel} value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          <Textarea data-testid="template-description" label={ar.questionnaires.descriptionLabel} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />

          <Text fw={600}>{ar.questionnaires.questionsLabel}</Text>
          {questions.map((q, index) => (
            <Card key={index} withBorder padding="sm">
              <Stack gap="xs">
                <TextInput
                  data-testid={`question-text-${index}`}
                  label={ar.questionnaires.questionTextLabel}
                  value={q.text}
                  onChange={(e) => updateQuestion(index, { text: e.currentTarget.value })}
                />
                <Select
                  data-testid={`question-type-${index}`}
                  label={ar.questionnaires.questionTypeLabel}
                  data={TYPE_OPTIONS}
                  value={q.type}
                  onChange={(value) => updateQuestion(index, { type: (value as QuestionType) ?? 'TEXT' })}
                />
                {q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE' ? (
                  <TextInput
                    data-testid={`question-options-${index}`}
                    label={ar.questionnaires.optionsLabel}
                    value={q.optionsText}
                    onChange={(e) => updateQuestion(index, { optionsText: e.currentTarget.value })}
                  />
                ) : null}
                <Group justify="space-between">
                  <Checkbox
                    label={ar.questionnaires.requiredLabel}
                    checked={q.required}
                    onChange={(e) => updateQuestion(index, { required: e.currentTarget.checked })}
                  />
                  {questions.length > 1 ? (
                    <Button variant="subtle" color="red" onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== index))}>
                      {ar.questionnaires.removeQuestionButton}
                    </Button>
                  ) : null}
                </Group>
              </Stack>
            </Card>
          ))}
          <Group>
            <Button variant="light" data-testid="add-question" onClick={() => setQuestions((prev) => [...prev, { ...emptyQuestion }])}>
              {ar.questionnaires.addQuestionButton}
            </Button>
            <Button data-testid="create-template" onClick={handleCreate} loading={saving} disabled={title.trim().length === 0}>
              {ar.questionnaires.createButton}
            </Button>
          </Group>
        </Stack>
      </Card>

      <Title order={3} mb="sm">{ar.questionnaires.existingTitle}</Title>
      {templates.length === 0 ? (
        <Text c="dimmed">{ar.questionnaires.noTemplates}</Text>
      ) : (
        <Stack>
          {templates.map((template) => (
            <Card key={template.id} withBorder data-testid={`template-${template.id}`}>
              <Group justify="space-between">
                <div>
                  <Text fw={600}>{template.title}</Text>
                  <Text size="sm" c="dimmed">{ar.questionnaires.questionCount}: {template.questions.length}</Text>
                </div>
                <Group>
                  <Badge color={template.isActive ? 'green' : 'gray'}>
                    {template.isActive ? ar.questionnaires.activeBadge : ar.questionnaires.inactiveBadge}
                  </Badge>
                  <Button variant="subtle" onClick={() => handleToggle(template)}>
                    {template.isActive ? ar.questionnaires.deactivate : ar.questionnaires.activate}
                  </Button>
                </Group>
              </Group>
              {template.description ? (
                <>
                  <Divider my="xs" />
                  <Text size="sm">{template.description}</Text>
                </>
              ) : null}
            </Card>
          ))}
        </Stack>
      )}
    </Container>
  );
}
