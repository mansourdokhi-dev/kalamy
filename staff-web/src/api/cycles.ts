import { apiRequest } from './client';

export type LevelCycleStatus =
  | 'ACTIVE_LEVEL_TRAINING'
  | 'SAMPLE_ELIGIBLE'
  | 'SAMPLE_PREPARATION'
  | 'SAMPLE_SUBMISSION_DELAYED'
  | 'SAMPLE_SUBMITTED'
  | 'WAITING_FOR_SPECIALIST'
  | 'UNDER_REVIEW'
  | 'DIRECT_INTERVENTION_REQUIRED'
  | 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'
  | 'TECHNICAL_PARTIAL_RERECORD'
  | 'LEVEL_REPEAT_DECIDED'
  | 'NEXT_LEVEL_APPROVED'
  | 'CLOSED_DUE_TO_INACTIVITY'
  | 'SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN';

export type SpecialistDecision = 'TRANSITION' | 'LEVEL_REPEAT' | 'TECHNICAL_RERECORD';
export type InterventionType = 'VIDEO_MEETING' | 'VOICE_CONSULTATION' | 'TARGETED_MESSAGE' | 'CLINICAL_ACTION';

export interface SampleSamplePart {
  id: string;
  partType: string;
  label: string;
  order: number;
  recordingUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  technicallyDamaged: boolean;
}

export interface SpeechSample {
  id: string;
  trainingCycleId: string;
  selfSeverityCurrent: number | null;
  selfSeverityExpectedNext: number | null;
  camperdownPerformanceRating: number | null;
  clientOpinionScore: number | null;
  submittedAt: string | null;
  reviewedByUserId: string | null;
  clinicianOpinionScore: number | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  decision: SpecialistDecision | null;
  reservedByUserId: string | null;
  reservedAt: string | null;
  reviewDeadlineAt: string | null;
  interventionType: InterventionType | null;
  interventionRequestedAt: string | null;
  interventionDeadlineAt: string | null;
  interventionCompletedAt: string | null;
  interventionOutcomeNotes: string | null;
  parts: SampleSamplePart[];
}

export interface TrainingCycle {
  id: string;
  patientProfileId: string;
  treatmentPlanId: string;
  levelId: string;
  levelVersionId: string;
  cycleNumber: number;
  status: LevelCycleStatus;
  humanModelWatchedAt: string | null;
  firstTrainingEventAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  speechSample?: SpeechSample | null;
}

export function getCurrentCycle(patientId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientId}/cycles/current`, { auth: true });
}
