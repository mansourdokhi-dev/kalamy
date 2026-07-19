import { apiRequest } from './client';

export interface PatientMessage {
  id: string;
  patientProfileId: string;
  senderUserId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function listMessages(patientId: string): Promise<PatientMessage[]> {
  return apiRequest<PatientMessage[]>(`/api/v1/patients/${patientId}/messages`, { auth: true });
}

export function sendMessage(patientId: string, body: string): Promise<PatientMessage> {
  return apiRequest<PatientMessage>(`/api/v1/patients/${patientId}/messages`, { method: 'POST', body: { body }, auth: true });
}
