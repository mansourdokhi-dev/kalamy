import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import { login, getMe } from '../api/auth';
import { getToken, clearToken } from '../storage/session';

vi.mock('../api/auth');

function Probe() {
  const { user, loading, login: doLogin, logout } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <div>{user ? `logged in: ${user.fullName}` : 'logged out'}</div>
      <button onClick={() => doLogin('+966500000001', 'password123')}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearToken();
});

describe('AuthProvider', () => {
  it('starts logged out when there is no saved token', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByText('logged out')).toBeTruthy();
    });
  });

  it('logs in, saves the token, and populates the user from getMe', async () => {
    (login as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'new-token', expiresAt: '2026-08-01T00:00:00.000Z', mustChangePassword: false });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      fullName: 'Dr. Sara',
      mobile: '+966500000001',
      role: 'CLINICIAN',
      mustChangePassword: false,
    });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => {
      expect(screen.getByText('logged out')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => {
      expect(screen.getByText('logged in: Dr. Sara')).toBeTruthy();
    });
    expect(getToken()).toBe('new-token');
  });

  it('logs out and clears the token', async () => {
    (login as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'new-token', expiresAt: '2026-08-01T00:00:00.000Z', mustChangePassword: false });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      fullName: 'Dr. Sara',
      mobile: '+966500000001',
      role: 'CLINICIAN',
      mustChangePassword: false,
    });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => screen.getByText('login'));
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => {
      expect(screen.getByText('logged in: Dr. Sara')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('logout'));

    await waitFor(() => {
      expect(screen.getByText('logged out')).toBeTruthy();
    });
    expect(getToken()).toBeNull();
  });

  it('restores the logged-in user from an existing saved token on mount', async () => {
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      fullName: 'Dr. Sara',
      mobile: '+966500000001',
      role: 'CLINICIAN',
      mustChangePassword: false,
    });
    localStorage.setItem('kalamy_staff_token', 'existing-token');

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByText('logged in: Dr. Sara')).toBeTruthy();
    });
  });
});
