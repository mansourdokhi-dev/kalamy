import { apiRequest } from '../client';
import { startOrResumeTrainingSession, recordTrainingProgress, getTrainingProgress } from '../treatmentEngine';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('training-session API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('startOrResumeTrainingSession posts to the training-sessions endpoint', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 0,
      startedAt: '2026-07-15T00:00:00.000Z',
      completedAt: null,
    });

    const result = await startOrResumeTrainingSession('profile-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/cycles/current/training-sessions', {
      method: 'POST',
      auth: true,
    });
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('recordTrainingProgress patches the cumulative unitsCompleted', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 30,
      startedAt: '2026-07-15T00:00:00.000Z',
      completedAt: null,
    });

    const result = await recordTrainingProgress('profile-1', 30);

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/cycles/current/training-sessions/current/progress', {
      method: 'PATCH',
      auth: true,
      body: { unitsCompleted: 30 },
    });
    expect(result.unitsCompleted).toBe(30);
  });

  it('getTrainingProgress fetches today\'s summary', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      completedToday: 2,
      targetPerDay: 7,
      intervalActive: false,
      nextAvailableAt: null,
      currentSessionId: null,
    });

    const result = await getTrainingProgress('profile-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/cycles/current/training-sessions/progress', {
      auth: true,
    });
    expect(result.completedToday).toBe(2);
  });
});
