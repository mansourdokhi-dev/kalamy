import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { LoginPage } from './LoginPage';
import { AuthProvider } from '../auth/AuthProvider';
import { login as loginApi, getMe } from '../api/auth';
import { ApiError } from '../api/client';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('LoginPage', () => {
  it('submits mobile and password and calls the login API', async () => {
    (loginApi as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 't', expiresAt: '2026-08-01T00:00:00.000Z', mustChangePassword: false });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });

    render(
      <MantineProvider>
        <MemoryRouter>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('تسجيل دخول الطاقم الطبي')).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.change(screen.getByLabelText('رقم الجوال'), { target: { value: '+966500000001' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('دخول'));

    await waitFor(() => {
      expect(loginApi).toHaveBeenCalledWith('+966500000001', 'password123');
    });
  });

  it('shows an error message when login fails', async () => {
    (loginApi as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials'));

    render(
      <MantineProvider>
        <MemoryRouter>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.change(screen.getByLabelText('رقم الجوال'), { target: { value: '+966500000001' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('دخول'));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeTruthy();
    });
  });
});
