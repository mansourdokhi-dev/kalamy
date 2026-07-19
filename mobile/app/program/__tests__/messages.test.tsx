import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import MessagesScreen from '../messages';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getMessages, sendMessage } from '../../../src/api/messages';
import { getMyPatientProfile } from '../../../src/api/patients';
import { ApiError } from '../../../src/api/client';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/messages');
jest.mock('../../../src/api/patients');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

const PROFILE = {
  id: 'profile-1',
  userId: 'patient-user-1',
  fullName: 'مريض',
  gender: 'MALE',
  dateOfBirth: '2000-01-01',
  nationalId: 'X',
  status: 'ACTIVE',
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
  (getMyPatientProfile as jest.Mock).mockResolvedValue(PROFILE);
});

describe('MessagesScreen', () => {
  it('shows the empty state when there are no messages', async () => {
    (getMessages as jest.Mock).mockResolvedValue([]);

    await render(<ThemeProvider><MessagesScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد رسائل بعد. اكتب رسالتك الأولى.')).toBeTruthy();
    });
  });

  it('renders the thread and labels own vs care-team messages', async () => {
    (getMessages as jest.Mock).mockResolvedValue([
      { id: 'm1', patientProfileId: 'profile-1', senderUserId: 'patient-user-1', body: 'رسالتي', readAt: '2026-07-18T00:00:00.000Z', createdAt: '2026-07-17T00:00:00.000Z' },
      { id: 'm2', patientProfileId: 'profile-1', senderUserId: 'clinician-1', body: 'رد الأخصائي', readAt: null, createdAt: '2026-07-17T01:00:00.000Z' },
    ]);

    await render(<ThemeProvider><MessagesScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('رسالتي')).toBeTruthy();
      expect(screen.getByText('رد الأخصائي')).toBeTruthy();
      expect(screen.getByText('أنا')).toBeTruthy();
      expect(screen.getByText('الفريق العلاجي')).toBeTruthy();
      expect(screen.getByText('تم الاطلاع')).toBeTruthy();
    });
  });

  it('sends a message and reloads the thread', async () => {
    (getMessages as jest.Mock).mockResolvedValue([]);
    (sendMessage as jest.Mock).mockResolvedValue({ id: 'm1', patientProfileId: 'profile-1', senderUserId: 'patient-user-1', body: 'مرحبا', readAt: null, createdAt: '2026-07-17T00:00:00.000Z' });

    await render(<ThemeProvider><MessagesScreen /></ThemeProvider>);

    await waitFor(() => expect(screen.getByTestId('message-input')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('message-input'), 'مرحبا');
    await fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('profile-1', 'مرحبا');
    });
  });

  it('shows an ErrorBanner when the fetch fails', async () => {
    (getMessages as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'تعذّر تحميل الرسائل'));

    await render(<ThemeProvider><MessagesScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('تعذّر تحميل الرسائل')).toBeTruthy();
    });
  });
});
