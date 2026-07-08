import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';
import { AuthProvider, useAuth } from '../AuthProvider';
import { getToken, clearToken } from '../../storage/session';

jest.mock('../../storage/session');

function Probe() {
  const { isLoggedIn, loading, logout } = useAuth();
  if (loading) return <Text testID="state">loading</Text>;
  return (
    <>
      <Text testID="state">{isLoggedIn ? 'logged-in' : 'logged-out'}</Text>
      <Pressable testID="logout" onPress={logout} />
    </>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts logged-out when no token is stored', async () => {
    (getToken as jest.Mock).mockResolvedValue(null);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => {
      expect(screen.getByTestId('state').props.children).toBe('logged-out');
    });
  });

  it('starts logged-in when a token is stored', async () => {
    (getToken as jest.Mock).mockResolvedValue('tok');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => {
      expect(screen.getByTestId('state').props.children).toBe('logged-in');
    });
  });

  it('clears the token and flips to logged-out on logout()', async () => {
    (getToken as jest.Mock).mockResolvedValue('tok');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => screen.getByTestId('logout'));
    await fireEvent.press(screen.getByTestId('logout'));
    await waitFor(() => {
      expect(clearToken).toHaveBeenCalled();
      expect(screen.getByTestId('state').props.children).toBe('logged-out');
    });
  });
});
