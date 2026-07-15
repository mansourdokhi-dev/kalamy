import { apiRequest } from './client';

export interface ProgressDashboard {
  currentLevelName: string | null;
  currentLevelOrder: number | null;
  levelsCompleted: number;
  totalTrainingEvents: number;
  repeatedLevelOrders: number[];
  daysInProgram: number;
}

export function getProgressDashboard(patientId: string): Promise<ProgressDashboard> {
  return apiRequest<ProgressDashboard>(`/api/v1/patients/${patientId}/progress`, { auth: true });
}

export interface PassedLevelSummary {
  levelId: string;
  levelName: string;
  order: number;
  levelVersionId: string;
  passedAt: string | null;
}

export function getPassedLevels(patientId: string): Promise<PassedLevelSummary[]> {
  return apiRequest<PassedLevelSummary[]>(`/api/v1/patients/${patientId}/levels/passed`, { auth: true });
}
