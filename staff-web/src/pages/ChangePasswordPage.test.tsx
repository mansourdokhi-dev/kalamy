import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { ChangePasswordPage } from './ChangePasswordPage';
import { AuthProvider } from '../auth/AuthProvider';
import { changePassword, getMe } from '../api/auth';

vi.mock('../api/auth');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('kalamy_staff_token', 'existing-token');
});

describe('ChangePasswordPage', () => {
  it('submits current and new password, then refreshes the user', async () => {
    (getMe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: true })
      .mockResolvedValueOnce({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });
    (changePassword as ReturnType<typeof vi.fn>).mockResolvedValue({ changed: true });

    render(
      <MantineProvider>
        <MemoryRouter>
          <AuthProvider>
            <ChangePasswordPage />
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('يجب تغيير كلمة المرور')).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.change(screen.getByLabelText('كلمة المرور الحالية'), { target: { value: 'temp123' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByText('تحديث كلمة المرور'));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({ currentPassword: 'temp123', newPassword: 'newpassword123' });
      expect(getMe).toHaveBeenCalledTimes(2);
      expect(mockNavigate).toHaveBeenCalledWith('/patients');
    });
  });
});
