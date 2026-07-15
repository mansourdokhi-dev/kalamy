import { apiRequest } from './client';
import { getCurrentCycle } from './cycles';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('cycles API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCurrentCycle fetches the current cycle for a patient', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cycle-1',
      patientProfileId: 'patient-1',
      treatmentPlanId: 'plan-1',
      levelId: 'level-1',
      levelVersionId: 'version-1',
      cycleNumber: 1,
      status: 'WAITING_FOR_SPECIALIST',
      humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
      firstTrainingEventAt: '2026-07-01T00:00:00.000Z',
      closedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      speechSample: null,
    });

    const result = await getCurrentCycle('patient-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/cycles/current', { auth: true });
    expect(result.status).toBe('WAITING_FOR_SPECIALIST');
  });
});
