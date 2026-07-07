import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../src/theme/ThemeContext';
import WelcomeScreen from '../index';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('WelcomeScreen', () => {
  it('renders the welcome title', async () => {
    await render(
      <ThemeProvider>
        <WelcomeScreen />
      </ThemeProvider>,
    );
    expect(screen.getByText('أهلاً بك في كلامي')).toBeTruthy();
  });
});
