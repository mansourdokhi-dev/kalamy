import { apiRequest } from './client';
import type { SpeechSample, InterventionType } from './cycles';

export interface AvailableSampleRow {
  id: string;
  patientProfileId: string;
  levelId: string;
  status: string;
  speechSample: SpeechSample | null;
  patientProfile: { id: string; fullName: string };
}

export function listAvailableSamples(): Promise<AvailableSampleRow[]> {
  return apiRequest<AvailableSampleRow[]>('/api/v1/specialist-review/available-samples', { auth: true });
}

export function reserveSample(cycleId: string): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/specialist-review/cycles/${cycleId}/reserve`, { method: 'POST', auth: true });
}

export type ReviewSampleInput =
  | { decision: 'TRANSITION'; clinicianOpinionScore: number; reviewNotes?: string }
  | { decision: 'LEVEL_REPEAT'; clinicianOpinionScore: number; reviewNotes?: string }
  | { decision: 'TECHNICAL_RERECORD'; damagedPartIds: string[]; reviewNotes?: string };

export function reviewSample(patientId: string, input: ReviewSampleInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/patients/${patientId}/cycles/current/review`, {
    method: 'POST',
    auth: true,
    body: input,
  });
}

export interface RequestInterventionInput {
  interventionType: InterventionType;
  reasonNote: string;
}

export function requestIntervention(cycleId: string, input: RequestInterventionInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/specialist-review/cycles/${cycleId}/intervention`, {
    method: 'POST',
    auth: true,
    body: input,
  });
}

export interface CompleteInterventionInput {
  outcomeNotes: string;
}

export function completeIntervention(cycleId: string, input: CompleteInterventionInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/specialist-review/cycles/${cycleId}/intervention/complete`, {
    method: 'POST',
    auth: true,
    body: input,
  });
}
