import { apiRequest } from './client';

export type TreatmentPhase = 'PHASE_1' | 'PHASE_2' | 'PHASE_3' | 'PHASE_4' | 'PHASE_5';
export type PlanStatus = 'ACTIVE' | 'INACTIVE';

export interface TreatmentPlan {
  id: string;
  patientProfileId: string;
  clinicianUserId: string;
  assessmentId: string;
  phase: TreatmentPhase;
  goals: string;
  reviewDate: string;
  status: PlanStatus;
  createdAt: string;
}

export function createTreatmentPlan(
  patientId: string,
  input: { assessmentId: string; goals: string; reviewDate: string },
): Promise<TreatmentPlan> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans`, { method: 'POST', body: input, auth: true });
}

export function listTreatmentPlans(patientId: string): Promise<TreatmentPlan[]> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans`, { auth: true });
}

export function getActiveTreatmentPlan(patientId: string): Promise<TreatmentPlan> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/active`, { auth: true });
}

export function updateTreatmentPlan(
  patientId: string,
  id: string,
  input: { goals?: string; reviewDate?: string },
): Promise<TreatmentPlan> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${id}`, { method: 'PUT', body: input, auth: true });
}

export function transitionPhase(
  patientId: string,
  id: string,
  input: { toPhase: TreatmentPhase; rationale?: string },
): Promise<TreatmentPlan> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${id}/phase-transition`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export interface PlanExercise {
  id: string;
  exerciseId: string;
  frequencyPerWeek: number;
  sequence: number;
  exercise: {
    id: string;
    title: string;
    category: string;
    phaseLevel: number;
    durationMinutes: number;
  };
}

export function linkExercise(
  patientId: string,
  planId: string,
  input: { exerciseId: string; frequencyPerWeek: number; sequence: number },
): Promise<PlanExercise> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${planId}/exercises`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function listPlanExercises(patientId: string, planId: string): Promise<PlanExercise[]> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${planId}/exercises`, { auth: true });
}

export function unlinkExercise(patientId: string, planId: string, exerciseId: string): Promise<void> {
  return apiRequest(`/api/v1/patients/${patientId}/treatment-plans/${planId}/exercises/${exerciseId}`, {
    method: 'DELETE',
    auth: true,
  });
}
