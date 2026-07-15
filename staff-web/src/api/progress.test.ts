import { apiRequest } from './client';
import { getProgressDashboard, getPassedLevels } from './progress';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('progress API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getProgressDashboard fetches the dashboard for a patient', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: 'Level 2',
      currentLevelOrder: 2,
      levelsCompleted: 1,
      totalTrainingEvents: 12,
      repeatedLevelOrders: [],
      daysInProgram: 30,
    });
    const result = await getProgressDashboard('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/progress', { auth: true });
    expect(result.levelsCompleted).toBe(1);
  });

  it('getPassedLevels fetches the passed-levels list for a patient', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await getPassedLevels('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/levels/passed', { auth: true });
  });
});
