import { render, screen } from '@testing-library/react-native';
import WelcomeScreen from '../index';

describe('WelcomeScreen', () => {
  it('renders the welcome title', async () => {
    await render(<WelcomeScreen />);
    expect(screen.getByText('أهلاً بك في كلامي')).toBeTruthy();
  });
});
