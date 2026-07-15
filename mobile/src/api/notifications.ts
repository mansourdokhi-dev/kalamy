import { apiRequest } from './client';

export type NotificationType =
  | 'SAMPLE_ESCALATED_TO_SUPERVISOR'
  | 'SPECIALIST_DECISION_ISSUED'
  | 'INTERVENTION_TIMED_OUT'
  | 'SAMPLE_ELIGIBLE_FOR_RECORDING'
  | 'SAMPLE_AVAILABLE_FOR_REVIEW'
  | 'SAMPLE_SUBMISSION_REMINDER'
  | 'SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR'
  | 'CONSULTATION_REMINDER'
  | 'DAILY_TRAINING_REMINDER'
  | 'SPECIALIST_WORKLOAD_REMINDER';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntity: string | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export function getMyNotifications(): Promise<AppNotification[]> {
  return apiRequest<AppNotification[]>('/api/v1/notifications', { auth: true });
}

export function markNotificationRead(notificationId: string): Promise<AppNotification> {
  return apiRequest<AppNotification>(`/api/v1/notifications/${notificationId}/read`, { method: 'PATCH', auth: true });
}
