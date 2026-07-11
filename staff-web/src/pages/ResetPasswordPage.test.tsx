import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { ResetPasswordPage } from './ResetPasswordPage';
import { resetPassword } from '../api/auth';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResetPasswordPage', () => {
  it('submits code and new password, using the mobile number passed via navigation state', async () => {
    (resetPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ reset: true });

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={[{ pathname: '/reset-password', state: { mobile: '+966500000001' } }]}>
          <ResetPasswordPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('إعادة تعيين كلمة المرور')).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.change(screen.getByLabelText('رمز التحقق'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByText('تعيين كلمة المرور'));

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith({ mobile: '+966500000001', code: '123456', newPassword: 'newpassword123' });
    });
  });
});
