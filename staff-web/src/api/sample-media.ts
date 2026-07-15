import { getToken } from '../storage/session';
import { ApiError } from './client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export async function fetchSampleMediaBlob(patientId: string, partId: string): Promise<string> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}/api/v1/patients/${patientId}/sample-parts/${partId}/media`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'MEDIA_FETCH_FAILED', 'تعذر تحميل التسجيل');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
