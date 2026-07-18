import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../src/theme/ThemeContext';
import LoginScreen from '../login';
import { login } from '../../src/api/auth';
import { saveToken } from '../../src/storage/session';
import { ApiError } from '../../src/api/client';

jest.mock('../../src/api/auth');
jest.mock('../../src/storage/session');
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockRefreshProfile = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/patient/PatientProfileProvider', () => ({
  usePatientProfile: () => ({ refresh: mockRefreshProfile }),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <LoginScreen />
    </ThemeProvider>,
  );
}

describe('LoginScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves the token and navigates on successful login', async () => {
    (login as jest.Mock).mockResolvedValue({ token: 'tok', expiresAt: '2026-01-01', mustChangePassword: false });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('mobile-input'), '+966500000001');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'password123');
    await fireEvent.press(screen.getByText('دخول'));
    await waitFor(() => {
      expect(saveToken).toHaveBeenCalledWith('tok');
    });
  });

  it('shows the lockout message on a 429 response', async () => {
    (login as jest.Mock).mockRejectedValue(new ApiError(429, 'TOO_MANY_REQUESTS', 'Account temporarily locked. Try again later.'));
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('mobile-input'), '+966500000001');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'wrongpass');
    await fireEvent.press(screen.getByText('دخول'));
    await waitFor(() => {
      expect(screen.getByText('الحساب مقفل مؤقتًا بسبب محاولات فاشلة متكررة، حاول بعد 15 دقيقة')).toBeTruthy();
    });
  });
});
