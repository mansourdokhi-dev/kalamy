import { apiRequest } from './client';

export interface PatientMessage {
  id: string;
  patientProfileId: string;
  senderUserId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function getMessages(patientProfileId: string): Promise<PatientMessage[]> {
  return apiRequest<PatientMessage[]>(`/api/v1/patients/${patientProfileId}/messages`, { auth: true });
}

export function sendMessage(patientProfileId: string, body: string): Promise<PatientMessage> {
  return apiRequest<PatientMessage>(`/api/v1/patients/${patientProfileId}/messages`, { method: 'POST', body: { body }, auth: true });
}
