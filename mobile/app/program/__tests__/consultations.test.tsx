import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import ConsultationsScreen from '../consultations';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getMyConsultations } from '../../../src/api/consultations';
import { ApiError } from '../../../src/api/client';

const mockPush = jest.fn();
jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/consultations');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('ConsultationsScreen', () => {
  it('shows the empty state and an enabled request button when there is no consultation yet', async () => {
    (getMyConsultations as jest.Mock).mockResolvedValue([]);

    await render(<ThemeProvider><ConsultationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لم تطلب استشارتك المجانية بعد')).toBeTruthy();
      expect(screen.getByText('طلب استشارة مجانية')).toBeTruthy();
    });
  });

  it('renders a consultation with its type, status, and reason', async () => {
    (getMyConsultations as jest.Mock).mockResolvedValue([
      {
        id: 'c1',
        patientProfileId: 'profile-1',
        requestedByUserId: 'user-1',
        type: 'VOICE',
        status: 'REQUESTED',
        reasonNote: 'أحتاج مساعدة في التقنية',
        scheduledAt: null,
        externalMeetingLink: null,
        specialistUserId: null,
        outcomeNotes: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
      },
    ]);

    await render(<ThemeProvider><ConsultationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('صوتية')).toBeTruthy();
      expect(screen.getByText('تم الطلب')).toBeTruthy();
      expect(screen.getByText('أحتاج مساعدة في التقنية')).toBeTruthy();
    });
  });

  it('hides the request button once a non-cancelled consultation already exists', async () => {
    (getMyConsultations as jest.Mock).mockResolvedValue([
      {
        id: 'c1',
        patientProfileId: 'profile-1',
        requestedByUserId: 'user-1',
        type: 'VOICE',
        status: 'COMPLETED',
        reasonNote: 'x',
        scheduledAt: null,
        externalMeetingLink: null,
        specialistUserId: null,
        outcomeNotes: 'تم بنجاح',
        completedAt: '2026-07-17T00:00:00.000Z',
        cancelledAt: null,
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
      },
    ]);

    await render(<ThemeProvider><ConsultationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('تم الاكتمال')).toBeTruthy();
    });
    expect(screen.queryByText('طلب استشارة مجانية')).toBeNull();
  });

  it('navigates to the request screen when the button is pressed', async () => {
    (getMyConsultations as jest.Mock).mockResolvedValue([]);

    await render(<ThemeProvider><ConsultationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('طلب استشارة مجانية')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('طلب استشارة مجانية'));

    expect(mockPush).toHaveBeenCalledWith('/program/consultation-request');
  });

  it('shows an ErrorBanner when the fetch fails', async () => {
    (getMyConsultations as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));

    await render(<ThemeProvider><ConsultationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeTruthy();
    });
  });
});
