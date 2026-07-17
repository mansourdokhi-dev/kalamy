import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import LevelContentScreen from '../level-content';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getCurrentCycle, getActiveLevelVersion, watchHumanModel } from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('LevelContentScreen', () => {
  it('shows the technique, reflection prompts, training list, and the mark-as-watched button when unwatched', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', humanModelWatchedAt: null });
    (getActiveLevelVersion as jest.Mock).mockResolvedValue({
      behavioralTechnique: 'الإطالة السهلة',
      cognitiveVideo1Question: 'ماذا شعرت؟',
      cognitiveVideo2Question: null,
      trainingListJson: JSON.stringify(['حا', 'جا']),
    });

    await render(<ThemeProvider><LevelContentScreen /></ThemeProvider>);

    await waitFor(
      () => {
        expect(screen.getByText('الإطالة السهلة')).toBeTruthy();
        expect(screen.getByText(/ماذا شعرت\؟/)).toBeTruthy();
        expect(screen.getByText('حا')).toBeTruthy();
        expect(screen.getByText('جا')).toBeTruthy();
        expect(screen.getByText('وضع علامة كمشاهد')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    (watchHumanModel as jest.Mock).mockResolvedValue({ id: 'cycle-1', humanModelWatchedAt: '2026-07-09T00:00:00.000Z' });
    fireEvent.press(screen.getByText('وضع علامة كمشاهد'));

    await waitFor(() => {
      expect(watchHumanModel).toHaveBeenCalledWith('profile-1');
    });
  });

  it('hides the mark-as-watched button once already watched', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', humanModelWatchedAt: '2026-07-01T00:00:00.000Z' });
    (getActiveLevelVersion as jest.Mock).mockResolvedValue({
      behavioralTechnique: 'الإطالة السهلة',
      cognitiveVideo1Question: null,
      cognitiveVideo2Question: null,
      trainingListJson: JSON.stringify(['حا']),
    });

    await render(<ThemeProvider><LevelContentScreen /></ThemeProvider>);

    await waitFor(
      () => {
        expect(screen.getByText('الإطالة السهلة')).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(screen.queryByText('وضع علامة كمشاهد')).toBeNull();
  });
});
