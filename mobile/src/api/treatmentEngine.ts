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
  speechSample?: SpeechSample | null;
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

export interface Level {
  id: string;
  name: string;
  order: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export function getLevels(): Promise<Level[]> {
  return apiRequest<Level[]>('/api/v1/levels', { auth: true });
}

export interface SampleSession {
  id: string;
  trainingCycleId: string;
  attemptsUsed: number;
  status: 'OPEN' | 'CLOSED_SUBMITTED' | 'CLOSED_EXHAUSTED';
  createdAt: string;
  updatedAt: string;
}

export function openSampleSession(patientProfileId: string): Promise<SampleSession> {
  return apiRequest<SampleSession>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session`, {
    method: 'POST',
    auth: true,
  });
}

export interface SampleAttempt {
  id: string;
  sampleSessionId: string;
  attemptNumber: number;
  recordingUrl: string;
  deletedAt: string | null;
  createdAt: string;
}

export function listAttempts(patientProfileId: string): Promise<SampleAttempt[]> {
  return apiRequest<SampleAttempt[]>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/attempts`, {
    auth: true,
  });
}

export function recordAttempt(patientProfileId: string, recordingUrl: string): Promise<SampleAttempt> {
  return apiRequest<SampleAttempt>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/attempts`, {
    method: 'POST',
    auth: true,
    body: { recordingUrl },
  });
}

export function deleteAttempt(patientProfileId: string, attemptId: string): Promise<SampleAttempt> {
  return apiRequest<SampleAttempt>(
    `/api/v1/patients/${patientProfileId}/cycles/current/sample-session/attempts/${attemptId}`,
    { method: 'DELETE', auth: true },
  );
}

export interface SubmitSamplePart {
  partType: string;
  label: string;
  order: number;
  sourceAttemptId: string;
}

export interface SubmitSampleInput {
  parts: SubmitSamplePart[];
  selfSeverityCurrent: number;
  selfSeverityExpectedNext: number;
  camperdownPerformanceRating: number;
  clientOpinionScore: number;
}

export function submitSample(patientProfileId: string, dto: SubmitSampleInput): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/submit`, {
    method: 'POST',
    auth: true,
    body: dto,
  });
}

export interface RerecordPartInput {
  id: string;
  recordingUrl: string;
}

export function rerecordDamagedParts(patientProfileId: string, parts: RerecordPartInput[]): Promise<SpeechSample> {
  return apiRequest<SpeechSample>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/rerecord`, {
    method: 'POST',
    auth: true,
    body: { parts },
  });
}

export function uploadRecording(patientProfileId: string, fileUri: string): Promise<{ url: string }> {
  const formData = new FormData();
  const filename = fileUri.split('/').pop() ?? 'recording.m4a';
  formData.append('audio', {
    uri: fileUri,
    name: filename,
    type: 'audio/m4a',
  } as unknown as Blob);
  return apiRequest<{ url: string }>(`/api/v1/patients/${patientProfileId}/cycles/current/sample-session/upload`, {
    method: 'POST',
    auth: true,
    formData,
  });
}
