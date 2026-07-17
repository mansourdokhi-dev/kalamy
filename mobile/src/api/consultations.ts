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

export interface RequestConsultationInput {
  type: ConsultationType;
  reasonNote: string;
}

export function getMyConsultations(patientProfileId: string): Promise<Consultation[]> {
  return apiRequest<Consultation[]>(`/api/v1/patients/${patientProfileId}/consultations`, { auth: true });
}

export function requestConsultation(patientProfileId: string, input: RequestConsultationInput): Promise<Consultation> {
  return apiRequest<Consultation>(`/api/v1/patients/${patientProfileId}/consultations`, { method: 'POST', body: input, auth: true });
}
