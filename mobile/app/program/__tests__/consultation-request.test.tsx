import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import ConsultationRequestScreen from '../consultation-request';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { requestConsultation } from '../../../src/api/consultations';
import { ApiError } from '../../../src/api/client';

const mockBack = jest.fn();
jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/consultations');
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('ConsultationRequestScreen', () => {
  it('submits the selected type and reason, then navigates back', async () => {
    (requestConsultation as jest.Mock).mockResolvedValue({ id: 'c1', status: 'REQUESTED' });

    await render(<ThemeProvider><ConsultationRequestScreen /></ThemeProvider>);

    await fireEvent.press(screen.getByTestId('type-video'));
    await fireEvent.changeText(screen.getByTestId('reason-input'), 'أحتاج مساعدة في التقنية');
    await fireEvent.press(screen.getByText('إرسال الطلب'));

    await waitFor(() => {
      expect(requestConsultation).toHaveBeenCalledWith('profile-1', { type: 'VIDEO', reasonNote: 'أحتاج مساعدة في التقنية' });
      expect(mockBack).toHaveBeenCalled();
    });
  });

  it('disables submit until a reason is entered', async () => {
    await render(<ThemeProvider><ConsultationRequestScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('إرسال الطلب')).toBeTruthy();
    });
    await fireEvent.press(screen.getByText('إرسال الطلب'));

    expect(requestConsultation).not.toHaveBeenCalled();
  });

  it('shows an ErrorBanner when the request fails (e.g. the free consultation was already used)', async () => {
    (requestConsultation as jest.Mock).mockRejectedValue(new ApiError(409, 'CONFLICT', 'The one free consultation has already been used'));

    await render(<ThemeProvider><ConsultationRequestScreen /></ThemeProvider>);

    await fireEvent.changeText(screen.getByTestId('reason-input'), 'x');
    await fireEvent.press(screen.getByText('إرسال الطلب'));

    await waitFor(() => {
      expect(screen.getByText('The one free consultation has already been used')).toBeTruthy();
    });
  });
});
