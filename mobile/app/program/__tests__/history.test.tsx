import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import HistoryScreen from '../history';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getCycleHistory, getLevels } from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
  (getLevels as jest.Mock).mockResolvedValue([{ id: 'level-1', name: 'Level 1', order: 1 }]);
});

describe('HistoryScreen', () => {
  it('lists each cycle with its level name, status, and a decision line when one exists', async () => {
    (getCycleHistory as jest.Mock).mockResolvedValue([
      {
        id: 'cycle-1',
        levelId: 'level-1',
        status: 'NEXT_LEVEL_APPROVED',
        cycleNumber: 1,
        closedAt: '2026-07-05T00:00:00.000Z',
        speechSample: { decision: 'TRANSITION' },
      },
    ]);

    await render(<ThemeProvider><HistoryScreen /></ThemeProvider>);

    // See home.test.tsx (commit 42da9d6) for why: under CPU-contended parallel
    // test-worker runs, RTL's default ~1s waitFor timeout has been too tight
    // even for mocked promises with no real I/O.
    await waitFor(
      () => {
        expect(screen.getByText('Level 1')).toBeTruthy();
        expect(screen.getByText(/قرر الأخصائي/)).toBeTruthy();
      },
      { timeout: 3000 },
    );

    fireEvent.press(screen.getByText(/قرر الأخصائي/));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/program/sample-result', params: { cycleId: 'cycle-1' } });
  });

  it('shows no decision line for a cycle with no sample', async () => {
    (getCycleHistory as jest.Mock).mockResolvedValue([
      { id: 'cycle-1', levelId: 'level-1', status: 'ACTIVE_LEVEL_TRAINING', cycleNumber: 1, closedAt: null, speechSample: null },
    ]);

    await render(<ThemeProvider><HistoryScreen /></ThemeProvider>);

    await waitFor(
      () => {
        expect(screen.getByText('Level 1')).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(screen.queryByText(/قرر الأخصائي/)).toBeNull();
  });

  it('shows the no-profile message instead of an infinite spinner when the patient has no profile yet', async () => {
    (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: null, loading: false, notFound: true, error: null });

    await render(<ThemeProvider><HistoryScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لم يُكمل فريقك الطبي خطة علاجك بعد — يرجى التواصل مع عيادتك')).toBeTruthy();
    });
  });
});
