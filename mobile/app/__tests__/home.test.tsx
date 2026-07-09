import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../src/theme/ThemeContext';
import HomeScreen from '../home';
import { useAuth } from '../../src/auth/AuthProvider';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { getProgress, getCurrentCycle, getCycleHistory, getActiveTreatmentPlan, startCycle, logTrainingEvent } from '../../src/api/treatmentEngine';
import { ApiError } from '../../src/api/client';

jest.mock('../../src/auth/AuthProvider');
jest.mock('../../src/patient/PatientProfileProvider');
jest.mock('../../src/api/treatmentEngine');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

const baseProgress = {
  currentLevelName: 'Level 1',
  currentLevelOrder: 1,
  levelsCompleted: 0,
  totalTrainingEvents: 2,
  repeatedLevelOrders: [],
  daysInProgram: 3,
};

function mockNoDecisionHistory() {
  (getCycleHistory as jest.Mock).mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ isLoggedIn: true, loading: false, logout: jest.fn() });
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('HomeScreen (My Program)', () => {
  it('shows "start my program" when there is no cycle but an active treatment plan exists', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'No active training cycle'));
    (getActiveTreatmentPlan as jest.Mock).mockResolvedValue({ id: 'plan-1' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('ابدأ برنامجي')).toBeTruthy();
    });

    (startCycle as jest.Mock).mockResolvedValue({ ...baseProgress, id: 'cycle-1', status: 'ACTIVE_LEVEL_TRAINING', humanModelWatchedAt: null });
    fireEvent.press(screen.getByText('ابدأ برنامجي'));

    await waitFor(() => {
      expect(startCycle).toHaveBeenCalledWith('profile-1', 'plan-1');
    });
  });

  it('shows the "watch level content" action when the model is unwatched', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({
      id: 'cycle-1',
      levelId: 'level-1',
      status: 'ACTIVE_LEVEL_TRAINING',
      humanModelWatchedAt: null,
    });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('شاهد محتوى المستوى')).toBeTruthy();
    });
  });

  it('shows an inline "log training" button once the model is watched, and calls the endpoint', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({
      id: 'cycle-1',
      levelId: 'level-1',
      status: 'ACTIVE_LEVEL_TRAINING',
      humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
    });
    (logTrainingEvent as jest.Mock).mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE_LEVEL_TRAINING' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('سجّل تدريب اليوم')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('سجّل تدريب اليوم'));

    await waitFor(() => {
      expect(logTrainingEvent).toHaveBeenCalledWith('profile-1');
    });
  });

  it('shows the "waiting for your therapist" message for WAITING_FOR_SPECIALIST', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    mockNoDecisionHistory();
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', status: 'WAITING_FOR_SPECIALIST' });

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('بانتظار مراجعة أخصائيك لعينتك')).toBeTruthy();
    });
  });

  it('shows a therapist-message banner when the most recently closed cycle has a decision', async () => {
    (getProgress as jest.Mock).mockResolvedValue(baseProgress);
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-2', levelId: 'level-2', status: 'ACTIVE_LEVEL_TRAINING', humanModelWatchedAt: null });
    (getCycleHistory as jest.Mock).mockResolvedValue([
      {
        id: 'cycle-1',
        closedAt: '2026-07-05T00:00:00.000Z',
        speechSample: { decision: 'TRANSITION' },
      },
    ]);

    render(<ThemeProvider><HomeScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لديك رسالة من أخصائيك')).toBeTruthy();
    });
  });
});
