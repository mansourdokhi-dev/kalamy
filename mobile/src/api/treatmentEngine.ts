// mobile/src/api/treatmentEngine.ts
import { apiRequest } from './client';

export interface ProgressDashboard {
  currentLevelName: string | null;
  currentLevelOrder: number | null;
  levelsCompleted: number;
  totalTrainingEvents: number;
  repeatedLevelOrders: number[];
  daysInProgram: number;
}

export function getProgress(patientProfileId: string): Promise<ProgressDashboard> {
  return apiRequest<ProgressDashboard>(`/api/v1/patients/${patientProfileId}/progress`, { auth: true });
}

export type LevelCycleStatus =
  | 'ACTIVE_LEVEL_TRAINING'
  | 'SAMPLE_ELIGIBLE'
  | 'SAMPLE_PREPARATION'
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
}

export function getCurrentCycle(patientProfileId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/current`, { auth: true });
}

export type SpecialistDecision = 'TRANSITION' | 'LEVEL_REPEAT' | 'TECHNICAL_RERECORD';

export interface SampleSamplePart {
  id: string;
  partType: string;
  label: string;
  order: number;
  recordingUrl: string | null;
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
  parts: SampleSamplePart[];
}

export interface TrainingCycleWithSample extends TrainingCycle {
  speechSample: SpeechSample | null;
}

export function getCycleHistory(patientProfileId: string): Promise<TrainingCycleWithSample[]> {
  return apiRequest<TrainingCycleWithSample[]>(`/api/v1/patients/${patientProfileId}/cycles`, { auth: true });
}

export interface TreatmentPlan {
  id: string;
  patientProfileId: string;
  clinicianUserId: string;
  assessmentId: string;
  phase: string;
  goals: string;
  reviewDate: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export function getActiveTreatmentPlan(patientProfileId: string): Promise<TreatmentPlan> {
  return apiRequest<TreatmentPlan>(`/api/v1/patients/${patientProfileId}/treatment-plans/active`, { auth: true });
}

export function startCycle(patientProfileId: string, treatmentPlanId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/start`, {
    method: 'POST',
    auth: true,
    body: { treatmentPlanId },
  });
}

export function logTrainingEvent(patientProfileId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/current/training-events`, {
    method: 'POST',
    auth: true,
    body: {},
  });
}

export interface LevelVersion {
  id: string;
  levelId: string;
  versionNumber: number;
  cognitiveVideo1Url: string | null;
  cognitiveVideo1Question: string | null;
  cognitiveVideo2Url: string | null;
  cognitiveVideo2Question: string | null;
  behavioralTechnique: string;
  humanModelVideoUrl: string | null;
  humanModelDurationSeconds: number | null;
  trainingListJson: string;
  samplePartTemplateJson: string;
  publishedAt: string | null;
}

export function getActiveLevelVersion(levelId: string): Promise<LevelVersion> {
  return apiRequest<LevelVersion>(`/api/v1/levels/${levelId}/versions/active`, { auth: true });
}

export function watchHumanModel(patientProfileId: string): Promise<TrainingCycle> {
  return apiRequest<TrainingCycle>(`/api/v1/patients/${patientProfileId}/cycles/current/watch-human-model`, {
    method: 'POST',
    auth: true,
  });
}
