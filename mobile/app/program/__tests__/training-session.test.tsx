import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import TrainingSessionScreen from '../training-session';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import {
  getCurrentCycle,
  getLevels,
  getActiveLevelVersion,
  startOrResumeTrainingSession,
  recordTrainingProgress,
  getTrainingProgress,
} from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

const baseCycle = {
  id: 'cycle-1',
  levelId: 'level-1',
  status: 'ACTIVE_LEVEL_TRAINING',
  humanModelWatchedAt: '2026-07-14T00:00:00.000Z',
  firstTrainingEventAt: '2026-07-14T12:00:00.000Z',
};

const baseLevels = [{ id: 'level-1', name: 'المستوى الأول', order: 1, status: 'ACTIVE' as const }];
const baseLevelVersion = { id: 'v1', levelId: 'level-1', trainingListJson: JSON.stringify(['تمرين 1', 'تمرين 2']), samplePartTemplateJson: '[]', versionNumber: 1, behavioralTechnique: 'x', cognitiveVideo1Url: null, cognitiveVideo1Question: null, cognitiveVideo2Url: null, cognitiveVideo2Question: null, humanModelVideoUrl: null, humanModelDurationSeconds: null, publishedAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1' });
  (getCurrentCycle as jest.Mock).mockResolvedValue(baseCycle);
  (getLevels as jest.Mock).mockResolvedValue(baseLevels);
  (getActiveLevelVersion as jest.Mock).mockResolvedValue(baseLevelVersion);
});

describe('TrainingSessionScreen', () => {
  it('shows today\'s target and completed count', async () => {
    (getTrainingProgress as jest.Mock).mockResolvedValue({
      completedToday: 2,
      targetPerDay: 7,
      intervalActive: false,
      nextAvailableAt: null,
      currentSessionId: null,
    });

    await render(<ThemeProvider><TrainingSessionScreen /></ThemeProvider>);

    // A loose single-digit regex here (e.g. /2/) would be a real, reproducible
    // collision risk: baseLevelVersion's training list renders "تمرين 2" (exercise 2)
    // elsewhere on the same screen, and the time-computed "hours remaining" line
    // could independently contain a "7" depending on wall-clock time when the test
    // runs. Match the full, specific label text instead so this can only match the
    // one intended Text node.
    await waitFor(() => {
      expect(screen.getByText(/هدف اليوم: 2 \/ 7/)).toBeTruthy();
    });
  });

  it('shows the interval-active state instead of the progress control when a cooldown is active', async () => {
    (getTrainingProgress as jest.Mock).mockResolvedValue({
      completedToday: 1,
      targetPerDay: 7,
      intervalActive: true,
      nextAvailableAt: '2026-07-15T13:00:00.000Z',
      currentSessionId: null,
    });

    await render(<ThemeProvider><TrainingSessionScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText(ar_intervalActiveLabelText())).toBeTruthy();
    });
    expect(screen.queryByText('+10 وحدة')).toBeNull();

    function ar_intervalActiveLabelText() {
      return /التدريب التالي متاح الساعة/;
    }
  });

  it('starts a session and increments progress on tap, sending the cumulative value', async () => {
    (getTrainingProgress as jest.Mock).mockResolvedValue({
      completedToday: 0,
      targetPerDay: 7,
      intervalActive: false,
      nextAvailableAt: null,
      currentSessionId: null,
    });
    (startOrResumeTrainingSession as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 0,
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: null,
    });
    (recordTrainingProgress as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 10,
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: null,
    });

    await render(<ThemeProvider><TrainingSessionScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('ابدأ / استكمل التدريب')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('ابدأ / استكمل التدريب'));

    await waitFor(() => {
      expect(startOrResumeTrainingSession).toHaveBeenCalledWith('profile-1');
      expect(screen.getByText('+10 وحدة')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('+10 وحدة'));

    await waitFor(() => {
      expect(recordTrainingProgress).toHaveBeenCalledWith('profile-1', 10);
    });
  });

  it('shows a completion state once the session reaches the threshold', async () => {
    (getTrainingProgress as jest.Mock).mockResolvedValue({
      completedToday: 0,
      targetPerDay: 7,
      intervalActive: false,
      nextAvailableAt: null,
      currentSessionId: null,
    });
    (startOrResumeTrainingSession as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'IN_PROGRESS',
      unitsCompleted: 90,
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: null,
    });
    (recordTrainingProgress as jest.Mock).mockResolvedValue({
      id: 's1',
      trainingCycleId: 'cycle-1',
      status: 'COMPLETED',
      unitsCompleted: 100,
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: '2026-07-15T12:30:00.000Z',
    });

    await render(<ThemeProvider><TrainingSessionScreen /></ThemeProvider>);
    await waitFor(() => {
      expect(screen.getByText('ابدأ / استكمل التدريب')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('ابدأ / استكمل التدريب'));
    await waitFor(() => {
      expect(screen.getByText('+10 وحدة')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('+10 وحدة'));

    await waitFor(() => {
      expect(screen.getByText('أحسنت! أكملت تدريب اليوم')).toBeTruthy();
    });
  });
});
