import { apiRequest } from './client';

export type QuestionType = 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE';

export interface QuestionnaireQuestion {
  id: string;
  templateId: string;
  order: number;
  text: string;
  type: QuestionType;
  options: string[];
  required: boolean;
}

export interface QuestionnaireTemplate {
  id: string;
  title: string;
  description: string | null;
  isActive: boolean;
  questions: QuestionnaireQuestion[];
  createdAt: string;
}

export interface AnswerInput {
  questionId: string;
  value: string;
}

export function getActiveQuestionnaires(): Promise<QuestionnaireTemplate[]> {
  return apiRequest<QuestionnaireTemplate[]>('/api/v1/questionnaire-templates', { auth: true });
}

export function submitQuestionnaire(
  patientProfileId: string,
  templateId: string,
  answers: AnswerInput[],
): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`/api/v1/patients/${patientProfileId}/questionnaire-responses`, {
    method: 'POST',
    body: { templateId, answers },
    auth: true,
  });
}
