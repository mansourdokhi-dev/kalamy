import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import SampleResultScreen from '../sample-result';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getCycleHistory } from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ cycleId: 'cycle-1' }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('SampleResultScreen', () => {
  it('shows the decision, clinician notes, and self-report scores for the matching cycle', async () => {
    (getCycleHistory as jest.Mock).mockResolvedValue([
      {
        id: 'cycle-1',
        speechSample: {
          decision: 'TRANSITION',
          reviewNotes: 'أداء ممتاز',
          clinicianOpinionScore: 8,
          selfSeverityCurrent: 4,
          selfSeverityExpectedNext: 3,
          camperdownPerformanceRating: 7,
          clientOpinionScore: 6,
        },
      },
    ]);

    render(<ThemeProvider><SampleResultScreen /></ThemeProvider>);

    await waitFor(
      () => {
        expect(screen.getByText('الانتقال للمستوى التالي')).toBeTruthy();
        expect(screen.getByText('أداء ممتاز')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
