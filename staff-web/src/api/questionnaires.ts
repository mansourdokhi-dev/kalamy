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

export interface QuestionnaireAnswer {
  id: string;
  questionId: string;
  value: string;
}

export interface QuestionnaireResponse {
  id: string;
  templateId: string;
  patientProfileId: string;
  submittedByUserId: string;
  submittedAt: string;
  answers: QuestionnaireAnswer[];
  template: QuestionnaireTemplate;
}

export interface NewQuestion {
  text: string;
  type: QuestionType;
  options?: string[];
  required?: boolean;
}

export function listTemplates(): Promise<QuestionnaireTemplate[]> {
  return apiRequest<QuestionnaireTemplate[]>('/api/v1/questionnaire-templates', { auth: true });
}

export function createTemplate(input: { title: string; description?: string; questions: NewQuestion[] }): Promise<QuestionnaireTemplate> {
  return apiRequest<QuestionnaireTemplate>('/api/v1/questionnaire-templates', { method: 'POST', body: input, auth: true });
}

export function setTemplateActive(templateId: string, isActive: boolean): Promise<QuestionnaireTemplate> {
  return apiRequest<QuestionnaireTemplate>(`/api/v1/questionnaire-templates/${templateId}`, { method: 'PATCH', body: { isActive }, auth: true });
}

export function listResponses(patientId: string): Promise<QuestionnaireResponse[]> {
  return apiRequest<QuestionnaireResponse[]>(`/api/v1/patients/${patientId}/questionnaire-responses`, { auth: true });
}
