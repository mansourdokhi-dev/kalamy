import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import VerifyScreen from '../verify';
import { verifyOtp } from '../../../src/api/auth';
import { ApiError } from '../../../src/api/client';

jest.mock('../../../src/api/auth', () => ({
  ...jest.requireActual('../../../src/api/auth'),
  verifyOtp: jest.fn(),
}));
const mockUseLocalSearchParams = jest.fn(() => ({ mobile: '+966500000001' }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useRouter: () => ({ push: jest.fn() }),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <VerifyScreen />
    </ThemeProvider>,
  );
}

describe('VerifyScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ mobile: '+966500000001' });
  });

  it('shows the incorrect-code message on INCORRECT_CODE failure', async () => {
    (verifyOtp as jest.Mock).mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'OTP verification failed: INCORRECT_CODE'));
    await renderScreen();
    for (let i = 0; i < 6; i++) {
      await fireEvent.changeText(screen.getByTestId(`otp-digit-${i}`), String(i));
    }
    await fireEvent.press(screen.getByText('تأكيد'));
    await waitFor(() => {
      expect(screen.getByText('الرمز غير صحيح، حاول مرة أخرى')).toBeTruthy();
    });
  });

  it('navigates to login on success', async () => {
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    await renderScreen();
    for (let i = 0; i < 6; i++) {
      await fireEvent.changeText(screen.getByTestId(`otp-digit-${i}`), String(i));
    }
    await fireEvent.press(screen.getByText('تأكيد'));
    await waitFor(() => {
      expect(verifyOtp).toHaveBeenCalledWith({ mobile: '+966500000001', code: '012345' });
    });
  });

  it('shows the dev-mode label and code when devOtpCode is present', async () => {
    mockUseLocalSearchParams.mockReturnValue({ mobile: '+966500000001', devOtpCode: '123456' });
    await renderScreen();
    expect(screen.getByText('وضع التطوير — الرمز:')).toBeTruthy();
    expect(screen.getByText('123456')).toBeTruthy();
  });
});
