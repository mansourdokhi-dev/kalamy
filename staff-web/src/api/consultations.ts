import { apiRequest } from './client';

export type ConsultationType = 'VIDEO' | 'VOICE';
export type ConsultationStatus = 'REQUESTED' | 'SCHEDULING' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

export interface Consultation {
  id: string;
  patientProfileId: string;
  requestedByUserId: string;
  type: ConsultationType;
  status: ConsultationStatus;
  reasonNote: string | null;
  scheduledAt: string | null;
  externalMeetingLink: string | null;
  specialistUserId: string | null;
  outcomeNotes: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateConsultationInput {
  status?: 'SCHEDULING' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  scheduledAt?: string;
  externalMeetingLink?: string;
  outcomeNotes?: string;
}

export function listConsultations(patientId: string): Promise<Consultation[]> {
  return apiRequest<Consultation[]>(`/api/v1/patients/${patientId}/consultations`, { auth: true });
}

export function updateConsultation(consultationId: string, input: UpdateConsultationInput): Promise<Consultation> {
  return apiRequest<Consultation>(`/api/v1/consultations/${consultationId}`, { method: 'PATCH', body: input, auth: true });
}
