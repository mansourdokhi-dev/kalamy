import { apiRequest } from './client';

export type ComplaintType = 'COMPLAINT' | 'SUGGESTION';
export type ComplaintStatus = 'OPEN' | 'REVIEWED' | 'RESOLVED';

export interface Complaint {
  id: string;
  submittedByUserId: string;
  relatedClinicianUserId: string | null;
  type: ComplaintType;
  subject: string;
  description: string;
  status: ComplaintStatus;
  createdAt: string;
  updatedAt: string;
}

export function listComplaints(filter: { status?: ComplaintStatus; relatedClinicianUserId?: string } = {}): Promise<Complaint[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.relatedClinicianUserId) params.set('relatedClinicianUserId', filter.relatedClinicianUserId);
  const query = params.toString();
  return apiRequest<Complaint[]>(`/api/v1/complaints${query ? `?${query}` : ''}`, { auth: true });
}

export function listMyComplaints(): Promise<Complaint[]> {
  return apiRequest<Complaint[]>('/api/v1/complaints/mine', { auth: true });
}

export function updateComplaintStatus(id: string, status: ComplaintStatus): Promise<Complaint> {
  return apiRequest<Complaint>(`/api/v1/complaints/${id}/status`, { method: 'PATCH', body: { status }, auth: true });
}
