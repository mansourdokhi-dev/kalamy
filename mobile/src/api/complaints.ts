import { apiRequest } from './client';

export type ComplaintType = 'COMPLAINT' | 'SUGGESTION';
export type ComplaintStatus = 'OPEN' | 'REVIEWED' | 'RESOLVED';

export interface Complaint {
  id: string;
  type: ComplaintType;
  subject: string;
  description: string;
  status: ComplaintStatus;
  createdAt: string;
}

export interface SubmitComplaintInput {
  type: ComplaintType;
  subject: string;
  description: string;
}

export function getMyComplaints(): Promise<Complaint[]> {
  return apiRequest<Complaint[]>('/api/v1/complaints/mine', { auth: true });
}

export function submitComplaint(input: SubmitComplaintInput): Promise<Complaint> {
  return apiRequest<Complaint>('/api/v1/complaints', { method: 'POST', body: input, auth: true });
}
