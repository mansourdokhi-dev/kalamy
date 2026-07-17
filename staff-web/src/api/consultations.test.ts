import { apiRequest } from './client';
import { listConsultations, updateConsultation } from './consultations';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('consultations API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listConsultations fetches the patient-scoped list endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listConsultations('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/consultations', { auth: true });
  });

  it('updateConsultation PATCHes the consultation endpoint with the given fields', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', status: 'SCHEDULED' });
    await updateConsultation('c1', { status: 'SCHEDULED', scheduledAt: '2026-08-01T10:00:00.000Z' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/consultations/c1', {
      method: 'PATCH',
      body: { status: 'SCHEDULED', scheduledAt: '2026-08-01T10:00:00.000Z' },
      auth: true,
    });
  });
});
