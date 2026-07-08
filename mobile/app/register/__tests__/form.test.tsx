import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import RegisterFormScreen from '../form';
import { registerPatient } from '../../../src/api/auth';

jest.mock('../../../src/api/auth');
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ role: 'PATIENT' }),
  useRouter: () => ({ push: mockPush }),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <RegisterFormScreen />
    </ThemeProvider>,
  );
}

describe('RegisterFormScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a validation error when the mobile number is invalid', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('fullName-input'), 'Test User');
    await fireEvent.changeText(screen.getByTestId('mobile-input'), '123');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'password123');
    await fireEvent.press(screen.getByText('إرسال'));
    await waitFor(() => {
      expect(screen.getByText('رقم جوال غير صحيح')).toBeTruthy();
    });
    expect(registerPatient).not.toHaveBeenCalled();
  });

  it('calls registerPatient with valid input', async () => {
    (registerPatient as jest.Mock).mockResolvedValue({ userId: 'u1', devOtpCode: '123456' });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('fullName-input'), 'Test User');
    await fireEvent.changeText(screen.getByTestId('mobile-input'), '+966500000001');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'password123');
    await fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(registerPatient).toHaveBeenCalledWith({
        fullName: 'Test User',
        mobile: '+966500000001',
        email: undefined,
        password: 'password123',
      });
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/register/verify',
        params: { mobile: '+966500000001', devOtpCode: '123456' },
      });
    });
  });
});
