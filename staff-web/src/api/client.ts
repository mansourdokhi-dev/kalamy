import { getToken } from '../storage/session';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let data: any;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError(response.status, 'PARSE_ERROR', `Request failed with status ${response.status}`);
    }
    data = undefined;
  }

  if (!response.ok) {
    throw new ApiError(response.status, data?.code ?? 'UNKNOWN_ERROR', data?.message ?? 'Request failed', data?.details);
  }

  return data as T;
}
