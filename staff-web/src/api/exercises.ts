import { apiRequest } from './client';

export interface Exercise {
  id: string;
  title: string;
  category: string;
  phaseLevel: number;
  instructions: string;
  durationMinutes: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export function listExercises(): Promise<Exercise[]> {
  return apiRequest('/api/v1/exercises', { auth: true });
}
