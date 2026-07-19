import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import QuestionnairesScreen from '../questionnaires';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getActiveQuestionnaires, submitQuestionnaire } from '../../../src/api/questionnaires';
import { ApiError } from '../../../src/api/client';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/questionnaires');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

const TEMPLATE = {
  id: 't1',
  title: 'استبيان المتابعة',
  description: 'أسبوعي',
  isActive: true,
  createdAt: '2026-07-17T00:00:00.000Z',
  questions: [
    { id: 'q1', templateId: 't1', order: 0, text: 'كيف تقيّم طلاقتك؟', type: 'SCALE', options: [], required: true },
    { id: 'q2', templateId: 't1', order: 1, text: 'هل واجهت صعوبة؟', type: 'SINGLE_CHOICE', options: ['نعم', 'لا'], required: true },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('QuestionnairesScreen', () => {
  it('shows the empty state when there are no active questionnaires', async () => {
    (getActiveQuestionnaires as jest.Mock).mockResolvedValue([]);

    await render(<ThemeProvider><QuestionnairesScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد استبيانات متاحة حاليًا')).toBeTruthy();
    });
  });

  it('renders a template and submits answers', async () => {
    (getActiveQuestionnaires as jest.Mock).mockResolvedValue([TEMPLATE]);
    (submitQuestionnaire as jest.Mock).mockResolvedValue({ id: 'r1' });

    await render(<ThemeProvider><QuestionnairesScreen /></ThemeProvider>);

    await waitFor(() => expect(screen.getByText(/كيف تقيّم طلاقتك؟/)).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('answer-q1'), '7');
    await fireEvent.press(screen.getByTestId('option-q2-نعم'));
    await fireEvent.press(screen.getByText('إرسال الإجابات'));

    await waitFor(() => {
      expect(submitQuestionnaire).toHaveBeenCalledWith('profile-1', 't1', [
        { questionId: 'q1', value: '7' },
        { questionId: 'q2', value: 'نعم' },
      ]);
    });
    expect(screen.getByText('تم إرسال إجاباتك. شكرًا لك.')).toBeTruthy();
  });

  it('shows an ErrorBanner when the fetch fails', async () => {
    (getActiveQuestionnaires as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'تعذّر التحميل'));

    await render(<ThemeProvider><QuestionnairesScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('تعذّر التحميل')).toBeTruthy();
    });
  });
});
